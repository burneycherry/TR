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

test('LBSヒューズ：300kVA超で警告、22kVで表外', () => {
  assert.strictEqual(C.calculate({ phase: 3, kva: 300, v1: 6600, v2: 210 }).fuse.warn.length, 0);
  assert.ok(C.calculate({ phase: 3, kva: 500, v1: 6600, v2: 210 }).fuse.warn.length > 0);
  const r = C.calculate({ phase: 3, kva: 100, v1: 22000, v2: 210 });
  assert.strictEqual(r.fuse.mitsubishi.ok, false);
  assert.strictEqual(r.fuse.fuji.ok, false);
});

test('三菱 表5(1) 転記値', () => {
  const f = (mode, kva, v1) => C.calculate({ mode: mode, kva: kva, v1: v1, v2: 210 }).fuse.mitsubishi;
  assert.strictEqual(f('three', 300, 6600).min, 'G50 (T30)A');
  assert.strictEqual(f('three', 300, 6600).max, 'G75 (T60)A');
  assert.strictEqual(f('three', 100, 6600).min, 'G30 (T15)A');
  assert.strictEqual(f('single', 50, 6600).min, 'G30 (T15)A');
  assert.strictEqual(f('three', 300, 3300).min, 'G75 (T60)A');
  assert.strictEqual(f('three', 4000, 6600).min, 'CLS形 M400A');
  assert.strictEqual(f('three', 5, 6600).ok, false);
  // 表にない容量は直近上位
  const g = f('three', 400, 6600);
  assert.strictEqual(g.row, 500);
  assert.strictEqual(g.approx, true);
});

test('三菱 表5(2) 一括用', () => {
  // 三相100kVA(8.75A)+単相50kVA(7.58A)=16.3A → 20A以下 → G40(T20)
  const r = C.calculate({ mode: 'three', kva: 100, kva1: 50, v1: 6600, v2: 210 });
  assert.strictEqual(r.fuse.mitsubishi.value, 'G40 (T20)A');
});

test('富士 JC 標準選定表（油入/モールド）', () => {
  const f = (o) => C.calculate(Object.assign({ v1: 6600, v2: 210 }, o)).fuse.fuji;
  assert.strictEqual(f({ mode: 'three', kva: 300, trType: 'oil' }).value, 'G50A');
  assert.strictEqual(f({ mode: 'three', kva: 100, kva1: 50, trType: 'oil' }).value, 'G30A');
  assert.strictEqual(f({ mode: 'three', kva: 200, kva1: 150, trType: 'oil' }).value, 'G75A');
  assert.strictEqual(f({ mode: 'three', kva: 200, kva1: 150, trType: 'mold' }).value, 'G60A');
  assert.strictEqual(f({ mode: 'single', kva: 200, trType: 'oil' }).value, 'G50A');
  assert.strictEqual(f({ mode: 'single', kva: 200, trType: 'mold' }).value, 'G60A');
  assert.strictEqual(f({ mode: 'three', kva: 1000, trType: 'mold' }).value, 'G100A');
  assert.strictEqual(f({ mode: 'three', kva: 1000, trType: 'oil' }).ok, false);
  assert.strictEqual(f({ mode: 'three', kva: 100, v1: 3300, trType: 'oil' }).value, 'G40A');
  assert.strictEqual(f({ mode: 'three', kva: 100, v1: 3300, trType: 'mold' }).value, 'G30A');
});

test('富士 表の行列サイズ整合', () => {
  const fj = C.data.lbs.makers.fuji;
  ['oil', 'mold'].forEach((t) => Object.values(fj[t]).forEach((tb) => {
    assert.strictEqual(tb.g.length, tb.rows.length);
    tb.g.forEach((r) => assert.strictEqual(r.length, tb.cols.length));
  }));
});

test('スコット 高圧/低圧：2回路・各 kVA/2', () => {
  const r = C.calculate({ mode: 'scott', kva: 100, v1: 6600, v2: 210 });
  assert.strictEqual(r.circuits, 2);
  near(r.i1, 100000 / (Math.sqrt(3) * 6600), 1e-9);
  near(r.i2, 50000 / 210, 1e-9);
  assert.ok(r.fuse && r.fuse.mitsubishi.ok);
  assert.strictEqual(r.primaryBreaker, null);
  assert.strictEqual(r.eb.phaseKva, 50);
});

