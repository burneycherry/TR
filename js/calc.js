/*
 * 変圧器 周辺機器選定 計算ロジック（DOM非依存・Nodeでもテスト可）
 */
(function (root) {
  'use strict';

  const D = (typeof TR_DATA !== 'undefined') ? TR_DATA : require('./data.js');
  const SQRT3 = Math.sqrt(3);

  // 昇順配列から value 以上の最小値。無ければ null
  function pickAtLeast(list, value) {
    for (let i = 0; i < list.length; i++) {
      if (list[i] >= value) { return list[i]; }
    }
    return null;
  }

  function defaultZ(phase, kva) {
    const t = D.defaultZ[phase === 1 ? 'single' : 'three'];
    let z = t[0][1];
    for (let i = 0; i < t.length; i++) {
      if (kva >= t[i][0]) { z = t[i][1]; }
    }
    return z;
  }

  // 定格電流 [A]
  function ratedCurrent(phase, kva, volt) {
    return phase === 1 ? kva * 1000 / volt : kva * 1000 / (SQRT3 * volt);
  }

  // 電源側 %Z（変圧器容量基準）。iscKa: 一次側三相短絡電流 [kA]
  function sourceZ(phase, kva, v1, iscKa) {
    if (!iscKa || iscKa <= 0) { return 0; }
    // 単相変圧器は線間に接続 → 線間短絡電流 = √3/2 × 三相短絡電流
    const sccKva = phase === 1 ? v1 * (SQRT3 / 2) * iscKa : SQRT3 * v1 * iscKa;
    return kva / sccKva * 100;
  }

  function selectFuse(phase, kva, v1, i1) {
    const L = D.lbs;
    const warn = [];
    const limit = phase === 1 ? L.maxKvaSingle : L.maxKvaThree;
    if (L.voltages.indexOf(v1) < 0) {
      warn.push('一次電圧 ' + v1 + 'V は7.2kV級LBS・PFの適用外です。');
    }
    if (kva > limit) {
      warn.push('変圧器 ' + limit + 'kVA 超は LBS(PF付) ではなく VCB+OCR 等での保護が一般的です（高圧受電設備規程）。');
    }
    const makers = {};
    Object.keys(L.makers).forEach(function (k) {
      const m = L.makers[k];
      const need = i1 * m.factor;
      makers[k] = {
        name: m.name, fuse: m.fuse, factor: m.factor, need: need,
        rating: pickAtLeast(m.series, need), verified: m.verified
      };
    });
    return { makers: makers, warn: warn };
  }

  function selectCT(i2) {
    const need = i2 * D.ct.factor;
    const p = pickAtLeast(D.ct.primaries, need);
    return { need: need, primary: p, secondary: D.ct.secondary, ratio: p ? p + '/' + D.ct.secondary + 'A' : null };
  }

  function selectTHR(i2, ctPrimary) {
    if (!ctPrimary) { return null; }
    const setting = i2 * D.ct.secondary / ctPrimary;
    const makers = {};
    Object.keys(D.thr.makers).forEach(function (k) {
      const m = D.thr.makers[k];
      let best = null;
      m.heaters.forEach(function (h) {
        if (setting >= h[1] && setting <= h[2]) {
          // 調整範囲の中央に近いものを優先
          const score = Math.abs(setting - (h[1] + h[2]) / 2);
          if (!best || score < best.score) { best = { nominal: h[0], min: h[1], max: h[2], score: score }; }
        }
      });
      makers[k] = { name: m.name, model: m.model, heater: best, verified: m.verified };
    });
    return { setting: setting, makers: makers };
  }

  function selectCable(current) {
    const t = D.cable.table;
    for (let n = 1; n <= D.cable.maxParallel; n++) {
      for (let i = 0; i < t.length; i++) {
        if (t[i][1] * n >= current) {
          return { sq: t[i][0], ampacity: t[i][1], parallel: n, total: t[i][1] * n };
        }
      }
    }
    return null;
  }

  function selectBusbar(current) {
    const t = D.busbar.table;
    for (let i = 0; i < t.length; i++) {
      if (t[i][1] >= current) { return { size: t[i][0], ampacity: t[i][1] }; }
    }
    return null;
  }

  // 主幹ブレーカー：定格電流 ≥ need、Icu ≥ 短絡電流 の最小フレーム・最下位グレード
  function selectBreaker(need, iscKa, v2) {
    const col = v2 <= 240 ? 0 : 1;
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
      makers[k] = { name: m.name, series: m.series, pick: hit, verified: m.verified };
    });
    return { need: need, voltClass: col === 0 ? 'AC230V級' : 'AC440V級', makers: makers };
  }

  /*
   * input: { phase: 1|3, kva, v1, v2, z (省略可), iscKa (省略可) }
   */
  function calculate(input) {
    const phase = input.phase === 1 ? 1 : 3;
    const kva = Number(input.kva);
    const v1 = Number(input.v1);
    const v2 = Number(input.v2);
    if (!(kva > 0) || !(v1 > 0) || !(v2 > 0)) {
      throw new Error('容量・一次電圧・二次電圧を正しく入力してください。');
    }
    const zInput = Number(input.z);
    const zTr = zInput > 0 ? zInput : defaultZ(phase, kva);
    const zSrc = sourceZ(phase, kva, v1, Number(input.iscKa));
    const zTotal = zTr + zSrc;

    const i1 = ratedCurrent(phase, kva, v1);
    const i2 = ratedCurrent(phase, kva, v2);
    const iscKa = i2 * 100 / zTotal / 1000;

    const fuse = selectFuse(phase, kva, v1, i1);
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
      input: { phase: phase, kva: kva, v1: v1, v2: v2 },
      z: { tr: zTr, trIsDefault: !(zInput > 0), src: zSrc, total: zTotal },
      i1: i1, i2: i2, iscKa: iscKa,
      fuse: fuse, ct: ct, thr: thr, breaker: brk,
      conductor: { design: design, cable: selectCable(design), busbar: selectBusbar(design) }
    };
  }

  const api = {
    calculate: calculate, ratedCurrent: ratedCurrent, defaultZ: defaultZ, sourceZ: sourceZ,
    pickAtLeast: pickAtLeast, selectCable: selectCable, selectBusbar: selectBusbar,
    selectBreaker: selectBreaker, selectCT: selectCT, selectTHR: selectTHR, data: D
  };
  root.TRCalc = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof self !== 'undefined' ? self : this);
