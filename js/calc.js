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
    return input.phase === 1 ? 'single' : 'three';
  }

  function defaultZ(mode, kva) {
    const t = D.defaultZ[mode === 'single' || mode === 1 ? 'single' : 'three'];
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
    const total = kva + (mode === 'three' && kva1 > 0 ? kva1 : 0);
    if (total > L.maxKva) {
      warn.push('LBS(PF付)で開閉する変圧器は ' + L.maxKva + 'kVA 以下が目安です（高圧受電設備規程）。VCB+OCR 等を検討してください。');
    }
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
    return { need: need, primary: p, secondary: D.ct.secondary, ratio: p ? p + '/' + D.ct.secondary + 'A' : null };
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

  // 電線規準の各表で選定。単条で収まらなければ並列条数を増やす
  function selectCable(current) {
    return D.cable.tables.map(function (t) {
      for (let n = 1; n <= D.cable.maxParallel; n++) {
        for (let i = 0; i < t.limits.length; i++) {
          if (t.limits[i] * n >= current) {
            return { group: t.group, temp: t.temp, name: t.name, basis: t.basis, sq: t.sizes[i], limit: t.limits[i], parallel: n };
          }
        }
      }
      return { group: t.group, temp: t.temp, name: t.name, basis: t.basis, sq: null };
    });
  }

  function selectBusbar(current) {
    const t = D.busbar.table;
    for (let i = 0; i < t.length; i++) {
      if (t[i][1] >= current) { return { size: t[i][0], ampacity: t[i][1] }; }
    }
    return null;
  }

  // ブレーカー：定格電流 ≥ need、Icu ≥ 短絡電流 の最小フレーム・最下位グレード
  function selectBreaker(need, iscKa, volt) {
    const col = volt <= 240 ? 0 : 1;
    const makers = {};
    Object.keys(D.breaker.makers).forEach(function (k) {
      const m = D.breaker.makers[k];
      let hit = null;
      for (let i = 0; i < m.list.length && !hit; i++) {
        const b = m.list[i];
        const r = pickAtLeast(b.ratings, need);
        if (r !== null && b.icu[col] >= iscKa) {
          hit = { model: b.model, af: b.af, rating: r, icu: b.icu[col] };
        }
      }
      makers[k] = { name: m.name, series: m.series, pick: hit, overNote: m.overNote || '', verified: m.verified };
    });
    return { need: need, iscKa: iscKa, voltClass: col === 0 ? 'AC230V級' : 'AC440V級', makers: makers };
  }

  // B種接地線(EB)
  function selectEB(mode, kva, v2) {
    const phaseKva = mode === 'three' ? kva / 3 : (mode === 'scott' ? kva / 2 : kva);
    const col = v2 <= 150 ? 0 : (v2 <= 300 ? 1 : 2);
    const t = D.eb.table;
    for (let i = 0; i < t.length; i++) {
      if (phaseKva <= t[i][col]) {
        return { phaseKva: phaseKva, voltClass: ['100V級', '200V級', '400V級'][col], sq: t[i][3], verified: D.eb.verified };
      }
    }
    return { phaseKva: phaseKva, voltClass: ['100V級', '200V級', '400V級'][col], sq: null, verified: D.eb.verified };
  }

  /*
   * input: { mode: 'single'|'three'|'scott'（旧: phase 1|3）, kva, v1, v2,
   *          z, iscKa, trType: 'oil'|'mold', kva1（三相と一括でLBSを共用する単相kVA） }
   */
  function calculate(input) {
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
    const zTr = zInput > 0 ? zInput : defaultZ(mode, kva);
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
    const brk = selectBreaker(i2 * D.breaker.factor, iscKa, v2);

    // 幹線は主幹ブレーカー定格以上で選ぶ（各社の大きい方）
    let design = i2;
    Object.keys(brk.makers).forEach(function (k) {
      const p = brk.makers[k].pick;
      if (p && p.rating > design) { design = p.rating; }
    });

    return {
      input: { mode: mode, kva: kva, v1: v1, v2: v2, trType: trType, kva1: kva1 },
      hv: hv, circuits: circuits,
      z: { tr: zTr, trIsDefault: !(zInput > 0), src: zSrc, total: zTotal },
      i1: i1, i2: i2, iscKa: iscKa,
      fuse: fuse, primaryBreaker: primaryBreaker, ct: ct, thr: thr, breaker: brk,
      conductor: { design: design, cable: selectCable(design), busbar: selectBusbar(design) },
      eb: hv ? selectEB(mode, kva, v2) : null
    };
  }

  const api = {
    calculate: calculate, ratedCurrent: ratedCurrent, defaultZ: defaultZ, sourceZ: sourceZ,
    pickAtLeast: pickAtLeast, selectCable: selectCable, selectBusbar: selectBusbar,
    selectBreaker: selectBreaker, selectCT: selectCT, selectTHR: selectTHR, selectFuse: selectFuse,
    selectEB: selectEB, data: D
  };
  root.TRCalc = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof self !== 'undefined' ? self : this);