test('スコット 低圧/低圧：一次側ブレーカー、LBS・EBなし', () => {
  const r = C.calculate({ mode: 'scott', kva: 50, v1: 440, v2: 210, iscKa: 10 });
  assert.strictEqual(r.fuse, null);
  assert.strictEqual(r.eb, null);
  near(r.i1, 50000 / (Math.sqrt(3) * 440), 1e-9);
  Object.values(r.primaryBreaker.makers).forEach((m) => {
    assert.ok(m.pick.rating >= r.i1 * C.data.breaker.primaryFactor);
    assert.ok(m.pick.icu >= 10);
  });
});

test('EB サイズ', () => {
  assert.strictEqual(C.selectEB('three', 300, 210).sq, 38); // 一相100kVA・200V級
  assert.strictEqual(C.selectEB('three', 300, 440).sq, 22); // 一相100kVA・400V級
  assert.strictEqual(C.selectEB('single', 50, 210).sq, 22);
  assert.strictEqual(C.selectEB('single', 50, 105).sq, 38);
});

test('手入力電圧（任意値）でも計算できる', () => {
  const r = C.calculate({ mode: 'three', kva: 75, v1: 6900, v2: 460 });
  near(r.i2, 75000 / (Math.sqrt(3) * 460), 1e-9);
  assert.ok(r.fuse.mitsubishi.ok);
});

test('CT・THR', () => {
  const r = C.calculate({ phase: 3, kva: 300, v1: 6600, v2: 210 });
  assert.strictEqual(r.ct.ratio, '1200/5A');
  near(r.thr.raw, 824.8 * 5 / 1200, 0.01);
  assert.strictEqual(r.thr.setting, 3.4);
  assert.strictEqual(r.thr.model, 'TU-0');
});

test('THR 例：単相100kVA 210V → CT 600/5A、TU-0 3.9A', () => {
  const r = C.calculate({ mode: 'single', kva: 100, v1: 6600, v2: 210 });
  assert.strictEqual(r.ct.ratio, '600/5A');
  assert.strictEqual(r.thr.setting, 3.9);
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
  r.conductor.cable.forEach((c) => assert.ok(c.limit * c.parallel >= r.conductor.design, c.name));
  assert.ok(r.conductor.busbar.ampacity >= r.conductor.design);
});

test('電線規準・銅バー規準の転記値', () => {
  const byName = (cur) => C.selectCable(cur).map((c) => c.sq + 'x' + c.parallel);
  // [キュービクル60℃, キュービクル75℃]
  assert.deepStrictEqual(byName(225), ['100x1', '60x1']);
  assert.deepStrictEqual(byName(400), ['250x1', '150x1']);
  assert.deepStrictEqual(byName(100), ['38x1', '22x1']);
  assert.deepStrictEqual(byName(1000), ['200x3', '200x2']);
  assert.strictEqual(C.selectBusbar(800).size, '10t×50');
  assert.strictEqual(C.selectBusbar(1250).size, '10t×100');
  assert.strictEqual(C.selectBusbar(4000).size, '15t×150×2');
  assert.strictEqual(C.selectBusbar(5000), null);
});

test('全標準容量で例外なく計算できる', () => {
  for (const p of [1, 3]) {
    const caps = C.data.capacities[p === 1 ? 'single' : 'three'];
    for (const kva of caps) {
      for (const v2 of [210, 440]) { C.calculate({ phase: p, kva: kva, v1: 6600, v2: v2 }); }
    }
  }
  for (const kva of C.data.capacities.scott) {
    for (const v1 of [6600, 3300, 440]) {
      for (const trType of ['oil', 'mold']) { C.calculate({ mode: 'scott', kva: kva, v1: v1, v2: 210, trType: trType }); }
    }
  }
});

test('不正入力はエラー', () => {
  assert.throws(() => C.calculate({ phase: 3, kva: 0, v1: 6600, v2: 210 }));
});

test('データ表は昇順', () => {
  const asc = (a) => a.every((v, i) => i === 0 || a[i - 1] < v);
  assert.ok(asc(C.data.ct.primaries));
  C.data.cable.tables.forEach((t) => {
    assert.ok(asc(t.limits)); assert.ok(asc(t.sizes)); assert.strictEqual(t.limits.length, t.sizes.length);
  });
  assert.ok(asc(C.data.busbar.table.map((x) => x[1])));
  const mi = C.data.lbs.makers.mitsubishi;
  [mi.single[3300], mi.single[6600], mi.three[3300], mi.three[6600]].forEach((t) => assert.ok(asc(t.map((x) => x[0]))));
  assert.ok(asc(mi.combined.map((x) => x[0])));
});
