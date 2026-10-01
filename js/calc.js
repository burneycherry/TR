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

  function defaultZ(mode, kva, v2) {
    const single = mode === 'single' || mode === 1;
    const t = D.defaultZ[single ? 'single' : (v2 > 300 ? 'three400' : 'three')];
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

  function selectFuse(mode, kva, v1, trType, kva1) {
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
        fuseFuji(L.makers.fuji, mode, kva, vc, trType, kva1))
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
      if (kva <= t[i][0]) { return { kva: t[i][0], exact: t[i][0] === kva, values: t[i][1], freq: Number(freq) === 60 ? 60 : 50 }; }
    }
    return null;
  }

  // 定格 rating のブレーカーに対する表の値。630A 超は表外（null）。「—」は変圧器に対し過大な定格 → 行の最大値
  function jisAt(row, rating) {
    const R = D.jisC4620.ratings;
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
        const max = f.af;
        const j = jis ? jisAt(jis, max) : null;
        const need = j ? j.ka : iscKa;
        let hit = null;
        let best = null;
        f.models.forEach(function (b) {
          if (!hit && b.icu[col] >= need) { hit = b; }
          if (!best || b.icu[col] > best.icu[col]) { best = b; }
        });
        const pickB = hit || best;
        const ratings = pickB.ratings.filter(function (r) { return r <= max; });
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
      todo: {
        three: c3, single: c1, row: row, freq: freq, split: split, maker: maker, name: M.name, source: M.source,
        warn: split.overSingle ? ['単相負荷として無条件に使用できるのは ' + split.overSingle + 'kVA 以下です。超える場合は設備全体の不平衡率を30%以下としてください（内線規程 1305節、' + M.name + '）。'] : []
      },
      eb: eb
    });
  }

  function calculate(input) {
    if (input.mode === 'todo') { return calculateTodo(input); }
    const mode = normMode(input);
    const kva = Number(input.kva);
    const v1 = Number(input.v1);
    const v2 = Number(input.v2);
    if (!(kva > 0) || !(v1 > 0) || !(v2 > 0)) {
      throw new Error('容量・一次電圧・二次電圧を正しく入力してください。');
    }
    const trType = input.trType === 'mold' ? 'mold' : 'oil';
    const kva1 = mode === 'three' && Number(input.kva1) > 0 ? Number(input.kva1) : 0;
    const hv = v1 > LV_MAX;
    const zInput = Number(input.z);
    const zTr = zInput > 0 ? zInput : defaultZ(mode, kva, v2);
    const iscIn = Number(input.iscKa) > 0 ? Number(input.iscKa) : 0;
    const zSrc = sourceZ(mode, kva, v1, iscIn);
    const zTotal = zTr + zSrc;

    const circuits = mode === 'scott' ? 2 : 1;
    const i1 = ratedCurrent(mode === 'single' ? 1 : 3, kva, v1);
    // スコットは M座・T座 各 kVA/2 の単相回路
    const i2 = mode === 'three' ? ratedCurrent(3, kva, v2) : ratedCurrent(1, kva / circuits, v2);
    const iscKa = i2 * 100 / zTotal / 1000;

    const fuse = hv ? selectFuse(mode, kva, v1, trType, kva1) : null;
    let primaryBreaker = null;
    if (!hv) {
      primaryBreaker = selectBreaker(i1 * D.breaker.primaryFactor, iscIn, v1);
      primaryBreaker.iscGiven = iscIn > 0;
    }
    const ct = selectCT(i2);
    const thr = selectTHR(i2, ct.primary);
    // 遮断容量の基準：キュービクルは JIS C 4620 解説表1 を優先（適用できない条件は計算値）
    const jis = input.iscBasis === 'calc' ? null : jisRow(mode, kva, v1, v2, input.freq);
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
      input: { mode: mode, kva: kva, v1: v1, v2: v2, trType: trType, kva1: kva1 },
      hv: hv, circuits: circuits,
      z: { tr: zTr, trIsDefault: !(zInput > 0), src: zSrc, total: zTotal },
      i1: i1, i2: i2, iscKa: iscKa, jis: jis,
      fuse: fuse, primaryBreaker: primaryBreaker, ct: ct, thr: thr, breaker: brk, branch: branch,
      conductor: { design: design, byBreaker: !!brk, cable: selectCable(design, D.busCable.tables), busbar: selectBusbar(design) },
      eb: Object.assign(selectEB(mode, kva, v2, ebMax), { maxA: ebMax, maxByMain: !!brk, i2: i2 })
    };
  }

  const api = {
    calculate: calculate, ratedCurrent: ratedCurrent, defaultZ: defaultZ, sourceZ: sourceZ,
    pickAtLeast: pickAtLeast, todoRow: todoRow, jisRow: jisRow, jisAt: jisAt, todoSplit: todoSplit, selectCable: selectCable, selectBusbar: selectBusbar,
    selectBreaker: selectBreaker, selectBranch: selectBranch, selectCT: selectCT, selectTHR: selectTHR, selectFuse: selectFuse,
    selectEB: selectEB, data: D
  };
  root.TRCalc = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof self !== 'undefined' ? self : this);
