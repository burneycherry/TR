// 実行: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const C = require('../js/calc.js');

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, a + ' ≠ ' + b);

test('三相 300kVA 6600/210V の定格電流', () => {
  const r = C.calculate({ phase: 3, kva: 300, v1: 6600, v2: 210 });
  near(r.i1, 26.24, 0.01);
  near(r.i2, 824.8, 0.1);
});

test('単相 50kVA 6600/210V の定格電流', () => {
  const r = C.calculate({ phase: 1, kva: 50, v1: 6600, v2: 210 });
  near(r.i1, 7.576, 0.001);
  near(r.i2, 238.1, 0.1);
});

test('%Z 入力時の短絡電流（無限大母線）', () => {
  const r = C.calculate({ phase: 3, kva: 500, v1: 6600, v2: 210, z: 4 });
  near(r.iscKa, 1374.6 * 100 / 4 / 1000, 0.01);
  assert.strictEqual(r.z.trIsDefault, false);
});

test('%Z 未入力は標準値を使用', () => {
  const r = C.calculate({ phase: 3, kva: 300, v1: 6600, v2: 210 });
  assert.strictEqual(r.z.tr, 3.0);
  assert.strictEqual(r.z.trIsDefault, true);
});

test('電源側インピーダンスで短絡電流が減る', () => {
  const a = C.calculate({ phase: 3, kva: 1000, v1: 6600, v2: 210, z: 5 });
  const b = C.calculate({ phase: 3, kva: 1000, v1: 6600, v2: 210, z: 5, iscKa: 12.5 });
  assert.ok(b.iscKa < a.iscKa);
  near(b.z.src, 1000 / (Math.sqrt(3) * 6600 * 12.5) * 100, 1e-9);
});

test('LBSヒューズ：300kVA超で警告、22kVで適用外警告', () => {
  assert.strictEqual(C.calculate({ phase: 3, kva: 300, v1: 6600, v2: 210 }).fuse.warn.length, 0);
  assert.ok(C.calculate({ phase: 3, kva: 500, v1: 6600, v2: 210 }).fuse.warn.length > 0);
  assert.ok(C.calculate({ phase: 3, kva: 100, v1: 22000, v2: 210 }).fuse.warn.length > 0);
});

test('ヒューズ定格は一次電流×係数以上', () => {
  const r = C.calculate({ phase: 3, kva: 100, v1: 6600, v2: 210 });
  Object.values(r.fuse.makers).forEach((m) => assert.ok(m.rating >= r.i1 * m.factor));
});

test('CT・THR', () => {
  const r = C.calculate({ phase: 3, kva: 300, v1: 6600, v2: 210 });
  assert.strictEqual(r.ct.ratio, '1200/5A');
  near(r.thr.setting, 824.8 * 5 / 1200, 0.01);
  Object.values(r.thr.makers).forEach((m) => {
    assert.ok(m.heater, m.name + ' heater');
    assert.ok(m.heater.min <= r.thr.setting && r.thr.setting <= m.heater.max);
  });
});

test('ブレーカーは定格・遮断容量を満たす', () => {
  for (const kva of [20, 50, 100, 300, 500, 1000, 1500]) {
    const r = C.calculate({ phase: 3, kva: kva, v1: 6600, v2: 210 });
    Object.values(r.breaker.makers).forEach((m) => {
      if (!m.pick) { return; }
      assert.ok(m.pick.rating >= r.i2, kva + 'kVA rating');
      assert.ok(m.pick.icu >= r.iscKa, kva + 'kVA icu');
    });
  }
});

test('電線・銅バーは設計電流以上', () => {
  const r = C.calculate({ phase: 3, kva: 750, v1: 6600, v2: 210 });
  assert.ok(r.conductor.cable.total >= r.conductor.design);
  assert.ok(r.conductor.busbar.ampacity >= r.conductor.design);
});

test('全標準容量で例外なく計算できる', () => {
  for (const p of [1, 3]) {
    const caps = C.data.capacities[p === 1 ? 'single' : 'three'];
    for (const kva of caps) {
      for (const v2 of [210, 440]) { C.calculate({ phase: p, kva: kva, v1: 6600, v2: v2 }); }
    }
  }
});

test('不正入力はエラー', () => {
  assert.throws(() => C.calculate({ phase: 3, kva: 0, v1: 6600, v2: 210 }));
});

test('データ表は昇順', () => {
  const asc = (a) => a.every((v, i) => i === 0 || a[i - 1] < v);
  assert.ok(asc(C.data.ct.primaries));
  assert.ok(asc(C.data.cable.table.map((x) => x[1])));
  assert.ok(asc(C.data.busbar.table.map((x) => x[1])));
  Object.values(C.data.lbs.makers).forEach((m) => assert.ok(asc(m.series)));
});
