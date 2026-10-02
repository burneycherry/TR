/*
 * 変圧器 周辺機器選定 計算ロジック（DOM非依存・Nodeでもテスト可）
 */
(function (root) {
  'use strict';

  const D = (typeof TR_DATA !== 'undefined') ? TR_DATA : require('./data.js');
  const SQRT3 = Math.sqrt(3);
  const LV_MAX = 600; // これ以下を低圧とみなす [V]
  const MODES = ['single', 'three', 'scott'];

  // 昇順配列から value 以上の最小値。無ければ null
  function pickAtLeast(list, value) {
    for (let i = 0; i < list.length; i++) {
      if (list[i] >= value) { return list[i]; }
    }
    return null;
  }

  function normMode(input) {
    if (MODES.indexOf(input.mode) >= 0) { return input.mode; }
    if (input.mode === 'three4w') { return 'three'; }
    return input.phase === 1 ? 'single' : 'three';
  }

  // %Z 標準値：日立 ST-156 特性表（油入/モールド × 50/60Hz × 単相/三相210V/三相400V級）
  function defaultZ(mode, kva, v2, trType, freq) {
    const single = mode === 'single' || mode === 1;
    const byType = D.defaultZ[trType === 'mold' ? 'mold' : 'oil'];
    const t = byType[Number(freq) === 60 ? 60 : 50][single ? 'single' : (v2 > 300 ? 'three400' : 'three')];
    let z = t[0][1];
    for (let i = 0; i < t.length; i++) {
      if (kva >= t[i][0]) { z = t[i][1]; }
    }
    return z;
  }

  // 定格電流 [A]（phase: 1 | 3）
  function ratedCurrent(phase, kva, volt) {
    return phase === 1 ? kva * 1000 / volt : kva * 1000 / (SQRT3 * volt);
  }

  // 電源側 %Z（変圧器容量基準）。iscKa: 一次側三相短絡電流 [kA]
  function sourceZ(mode, kva, v1, iscKa) {
    if (!iscKa || iscKa <= 0) { return 0; }
    // 単相変圧器は線間に接続 → 線間短絡電流 = √3/2 × 三相短絡電流
    const sccKva = mode === 'single' ? v1 * (SQRT3 / 2) * iscKa : SQRT3 * v1 * iscKa;
    return kva / sccKva * 100;
  }

  // ヒューズ表の電圧区分（3.3kV / 6.6kV）
  function fuseVoltClass(v1) {
    if (v1 >= 3000 && v1 <= 3600) { return 3300; }
    if (v1 >= 6000 && v1 <= 7200) { return 6600; }
    return null;
  }

  function fmtMitsu(cell) {
    if (cell === null || cell === undefined) { return null; }
    if (cell === '※') { return 'CLS形 M400A'; }
    return 'G' + cell[0] + ' (T' + cell[1] + ')A';
  }

  function fuseMitsubishi(m, mode, kva, vc, i3, kva1, i1single) {
    if (!vc) { return { ok: false, msg: '3.3kV / 6.6kV 以外は選定表の対象外' }; }
    if (mode === 'three' && kva1 > 0) {
      // 表5(2) 一括用：各相の三相＋単相定格電流の合計 Im
      const im = i3 + i1single;
      for (let i = 0; i < m.combined.length; i++) {
        if (im <= m.combined[i][0]) {
          return { ok: true, method: '表5(2) 一括用 Im = ' + im.toFixed(2) + 'A', value: fmtMitsu(m.combined[i][1]) };
        }
      }
      return { ok: false, method: '表5(2) 一括用 Im = ' + im.toFixed(2) + 'A', msg: '表の範囲外' };
    }
    const rows = m[mode === 'single' ? 'single' : 'three'][vc];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] >= kva) {
        const r = rows[i];
        const approx = r[0] !== kva;
        if (r[1] === null) { return { ok: false, msg: '表で適用外（—）', row: r[0], approx: approx }; }
        return {
          ok: true, method: '表5(1) ' + r[0] + 'kVA 行' + (approx ? '（直近上位容量）' : ''),
          min: fmtMitsu(r[1]), max: fmtMitsu(r[2]), row: r[0], approx: approx
        };
      }
    }
    return { ok: false, msg: '表の範囲外' };
  }

  function fuseFuji(f, mode, kva, vc, trType, kva1) {
    if (!vc) { return { ok: false, msg: '3.3kV / 6.6kV 以外は選定表の対象外' }; }
    const t = f[trType === 'mold' ? 'mold' : 'oil'][vc];
    const k3 = mode === 'single' ? 0 : kva;
    const k1 = mode === 'single' ? kva : (mode === 'three' && kva1 > 0 ? kva1 : 0);
    const ri = t.rows.findIndex(function (v) { return v >= k3; });
    const ci = t.cols.findIndex(function (v) { return v >= k1; });
    if (ri < 0 || ci < 0) { return { ok: false, model: t.model, msg: '表の範囲外' }; }
    const g = t.g[ri][ci];
    const approx = t.rows[ri] !== k3 || t.cols[ci] !== k1;
    const where = '三相' + (t.rows[ri] || '—') + ' × 単相' + (t.cols[ci] || '—') + (approx ? '（直近上位容量）' : '');
    if (g === null) { return { ok: false, model: t.model, method: where, msg: '表で適用外（—）' }; }
    return { ok: true, model: t.model, method: where, value: 'G' + g + 'A', approx: approx };
  }

  // エナジーサポート（NGK）選定表の引き方（選定ページ runSearch01/02 と同じ判定）
  // 表にない値は直近上位の列・行。ただし補間元（下位側）のセルも該当ありのときだけ採用
  function esLook1(caps, vals, p) {
    for (let j = 0; j < caps.length; j++) {
      if (p <= caps[j]) {
        const exact = p === caps[j];
        if (j === 0 && !exact) { return null; }
        if ((exact || vals[j - 1] !== null) && vals[j] !== null) { return { value: vals[j], at: caps[j], exact: exact }; }
        return null;
      }
    }
    return null;
  }
  function esLook2(t, p1, p2) {
    let ci = -1;
    for (let j = 0; j < t.cols.length; j++) { if (p1 <= t.cols[j]) { ci = j; break; } }
    if (ci < 0) { return null; }
    const ce = p1 === t.cols[ci];
    if (ci === 0 && !ce) { return null; }
    for (let k = 0; k < t.rows.length; k++) {
      if (p2 <= t.rows[k][0]) {
        const re = p2 === t.rows[k][0];
        if (k === 0 && !re) { return null; }
        const v = t.rows[k][ci + 1];
        if (v === null) { return null; }
        if (!ce && t.rows[k][ci] === null) { return null; }
        if (!re && t.rows[k - 1][ci + 1] === null) { return null; }
        return { value: v, col: t.cols[ci], row: t.rows[k][0], exact: ce && re };
      }
    }
    return null;
  }
  // mode：single|three（スコット・灯動は三相表）、kva1：LBS 共用単相、vopt：{ vv: 1台 kVA } 同容量V／{ vvx: [共用, 専用] } 異容量V
  function fuseEnergys(E, mode, kva, vc, kva1, vopt) {
    if (vc !== 6600) { return { ok: false, msg: '6.6kV 以外は選定表の対象外' }; }
    let items = [];
    let method;
    if (vopt && (vopt.vv || vopt.vvx)) {
      const big = vopt.vv ? vopt.vv : Math.max(vopt.vvx[0], vopt.vvx[1]);
      const small = vopt.vv ? vopt.vv : Math.min(vopt.vvx[0], vopt.vvx[1]);
      method = (vopt.vv ? '同容量' : '変則') + 'V結線表（大 ' + big + 'kVA × 小 ' + small + 'kVA）';
      E.vx.forEach(function (t) { const h = esLook2(t, big, small); if (h) { items.push({ model: t.model, value: h.value }); } });
    } else if (mode !== 'single' && kva1 > 0) {
      method = '1φ＋3φ一括表（1φ ' + kva1 + 'kVA × 3φ ' + kva + 'kVA）';
      E.combo.forEach(function (t) { const h = esLook2(t, kva1, kva); if (h) { items.push({ model: t.model, value: h.value }); } });
    } else {
      const tbl = mode === 'single' ? E.single : E.three;
      method = (mode === 'single' ? '1φ' : '3φ') + '表（' + kva + 'kVA）';
      tbl.forEach(function (t) { const h = esLook1(t[1], t[2], kva); if (h) { items.push({ model: t[0], value: h.value, at: h.at, exact: h.exact }); } });
    }
    if (!items.length) { return { ok: false, method: method, msg: '表の範囲外（該当なし）' }; }
    return { ok: true, method: method, items: items, value: items.map(function (x) { return x.model + ' ' + x.value + 'A'; }).join('／') };
  }
  function selectFuse(mode, kva, v1, trType, kva1, vopt) {
    const L = D.lbs;
    const vc = fuseVoltClass(v1);
    const warn = [];
    if (!vc) { warn.push('一次電圧 ' + v1 + 'V はヒューズ選定表（3.3kV/6.6kV）の対象外です。'); }
    if (mode === 'scott') { warn.push('スコット変圧器は三相容量として三相の表で選定しています。'); }
    const i3 = mode === 'single' ? 0 : ratedCurrent(3, kva, v1);
    const i1s = mode === 'single' ? ratedCurrent(1, kva, v1) : (kva1 > 0 ? ratedCurrent(1, kva1, v1) : 0);
    return {
      warn: warn,
      mitsubishi: Object.assign({ name: L.makers.mitsubishi.name, series: L.makers.mitsubishi.series, note: L.makers.mitsubishi.note, verified: L.makers.mitsubishi.verified },
        fuseMitsubishi(L.makers.mitsubishi, mode, kva, vc, i3, kva1, i1s)),
      fuji: Object.assign({ name: L.makers.fuji.name, series: L.makers.fuji.series, note: L.makers.fuji.note, verified: L.makers.fuji.verified },
        fuseFuji(L.makers.fuji, mode, kva, vc, trType, kva1)),
      energys: Object.assign({ name: L.makers.energys.name, series: L.makers.energys.series, note: L.makers.energys.note, verified: L.makers.energys.verified },
        fuseEnergys(L.makers.energys, mode, kva, vc, kva1, vopt))
    };
  }

  function selectCT(i2) {
    const need = i2 * D.ct.factor;
    const p = pickAtLeast(D.ct.primaries, need);
    let model = null;
    for (let i = 0; p && i < D.ct.models.length; i++) {
      if (p <= D.ct.models[i][0]) { model = { name: D.ct.models[i][1], va: D.ct.models[i][2] }; break; }
    }
    return { need: need, primary: p, secondary: D.ct.secondary, ratio: p ? p + '/' + D.ct.secondary + 'A' : null, model: model };
  }

  // THR 整定値：CT二次換算の定格電流を step 単位で必ず切り捨て
  // （変圧器が過負荷になる前に警報を出すため。四捨五入・切り上げにしないこと）
  function selectTHR(i2, ctPrimary) {
    if (!ctPrimary) { return null; }
    const raw = i2 * D.ct.secondary / ctPrimary;
    const step = D.thr.step;
    // 浮動小数誤差対策で微小値を足してから切り捨て
    const setting = Math.floor(raw / step + 1e-9) * step;
    return {
      raw: raw, setting: Number(setting.toFixed(2)), ct: ctPrimary + '/' + D.ct.secondary + 'A',
      name: D.thr.name, model: D.thr.model, verified: D.thr.verified
    };
  }

  // 電線規準の各表で選定。1条で収まらなければ2条引き（1本の許容 ≥ 電流×0.6、JSIA）
  // 2条でも収まらなければ電線は選定せず銅バーのみ
  // tables 省略時は社内規準キュービクル表（分岐ブレーカー一次側、遮断器容量基準）
  function selectCable(current, tables) {
    const C = D.cable;
    return (tables || C.tables).map(function (t) {
      const base = { group: t.group, temp: t.temp, name: t.name, basis: t.basis };
      for (let n = 1; n <= C.maxParallel; n++) {
        const need = n === 1 ? current : current * C.parallelRatio;
        for (let i = 0; i < t.limits.length; i++) {
          if (t.limits[i] >= need) {
            return Object.assign(base, { sq: t.sizes[i], limit: t.limits[i], parallel: n, need: need });
          }
        }
      }
      return Object.assign(base, { sq: null });
    });
  }

  function selectBusbar(current) {
    const t = D.busbar.table;
    for (let i = 0; i < t.length; i++) {
      if (t[i][1] >= current) { return { size: t[i][0], ampacity: t[i][1] }; }
    }
    return null;
  }

  // 表（フレーム昇順・同フレームは下位グレード順）から 定格 ≥ need かつ Icu ≥ 短絡電流 の最初の機種
  // iscOf(rating)：その定格のブレーカーに必要な Icu [kA]（JIS C 4620 適用時は定格列の値）
  function firstFit(list, need, iscOf, col) {
    for (let i = 0; list && i < list.length; i++) {
      const b = list[i];
      const r = pickAtLeast(b.ratings, need);
      if (r !== null && b.icu[col] >= iscOf(r)) { return { model: b.model, af: b.af, rating: r, icu: b.icu[col], needKa: iscOf(r) }; }
    }
    return null;
  }

  // JIS C 4620 解説表1：三相/単相 × 6.6kV × 210V級 × 表の容量のとき行を返す（表にない容量は直近上位行）
  function jisRow(mode, kva, v1, v2, freq) {
    const J = D.jisC4620;
    if (!(mode === 'three' || mode === 'single')) { return null; }
    if (!(v1 >= 6000 && v1 <= 7200) || !(v2 >= 200 && v2 <= 220)) { return null; }
    const t = J[mode][Number(freq) === 60 ? 60 : 50];
    for (let i = 0; i < t.length; i++) {
      if (kva <= t[i][0]) {
        return { src: 'jis', name: J.name, ratings: J.ratings, kva: t[i][0], exact: t[i][0] === kva, values: t[i][1], freq: Number(freq) === 60 ? 60 : 50 };
      }
    }
    return null;
  }

  // 認定の手引き 補足表1：高圧受電・200V回路（三相/単相）・400V回路（三相）。表にない容量は直近上位行
  function guideRow(mode, kva, v1, v2) {
    const G = D.guideIsc;
    if (!(mode === 'three' || mode === 'single') || !(v1 > LV_MAX)) { return null; }
    const set = v2 >= 200 && v2 <= 220 ? G.v200 : (v2 >= 380 && v2 <= 460 ? G.v400 : null);
    const t = set && set[mode];
    for (let i = 0; t && i < t.length; i++) {
      if (kva <= t[i][0]) {
        return { src: 'guide', name: G.name, ratings: G.ratings, kva: t[i][0], exact: t[i][0] === kva, values: t[i][1], circuit: set === G.v200 ? '200V回路' : '400V回路' };
      }
    }
    return null;
  }

  // 定格 rating のブレーカーに対する表の値。表の最大列（630A/600A）超は表外（null）。「—」は変圧器に対し過大な定格 → 行の最大値
  function jisAt(row, rating) {
    const R = row.ratings;
    for (let i = 0; i < R.length; i++) {
      if (rating <= R[i]) {
        let v = row.values[i];
        const dash = v === null;
        if (dash) { v = Math.max.apply(null, row.values.filter(function (x) { return x !== null; })); }
        return { ka: v, col: R[i], dash: dash };
      }
    }
    return null;
  }

  function iscFn(iscKa, jis) {
    return function (rating) {
      const j = jis ? jisAt(jis, rating) : null;
      return j ? j.ka : iscKa;
    };
  }

  // ブレーカー：配線用遮断器(MCCB) と 気中遮断器(ACB) をそれぞれ選定
  function selectBreaker(need, iscKa, volt, jis) {
    const col = volt <= 240 ? 0 : 1;
    const iscOf = iscFn(iscKa, jis);
    const makers = {};
    Object.keys(D.breaker.makers).forEach(function (k) {
      const m = D.breaker.makers[k];
      makers[k] = {
        name: m.name, series: m.series, pick: firstFit(m.list, need, iscOf, col),
        acb: firstFit(m.acb, need, iscOf, col), overNote: m.overNote || '', verified: m.verified
      };
    });
    return { need: need, iscKa: iscKa, jis: jis || null, voltClass: col === 0 ? 'AC230V級' : 'AC440V級', makers: makers };
  }

  // 二次側分岐ブレーカー：フレームごとに Icu ≥ 短絡電流 を満たす最下位グレード
  // 表示するフレームは、二次定格電流を流せる最小フレームまで（それより大きいフレームは不要）
  // jis：JIS C 4620 解説表1 の行（適用時）。フレームの最大定格の列の値を必要 Icu とする（630A 超は計算値）
  function selectBranch(i2, iscKa, volt, jis) {
    const col = volt <= 240 ? 0 : 1;
    const makers = {};
    Object.keys(D.breaker.makers).forEach(function (k) {
      const m = D.breaker.makers[k];
      const frames = [];
      m.list.forEach(function (b) {
        const af = b.branchAf || b.af;
        if (af > D.breaker.branchMaxAf) { return; }
        let f = frames.find(function (x) { return x.af === af; });
        if (!f) { f = { af: af, models: [] }; frames.push(f); }
        f.models.push(b);
      });
      frames.sort(function (a, b) { return a.af - b.af; });
      const rows = [];
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        // 必要 Icu はフレームで付けうる最大定格の列（例：三菱 63AF は 50A まで → 60A以下の列）
        let max = 0;
        f.models.forEach(function (b) { b.ratings.forEach(function (r) { if (r <= f.af && r > max) { max = r; } }); });
        const j = jis ? jisAt(jis, max) : null;
        const need = j ? j.ka : iscKa;
        let hit = null;
        let best = null;
        f.models.forEach(function (b) {
          if (!hit && b.icu[col] >= need) { hit = b; }
          if (!best || b.icu[col] > best.icu[col]) { best = b; }
        });
        const pickB = hit || best;
        const ratings = pickB.ratings.filter(function (r) { return r <= f.af; });
        rows.push({
          af: f.af, model: pickB.model, icu: pickB.icu[col], ok: !!hit, needKa: need, jisCol: j ? j.col : null, jisDash: j ? j.dash : false,
          minRating: ratings[0], maxRating: ratings[ratings.length - 1]
        });
        if (ratings[ratings.length - 1] >= i2) { break; }
      }
      makers[k] = { name: m.name, series: m.series, rows: rows, verified: m.verified };
    });
    return { iscKa: iscKa, jis: jis || null, voltClass: col === 0 ? 'AC230V級' : 'AC440V級', makers: makers };
  }

  // B種接地線(EB)：表2.13.1（一相分容量・電圧級）
  // 備考(2)：低圧側を保護する遮断器（分岐・主幹）の定格によっては表2.13.2 の方が太くなる
  // → 自動採用せず「ブレーカー定格による サイズアップ」の目安として表示（ユーザー指定）
  // maxA：付けうる最大のブレーカー定格（主幹ありは主幹定格、なしは二次定格電流以下の最大の分岐定格）
  // これを超える帯は表示しない（二次電流を超えるブレーカーは付けない。ユーザー指定）
  function selectEB(mode, kva, v2, maxA) {
    const phaseKva = mode === 'three' ? kva / 3 : (mode === 'scott' ? kva / 2 : kva);
    const col = v2 <= 150 ? 0 : (v2 <= 300 ? 1 : 2);
    const E = D.eb;
    const res = { phaseKva: phaseKva, voltClass: ['100V級', '200V級', '400V級'][col], sq: null, sizeUp: [], t2Max: E.table2[E.table2.length - 1][0], verified: E.verified };
    for (let i = 0; i < E.table.length; i++) {
      if (phaseKva <= E.table[i][col]) { res.sq = E.table[i][3]; break; }
    }
    res.label = res.sq !== null ? res.sq + 'mm²' : null;
    if (res.sq !== null) {
      // baseMax：表2.13.1 の太さのままで良いブレーカー定格の上限
      res.baseMax = 0;
      for (let j = 0; j < E.table2.length; j++) {
        const t = E.table2[j];
        const from = j > 0 ? E.table2[j - 1][0] : 0;
        if (t[2] > res.sq) {
          if (maxA > 0 && from >= maxA) { break; }
          res.sizeUp.push({ from: from, to: maxA > 0 ? Math.min(t[0], maxA) : t[0], label: t[1], r4: t[3] === 'R4' });
        } else {
          res.baseMax = t[0];
        }
      }
    }
    return res;
  }

  // 二次定格電流以下で付けられる最大の分岐ブレーカー定格（各社・分岐対象フレーム）
  function maxBranchRating(i2) {
    let max = 0;
    Object.keys(D.breaker.makers).forEach(function (k) {
      D.breaker.makers[k].list.forEach(function (b) {
        const af = b.branchAf || b.af;
        if (af > D.breaker.branchMaxAf) { return; }
        b.ratings.forEach(function (r) { if (r <= af && r <= i2 && r > max) { max = r; } });
      });
    });
    return max;
  }

  /*
   * input: { mode: 'single'|'three'|'scott'（旧: phase 1|3）, kva, v1, v2,
   *          z, iscKa, trType: 'oil'|'mold', kva1（三相と一括でLBSを共用する単相kVA）,
   *          mainBreaker: true で二次主幹ブレーカーも選定（既定は不要） }
   * mode 'todo'（灯動共用変圧器）：todoMaker='hitachi'|'mitsubishi'、kva=定格容量、freq=50|60（%Z）、todoSide/todoLoad（負荷配分）。'three4w' は 'three' と同じ計算（二次は線間電圧）
   */
  function todoMaker(maker) { return D.todo.makers[maker] ? maker : 'hitachi'; }

  // 63AF は 50A まで（ユーザー指定）：NF63 系で 50A 超の項目は除外
  const NF63_MAX = 50;
  function dropNf63(items) {
    const out = [];
    items.forEach(function (it) {
      let models = it[0].split(',').map(function (x) { return x.trim(); });
      if (it[1] > NF63_MAX) { models = models.filter(function (m) { return m.indexOf('NF63-') !== 0; }); }
      if (models.length) { out.push([models.join(', '), it[1]]); }
    });
    return out;
  }

  // 変圧器一次側用遮断器（三菱 Y-0701 表4-25）：低圧/低圧変圧器の一次側
  // 一次 200〜220V → 210V 表、380〜460V → 420V 表。スコット・灯動は三相表。表にない容量は直近上位行
  function selectPrimaryMitsubishi(mode, kva, v1) {
    const T = D.primaryBrk.tables;
    const ph = mode === 'single' ? 'single' : 'three';
    const vk = v1 >= 200 && v1 <= 220 ? 210 : (v1 >= 380 && v1 <= 460 ? 420 : 0);
    const res = { scott: mode === 'scott', name: D.primaryBrk.name, notes: D.primaryBrk.notes, table: vk ? (ph === 'single' ? '単相' : '三相') + vk + 'V' : null, row: null };
    if (!vk) { return res; }
    const rows = T[ph + vk];
    for (let i = 0; i < rows.length; i++) {
      if (kva <= rows[i][0]) {
        res.row = {
          kva: rows[i][0], exact: rows[i][0] === kva, i1: rows[i][1],
          examples: rows[i][2].map(function (e) { return { peak: e[0], items: dropNf63(e[1]) }; })
        };
        break;
      }
    }
    return res;
  }

  // 変圧器一次側回路の選定（富士 62D2-J-0030f 4.11）：一次側短絡電流 kA 行 × 容量列
  // 一次 380〜460V → 440V 表、200〜220V → 220V 表。表にない容量は直近上位列。短絡電流が未入力なら全行を示す
  function selectPrimaryFuji(mode, kva, v1, iscKa) {
    const F = D.fujiPrimary;
    const ph = mode === 'single' ? 'single' : 'three';
    const vk = v1 >= 380 && v1 <= 460 ? 440 : (v1 >= 200 && v1 <= 220 ? 220 : 0);
    const res = { scott: mode === 'scott', name: F.name, notes: F.notes, table: vk ? (ph === 'single' ? '単相' : '三相') + vk + 'V' : null, col: null };
    if (!vk) { return res; }
    const t = F.tables[ph + vk];
    let ci = -1;
    for (let i = 0; i < t.kva.length; i++) { if (kva <= t.kva[i]) { ci = i; break; } }
    if (ci < 0) { return res; }
    const rows = t.rows.map(function (r) {
      const m = r[1][ci];
      const mm = m ? /^B[WX](\d+)\w*-(\d)P(\d+)$/.exec(m) : null;
      return { ka: r[0], model: m, af: mm ? Number(mm[1]) : null, rating: mm ? Number(mm[3]) : null };
    });
    let sel = -1;
    if (iscKa > 0) {
      for (let j = 0; j < rows.length; j++) { if (rows[j].ka >= iscKa) { sel = j; break; } }
    }
    res.col = { kva: t.kva[ci], exact: t.kva[ci] === kva, rows: rows, sel: sel, over: iscKa > rows[rows.length - 1].ka };
    return res;
  }

  // 灯動共用変圧器：メーカー・定格容量の行を返す
  function todoRow(maker, kva) {
    const M = D.todo.makers[todoMaker(maker)];
    for (let i = 0; i < M.rows.length; i++) {
      const r = M.rows[i];
      if (r[0] === kva) {
        return { kva: r[0], single: r[1], z50: r[2], z60: r[3], zRange: M.zRange ? M.zRange[kva] : null, knee: M.knees[kva] };
      }
    }
    return null;
  }

  // 負荷配分曲線：side='three' なら三相kVA→単相kVA、'single' なら単相kVA→三相kVA（折れ線を線形補間）
  function todoSplit(maker, kva, side, value) {
    const M = D.todo.makers[todoMaker(maker)];
    const c = M.curves[kva];
    if (!c) { return null; }
    const knee = M.knees[kva];
    const xi = side === 'single' ? 1 : 0;
    const yi = 1 - xi;
    const max = side === 'single' ? c[0][1] : c[c.length - 1][0];
    // 未入力は折れ点（三相・単相を同時にとる場合の値）
    let v = value === null || value === undefined || value === '' ? knee[xi] : Number(value);
    if (!(v >= 0)) { v = knee[xi]; }
    if (v > max) { return { error: (side === 'single' ? '単相' : '三相') + '側は最大 ' + max + 'kVA です。' }; }
    // 単相基準は曲線を逆にたどる（x=単相 の昇順に並べ替え）
    const pts = side === 'single' ? c.slice().reverse() : c;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (v <= b[xi]) {
        const y = a[yi] + (b[yi] - a[yi]) * (v - a[xi]) / (b[xi] - a[xi]);
        const r = side === 'single' ? { three: y, single: v } : { three: v, single: y };
        r.three = Math.round(r.three * 10) / 10;
        r.single = Math.round(r.single * 10) / 10;
        r.side = side;
        r.knee = knee;
        r.overSingle = M.singleLimit > 0 && r.single > M.singleLimit ? M.singleLimit : 0;
        return r;
      }
    }
    return null;
  }

  // 灯動共用変圧器：一次（LBS・一次電流）は定格容量の三相変圧器として、
  // 二次は負荷配分曲線上の配分（三相側／単相側の一方を入力、未入力は折れ点）で各回路を選定（ユーザー指定）
  // %Z は日立特性表（周波数別）。EB の一相分容量＝単相＋三相÷3
  // 異容量V-V結線（日本電気技術者協会「単相変圧器による異容量V‐V結線方式の特徴」第1表・(3)(4)式）
  // 共用 Tk（単相＋三相）・専用 Ts（三相のみ）。相順 a-b-c、進み接続＝単相負荷が a-b 間（共用 a-b）、遅れ接続＝b-c 間
  //   共用 Tk = √(P1² + P3²/3 + (2/√3)·P1·P3·cos(30° + φ))、φ = 進み θ3−θ1 ／ 遅れ θ1−θ3、専用 Ts = P3/√3
  // side：'three'＝三相 P3 を入力、'single'＝単相 P1 を入力、'pct'＝三相を最大（√3·Ts）の % で指定。空欄は三相最大（第2表の条件）
  function vvxSplit(tk, ts, side, value, pf1, pf3, lead) {
    const p1f = pf1 > 0 && pf1 <= 1 ? pf1 : 1;
    const p3f = pf3 > 0 && pf3 <= 1 ? pf3 : p1f; // 未入力は単相と同じ力率（(3)(4)式の前提）
    const t1 = Math.acos(p1f);
    const t3 = Math.acos(p3f);
    const phi = lead === false ? t1 - t3 : t3 - t1;
    const c = Math.cos(Math.PI / 6 + phi);
    const s3 = Math.sqrt(3);
    const p3max = s3 * Math.min(ts, tk);
    const p1From3 = function (p3) { return -p3 * c / s3 + Math.sqrt(Math.max(0, tk * tk - p3 * p3 * (1 - c * c) / 3)); };
    let p3;
    let p1;
    const v = value === null || value === undefined || value === '' ? null : Number(value);
    if (side === 'single' && v !== null) {
      if (!(v >= 0) || v > tk) { return { error: '単相側は共用変圧器の容量 ' + tk + 'kVA 以下にしてください。' }; }
      p1 = v;
      const x = -p1 * c + Math.sqrt(Math.max(0, tk * tk - p1 * p1 * (1 - c * c)));
      p3 = s3 * Math.max(0, Math.min(x, ts));
    } else {
      if (side === 'pct' && v !== null) {
        if (!(v >= 0) || v > 100) { return { error: '三相の割合は 0〜100% にしてください。' }; }
        p3 = p3max * v / 100;
      } else if (side === 'three' && v !== null) {
        if (!(v >= 0) || v > p3max + 1e-9) { return { error: '三相側は最大 ' + (Math.round(p3max * 10) / 10) + 'kVA（√3×専用 ' + ts + 'kVA）です。' }; }
        p3 = v;
      } else {
        p3 = p3max;
      }
      p1 = Math.max(0, p1From3(p3));
    }
    const r1 = function (x) { return Math.round(x * 10) / 10; };
    const needK = Math.sqrt(p1 * p1 + p3 * p3 / 3 + 2 / s3 * p1 * p3 * c);
    return {
      three: r1(p3), single: r1(p1), p3max: r1(p3max), pct: p3max > 0 ? p3 / p3max * 100 : 0,
      needK: needK, needS: p3 / s3, cosTerm: c, pf1: p1f, pf3: p3f, lead: lead !== false, side: side
    };
  }
  function calculateVvx(input) {
    const tk = Number(input.kva);
    const ts = Number(input.kvaB);
    const v1 = Number(input.v1);
    const v2 = Number(input.v2);
    if (!(tk > 0) || !(ts > 0) || !(v1 > 0) || !(v2 > 0)) { throw new Error('共用・専用変圧器の容量と電圧を正しく入力してください。'); }
    const lead = input.vvxLead !== false;
    const split = vvxSplit(tk, ts, input.vvxSide, input.vvxLoad, Number(input.pf1), Number(input.pf3), lead);
    if (split.error) { throw new Error(split.error); }
    if (!(split.three > 0) || !(split.single > 0)) {
      throw new Error('三相側・単相側とも 0 より大きい配分にしてください（片側のみの場合は同容量V結線や三相・単相を選択）。');
    }
    const trType = input.trType === 'mold' ? 'mold' : 'oil';
    const zIn = Number(input.z) > 0 ? Number(input.z) : 0;
    const iscIn = Number(input.iscKa) > 0 ? Number(input.iscKa) : 0;
    // 変圧器ごとの端子短絡電流（単相 %Z）。両回路には大きい方を使う（安全側）
    const sc = [tk, ts].map(function (k) {
      const zt = zIn || defaultZ('single', k, v2, trType, input.freq);
      const zs = sourceZ('single', k, v1, iscIn);
      return { kva: k, tr: zt, src: zs, total: zt + zs, isc: k * 1000 / v2 * 100 / (zt + zs) / 1000 };
    });
    const gov = sc[0].isc >= sc[1].isc ? sc[0] : sc[1];
    // 一次側・LBS・タップは共用変圧器（単相）で選定
    const base = calculate(Object.assign({}, input, { mode: 'single', conn: '', kva: tk, kva1: 0 }));
    if (base.fuse) {
      base.fuse.energys = Object.assign({}, base.fuse.energys, fuseEnergys(D.lbs.makers.energys, 'single', tk, fuseVoltClass(v1), 0, { vvx: [tk, ts] }));
      base.fuse.warn.push('三菱・富士は V結線用の選定表がないため共用変圧器 単相 ' + tk + 'kVA の行を参考表示しています（エナジーサポートは変則V結線の表で選定）。');
    }
    const sub = Object.assign({}, input, { conn: '', kva1: 0, iscBasis: 'calc', iscOverride: gov.isc, z: gov.tr });
    const c3 = calculate(Object.assign({}, sub, { mode: 'three', kva: split.three }));
    const c1 = calculate(Object.assign({}, sub, { mode: 'single', kva: split.single }));
    [c3, c1].forEach(function (c) { c.z = { tr: gov.tr, trIsDefault: !zIn, src: gov.src, total: gov.total }; });
    const maxA = Math.max(c3.eb.maxA, c1.eb.maxA);
    // EB 一相分容量：異容量V結線は大きい方の単相変圧器の定格容量
    const eb = Object.assign(selectEB('single', Math.max(tk, ts), v2, maxA), { maxA: maxA, maxByMain: c3.eb.maxByMain, i2: c3.eb.maxA >= c1.eb.maxA ? c3.i2 : c1.i2, vvx: true });
    // 結線の JIS 判定：単相変圧器（表3 単相容量・表5 210-105V）
    const J = D.jisTr;
    const lv = !(v1 > LV_MAX);
    const auto = jisWinding('three', tk, v1, v2, input.freq, {}).auto;
    const notes = [];
    if (!lv) {
      if (!(v1 >= J.v1Range[0] && v1 <= J.v1Range[1])) { notes.push('JIS C 4304/4306 は 6kV 配電用です（一次 ' + v1 + 'V は対象外）。'); }
      [tk, ts].forEach(function (k) { if (J.capacities.single.indexOf(k) < 0) { notes.push('容量 ' + k + 'kVA は JIS 表3 の単相定格容量外です。'); } });
      if (v2 !== 210) { notes.push('JIS 表5 の単相定格二次電圧は 210-105V です。'); }
    }
    const warn = [];
    if (tk < ts) { warn.push('共用変圧器は専用変圧器以上の容量とするのが一般的です（参考資料の第2表は共用＞専用）。'); }
    warn.push('V結線は三相電圧が不平衡になるおそれがあります。');
    const s3 = Math.sqrt(3);
    return Object.assign(base, {
      input: Object.assign({}, base.input, { mode: 'three', kva: tk, kvaB: ts, kva3: split.three, kva1: split.single, vvx: true, lead: lead }),
      i1: tk * 1000 / v1, i1b: ts * 1000 / v1,
      iscKa: gov.isc, sc: sc,
      winding: { codes: ['Vvx'], auto: auto, selected: true, lv: lv, notes: notes, std: !lv && notes.length === 0, lead: lead },
      todo: {
        three: c3, single: c1, split: split, name: '異容量V-V結線', vvx: true,
        source: '日本電気技術者協会「単相変圧器による異容量V‐V結線方式の特徴」第1表・(3)(4)式', warn: warn
      },
      vvx: { tk: tk, ts: ts, split: split, s3: s3 },
      eb: eb
    });
  }
  function calculateTodo(input) {
    const k = Number(input.kva);
    const maker = todoMaker(input.todoMaker);
    const M = D.todo.makers[maker];
    const row = todoRow(maker, k);
    if (!row) {
      throw new Error('灯動変圧器（' + M.name + '）は定格容量 ' + M.rows.map(function (x) { return x[0]; }).join('/') + 'kVA から選んでください。');
    }
    const freq = Number(input.freq) === 60 ? 60 : 50;
    // 負荷配分：三相側／単相側のどちらかを入力し、もう一方を負荷配分曲線から求める
    const split = todoSplit(maker, k, input.todoSide === 'single' ? 'single' : 'three', input.todoLoad);
    if (!split || split.error) { throw new Error(split ? split.error : '負荷配分曲線がありません。'); }
    const zIn = Number(input.z) > 0 ? Number(input.z) : 0;
    const z = zIn || (freq === 60 ? row.z60 : row.z50);
    const base = calculate(Object.assign({}, input, { mode: 'three', kva: k, kva1: 0, z: z }));
    base.z.trIsDefault = !zIn;
    const sub = Object.assign({}, input, { z: z, kva1: 0, iscBasis: 'calc' }); // JIS C 4620 表は通常の三相・単相用
    if (!(split.three > 0) || !(split.single > 0)) {
      throw new Error('三相側・単相側とも 0 より大きい配分にしてください（片側のみの場合は三相・単相を選択）。');
    }
    const c3 = calculate(Object.assign({}, sub, { mode: 'three', kva: split.three }));
    const c1 = calculate(Object.assign({}, sub, { mode: 'single', kva: split.single }));
    [c3, c1].forEach(function (c) { c.z.trIsDefault = !zIn; });
    const maxA = Math.max(c3.eb.maxA, c1.eb.maxA);
    // EB：一相分容量＝単相＋三相÷3（単相側中性点を接地する巻線の負担。ユーザー指定）
    const eb = Object.assign(selectEB('single', split.single + split.three / 3, base.input.v2, maxA),
      { maxA: maxA, maxByMain: c3.eb.maxByMain, i2: c3.eb.maxA >= c1.eb.maxA ? c3.i2 : c1.i2, todo: true });
    if (base.fuse) { base.fuse.warn.push('灯動共用変圧器：一次側は定格容量 ' + k + 'kVA の三相変圧器として選定しています。'); }
    return Object.assign(base, {
      input: Object.assign({}, base.input, { mode: 'todo', kva3: split.three, kva1: split.single, freq: freq }),
      winding: null, // 灯動共用は JIS C 4304/4306 の対象外（結線図はメーカーの代表例）
      todo: {
        three: c3, single: c1, row: row, freq: freq, split: split, maker: maker, name: M.name, source: M.source,
        warn: split.overSingle ? ['単相負荷として無条件に使用できるのは ' + split.overSingle + 'kVA 以下です。超える場合は設備全体の不平衡率を30%以下としてください（内線規程 1305節、' + M.name + '）。'] : []
      },
      eb: eb
    });
  }

  // JIS C 4304/4306 の結線（表18〜20）：単相=単三、三相は容量と二次電圧で Yy0/Yd1/Dd0/Dyn11
  // JIS の対象は 6kV 配電用（v1Range）。それ以外の高圧は同じ結線を参考表示、低圧/低圧は代表例（二次 300V 以下 Yd1、超 Dyn11）
  // 表19 で2通りある容量（750・1000kVA）は日立標準（ST-156）の結線を先頭にする
  // opts.wires：単相 2|3（既定 3）、opts.conn：三相3線で選択した結線（空＝代表例）。JIS 外の選択は注意を付ける
  const CONN_NAMES = { Yy0: 'Y-Y（Yy0）', Yd1: 'Y-Δ（Yd1）', Dd0: 'Δ-Δ（Dd0）', Dyn11: 'Δ-Y（Dyn11）', Yyn0: 'Y-Y 中性点付き（Yyn0）', Vv0: 'V-V（単相変圧器2台）', Vvx: 'V-V 異容量（灯動共用）' };
  // 選べる結線：三相3線／三相4線（中性点が必要）
  const CONN_OPTIONS = { three: ['Yy0', 'Yd1', 'Dd0', 'Dyn11', 'Vv0', 'Vvx'], three4w: ['Dyn11', 'Yyn0'] };
  function jisWinding(mode, kva, v1, v2, freq, opts) {
    const o = opts || {};
    const J = D.jisTr;
    const H = J.hitachi;
    const f = Number(freq) === 60 ? 60 : 50;
    const notes = [];
    if (mode !== 'single' && mode !== 'three') { return null; }
    const lv = !(v1 > LV_MAX);
    const v1Ok = v1 >= J.v1Range[0] && v1 <= J.v1Range[1];
    if (mode === 'single') {
      const w2 = o.wires === 2;
      // 単相2線 210V は JIS の単三専用変圧器（210-105V）の u-v 間を使用（o は中性点として B種接地）
      const w2jis = w2 && !lv && v2 === 210;
      const code = w2 ? (w2jis ? '単三u-v' : '単相2線') : '単三';
      if (lv) { return { codes: [code], std: false, lv: true, notes: [] }; }
      if (!v1Ok) { notes.push('JIS C 4304/4306 は 6kV 配電用です（一次 ' + v1 + 'V は対象外、結線は参考）。'); }
      const capOk = J.capacities.single.indexOf(kva) >= 0;
      if (!capOk) { notes.push('容量 ' + kva + 'kVA は JIS 表3 の定格容量外です。'); }
      if (v2 !== 210) { notes.push('JIS 表5 の単相定格二次電圧は 210-105V（表18 単三専用結線）です。' + (w2 ? '単相2線 ' + v2 + 'V は JIS 標準外です。' : '')); }
      return { codes: [code], std: v1Ok && capOk && v2 === 210, lv: false, notes: notes };
    }
    // 三相：代表例（auto）を決める
    let auto, allowed, hc = null;
    if (lv) {
      auto = [v2 > 300 ? 'Dyn11' : 'Yd1'];
    } else if (v2 > 300) {
      auto = ['Dyn11'];
    } else {
      const pick = function (rows) {
        for (let i = 0; i < rows.length; i++) { if (kva <= rows[i][0]) { return rows[i][1]; } }
        return rows[rows.length - 1][1];
      };
      auto = pick(J.threeConn).slice();
      hc = pick(H.conn210);
      if (auto.length > 1 && auto.indexOf(hc) > 0) { auto.splice(auto.indexOf(hc), 1); auto.unshift(hc); }
    }
    if (o.n) { auto = ['Dyn11']; }
    allowed = auto.slice();
    const opts2 = CONN_OPTIONS[o.n ? 'three4w' : 'three'];
    const sel = o.conn && opts2.indexOf(o.conn) >= 0 ? o.conn : null;
    const codes = sel ? [sel] : auto;
    const res = { codes: codes, auto: auto, selected: !!sel, hitachi: sel ? null : hc, lv: lv, notes: notes };
    if (lv) {
      res.std = false;
      return res;
    }
    if (!v1Ok) { notes.push('JIS C 4304/4306 は 6kV 配電用です（一次 ' + v1 + 'V は対象外、結線は参考）。'); }
    if (sel === 'Vv0') {
      // V結線：JIS の単相変圧器（単三専用 210-105V）2台の u-v 間を使う。三相変圧器の表19 の対象外
      const capS = J.capacities.single.indexOf(kva) >= 0;
      if (!capS) { notes.push('容量 ' + kva + 'kVA（1台あたり）は JIS 表3 の単相定格容量外です。'); }
      if (v2 !== 210) { notes.push('JIS 表5 の単相定格二次電圧は 210-105V です（V結線の線間 ' + v2 + 'V は標準外）。'); }
      res.std = v1Ok && capS && v2 === 210;
      return res;
    }
    const capOk = J.capacities.three.indexOf(kva) >= 0;
    if (!capOk) { notes.push('容量 ' + kva + 'kVA は JIS 表3 の定格容量外です（結線は容量範囲による代表例）。'); }
    const selOut = sel && allowed.indexOf(sel) < 0;
    if (selOut) {
      notes.push('選択した結線 ' + CONN_NAMES[sel] + ' は JIS 標準外です（' + (v2 > 300 ? 'JIS 表6：二次 420/440V は Δ-Y 中性点端子付き' : 'JIS 表19：' + kva + 'kVA・210V は ' + allowed.map(function (c) { return CONN_NAMES[c]; }).join(' 又は ')) + '）。');
    }
    if (codes[0] === 'Dyn11') {
      const vOk = v2 === J.v2.threeN[f];
      const kOk = J.dynKva.indexOf(kva) >= 0;
      const jem = !kOk && H.dynKva.indexOf(kva) >= 0;
      if (v2 > 300 && !vOk) { notes.push('JIS 表6 の Δ-Y（中性点端子付き）の定格二次電圧は 420V（50Hz）・440V（60Hz）です（選択中 ' + f + 'Hz）。'); }
      if (!selOut && jem) {
        notes.push('JIS 表19 の Δ-Y（中性点端子付き）は 1500・2000kVA です。' + kva + 'kVA は JEM 1520/1521 準拠の標準品（' + H.name + '）。');
      } else if (!selOut && !kOk && capOk) {
        notes.push('JIS 表19 の Δ-Y（中性点端子付き）は 1500・2000kVA です（日立標準品は 75kVA 以上）。');
      }
      res.std = v1Ok && capOk && vOk && kOk && !selOut;
      res.jem = v1Ok && vOk && jem && !selOut;
      return res;
    }
    if (v2 !== J.v2.three[0] && !selOut) { notes.push('JIS 表6 の三相定格二次電圧（Y-Y・Y-Δ・Δ-Δ）は 210V です。'); }
    if (!sel && J.dynKva.indexOf(kva) >= 0) { notes.push('JIS 表19 では 1500・2000kVA は Δ-Δ（210V）又は Δ-Y 中性点端子付き（420/440V）です。'); }
    res.std = v1Ok && capOk && v2 === J.v2.three[0] && !selOut;
    return res;
  }

  // タップ電圧と二次電圧（JIS 表4）：二次電圧 = 受電電圧 × 定格二次電圧 / タップ電圧（無負荷時）
  // 50kVA 以下は R6600・F6300・6000、75kVA 以上（灯動含む）は F6750・R6600・F6450・F6300・6150
  function tapTable(kva, v2, supply) {
    const T = D.jisTr.taps;
    const list = kva <= T.smallMaxKva ? T.small : T.large;
    const vs = Number(supply) > 0 ? Number(supply) : 6600;
    return {
      supply: vs,
      small: kva <= T.smallMaxKva,
      rows: list.map(function (t) {
        const out = vs * v2 / t[1];
        return {
          mark: t[0], tap: t[1], label: t[0] + t[1],
          kind: t[0] === 'R' ? '定格電圧' : t[0] === 'F' ? '全容量タップ' : '低減容量タップ',
          v2: out, pct: (out / v2 - 1) * 100
        };
      })
    };
  }

  function calculate(input) {
    if (input.mode === 'todo') { return calculateTodo(input); }
    if (input.mode === 'three' && input.conn === 'Vvx' && input.uiMode !== 'three4w') { return calculateVvx(input); }
    const mode = normMode(input);
    const kva = Number(input.kva);
    const v1 = Number(input.v1);
    const v2 = Number(input.v2);
    if (!(kva > 0) || !(v1 > 0) || !(v2 > 0)) {
      throw new Error('容量・一次電圧・二次電圧を正しく入力してください。');
    }
    const trType = input.trType === 'mold' ? 'mold' : 'oil';
    // V結線（三相3線・単相変圧器2台）：kva は1台あたり。線電流＝1台の定格電流（三相出力 √3×kva）
    // %Z・電源側%Z・ヒューズ・一次ブレーカー・EB は単相1台分で扱う（um = 'single'）
    const vv = mode === 'three' && input.conn === 'Vv0' && input.uiMode !== 'three4w';
    const um = vv ? 'single' : mode;
    const kva1 = mode === 'three' && !vv && Number(input.kva1) > 0 ? Number(input.kva1) : 0;
    const hv = v1 > LV_MAX;
    const zInput = Number(input.z);
    const zTr = zInput > 0 ? zInput : defaultZ(um, kva, v2, trType, input.freq);
    const iscIn = Number(input.iscKa) > 0 ? Number(input.iscKa) : 0;
    const zSrc = sourceZ(um, kva, v1, iscIn);
    const zTotal = zTr + zSrc;

    const circuits = mode === 'scott' ? 2 : 1;
    const i1 = ratedCurrent(um === 'single' ? 1 : 3, kva, v1);
    // スコットは M座・T座 各 kVA/2 の単相回路
    const i2 = um === 'three' ? ratedCurrent(3, kva, v2) : ratedCurrent(1, kva / circuits, v2);
    // iscOverride：異容量V結線の各回路は変圧器端子短絡の値を使う
    const iscKa = Number(input.iscOverride) > 0 ? Number(input.iscOverride) : i2 * 100 / zTotal / 1000;

    const fuse = hv ? selectFuse(um, kva, v1, trType, kva1, vv ? { vv: kva } : null) : null;
    if (fuse && vv) { fuse.warn.push('三菱・富士は V結線用の選定表がないため単相 ' + kva + 'kVA 1台分の行を参考表示しています（エナジーサポートは V結線の表で選定）。'); }
    let primaryBreaker = null;
    if (!hv) {
      primaryBreaker = selectBreaker(i1 * D.breaker.primaryFactor, iscIn, v1);
      primaryBreaker.catalog = selectPrimaryMitsubishi(um, kva, v1);
      primaryBreaker.fujiCatalog = selectPrimaryFuji(um, kva, v1, iscIn);
      primaryBreaker.vv = vv;
      primaryBreaker.iscGiven = iscIn > 0;
    }
    const ct = selectCT(i2);
    const thr = selectTHR(i2, ct.primary);
    // 遮断容量の基準：キュービクルは JIS C 4620 解説表1 を優先（適用できない条件は計算値）
    // JIS C 4620 解説表1 を優先し、JIS に無い範囲は認定の手引き 補足表1 で補完（ユーザー指定）
    // V結線は JIS C 4620・認定の手引きの表の対象外 → 計算値
    const jisOnly = input.iscBasis === 'calc' || vv ? null : jisRow(mode, kva, v1, v2, input.freq);
    const guide = input.iscBasis === 'calc' || vv ? null : guideRow(mode, kva, v1, v2);
    const jis = jisOnly || guide;
    const iscRef = jisOnly ? guide : null; // 両表がある範囲は手引きの値も参考表示
    const brk = input.mainBreaker ? selectBreaker(i2 * D.breaker.factor, iscKa, v2, jis) : null;
    const branch = selectBranch(i2, iscKa, v2, jis);

    // 幹線：主幹ブレーカーありは主幹定格（各社の大きい方）以上、なしは二次定格電流以上
    let design = i2;
    if (brk) {
      Object.keys(brk.makers).forEach(function (k) {
        const p = brk.makers[k].pick || brk.makers[k].acb;
        if (p && p.rating > design) { design = p.rating; }
      });
    }

    // EB サイズアップ判定用：主幹ありは主幹定格、なしは二次定格電流以下の最大分岐定格
    const ebMax = brk ? design : (maxBranchRating(i2) || i2);

    return {
      input: { mode: mode, kva: kva, v1: v1, v2: v2, trType: trType, kva1: kva1, vv: vv, kvaOut: vv ? kva * Math.sqrt(3) : kva },
      winding: jisWinding(mode, kva, v1, v2, input.freq, { wires: Number(input.wires) === 2 ? 2 : 3, conn: input.conn, n: input.uiMode === 'three4w' }),
      hv: hv, circuits: circuits,
      z: { tr: zTr, trIsDefault: !(zInput > 0), src: zSrc, total: zTotal },
      i1: i1, i2: i2, iscKa: iscKa, jis: jis, iscRef: iscRef,
      fuse: fuse, primaryBreaker: primaryBreaker, ct: ct, thr: thr, breaker: brk, branch: branch,
      conductor: { design: design, byBreaker: !!brk, cable: selectCable(design, D.busCable.tables), busbar: selectBusbar(design) },
      eb: Object.assign(selectEB(um, kva, v2, ebMax), { maxA: ebMax, maxByMain: !!brk, i2: i2, vv: vv })
    };
  }

  const api = {
    calculate: calculate, ratedCurrent: ratedCurrent, defaultZ: defaultZ, sourceZ: sourceZ,
    pickAtLeast: pickAtLeast, todoRow: todoRow, selectPrimaryMitsubishi: selectPrimaryMitsubishi, selectPrimaryFuji: selectPrimaryFuji, vvxSplit: vvxSplit, jisWinding: jisWinding, CONN_NAMES: CONN_NAMES, CONN_OPTIONS: CONN_OPTIONS, tapTable: tapTable, jisRow: jisRow, guideRow: guideRow, jisAt: jisAt, todoSplit: todoSplit, selectCable: selectCable, selectBusbar: selectBusbar,
    selectBreaker: selectBreaker, selectBranch: selectBranch, selectCT: selectCT, selectTHR: selectTHR, selectFuse: selectFuse, fuseEnergys: fuseEnergys,
    selectEB: selectEB, data: D
  };
  root.TRCalc = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof self !== 'undefined' ? self : this);
