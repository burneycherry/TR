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
  assert.strictEqual(r.z.tr, 2.9); // 富士トップランナー 300kVA
  assert.strictEqual(r.z.trIsDefault, true);
  assert.strictEqual(C.defaultZ('three', 2000, 210), 5.8);
  assert.strictEqual(C.defaultZ('three', 2000, 420), 4.2);
  assert.strictEqual(C.defaultZ('single', 75, 210), 1.8);
});

test('電源側インピーダンスで短絡電流が減る', () => {
  const a = C.calculate({ phase: 3, kva: 1000, v1: 6600, v2: 210, z: 5 });
  const b = C.calculate({ phase: 3, kva: 1000, v1: 6600, v2: 210, z: 5, iscKa: 12.5 });
  assert.ok(b.iscKa < a.iscKa);
  near(b.z.src, 1000 / (Math.sqrt(3) * 6600 * 12.5) * 100, 1e-9);
});

test('LBSヒューズ：容量による警告なし、22kVで表外', () => {
  assert.strictEqual(C.calculate({ phase: 3, kva: 300, v1: 6600, v2: 210 }).fuse.warn.length, 0);
  assert.strictEqual(C.calculate({ phase: 3, kva: 1000, v1: 6600, v2: 210 }).fuse.warn.length, 0);
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

test('スコット 低圧/低圧：一次側ブレーカー、LBSなし、EBは表示', () => {
  const r = C.calculate({ mode: 'scott', kva: 50, v1: 440, v2: 210, iscKa: 10 });
  assert.strictEqual(r.fuse, null);
  assert.strictEqual(r.eb.phaseKva, 25); // スコット＝定格÷2
  assert.strictEqual(r.eb.label, '14mm²'); // 200V級 25kVA→表2.13.1 14mm²
  near(r.i1, 50000 / (Math.sqrt(3) * 440), 1e-9);
  Object.values(r.primaryBreaker.makers).forEach((m) => {
    assert.ok(m.pick.rating >= r.i1 * C.data.breaker.primaryFactor);
    assert.ok(m.pick.icu >= 10);
  });
});

test('EB：表2.13.1 で選定し、ブレーカー定格によるサイズアップ（表2.13.2）を併記', () => {
  // 三相100kVA 210V：一相33.3kVA・200V級 → 14mm²。250A以下はそのまま、400A以下22・600A以下38・1000A以下60
  const r1 = C.calculate({ mode: 'three', kva: 100, v1: 6600, v2: 210, mainBreaker: true });
  assert.strictEqual(r1.eb.label, '14mm²'); // 主幹の有無で変えない
  assert.strictEqual(r1.eb.baseMax, 250);
  // 主幹 300A → 250A超〜300A（22mm²）まで
  assert.strictEqual(r1.eb.maxA, 300);
  assert.deepStrictEqual(r1.eb.sizeUp.map((u) => u.from + '-' + u.to + ':' + u.label), ['250-300:22mm²']);
  // 主幹なし：二次 274.9A 以下の最大分岐 250A → 14mm² のまま（サイズアップなし）
  const rn = C.calculate({ mode: 'three', kva: 100, v1: 6600, v2: 210 });
  assert.strictEqual(rn.eb.maxA, 250);
  assert.strictEqual(rn.eb.sizeUp.length, 0);
  assert.strictEqual(rn.eb.label, '14mm²');
  // 主幹なし 三相200kVA 210V（549.9A）：表2.13.1 22mm²、最大分岐 500A → 400A超〜500A 38mm²
  const r20 = C.calculate({ mode: 'three', kva: 200, v1: 6600, v2: 210 });
  assert.strictEqual(r20.eb.label, '22mm²');
  assert.strictEqual(r20.eb.maxA, 500);
  assert.deepStrictEqual(r20.eb.sizeUp.map((u) => u.from + '-' + u.to + ':' + u.label), ['400-500:38mm²']);
  assert.deepStrictEqual(C.selectEB('three', 100, 210).sizeUp.map((u) => u.label), ['22mm²', '38mm²', '60mm²', '100mm²', '150mm²']);
  // 単相10kVA：5.5mm²（100A以下）→ 150A以下 8mm² から
  const r0 = C.calculate({ mode: 'single', kva: 10, v1: 6600, v2: 210 });
  assert.strictEqual(r0.eb.label, '5.5mm²');
  assert.strictEqual(r0.eb.baseMax, 100);
  // 二次 47.6A ≤ 100A → サイズアップなし
  assert.strictEqual(r0.eb.sizeUp.length, 0);
  assert.strictEqual(C.selectEB('single', 10, 210).sizeUp[0].label, '8mm²');
  // 三相1000kVA 210V：100mm²。1600A以下 100mm²（令和4年版）はそのまま、2500A以下 150mm²（令和4年版）でサイズアップ
  const r2 = C.selectEB('three', 1000, 210);
  assert.strictEqual(r2.label, '100mm²');
  assert.strictEqual(r2.baseMax, 1600);
  assert.deepStrictEqual(r2.sizeUp.map((u) => u.from + '-' + u.to + ':' + u.label + ':' + u.r4), ['1600-2500:150mm²:true']);
  assert.strictEqual(C.selectEB('three', 1000, 210, 2000).sizeUp[0].to, 2000);
  // 三相1500kVA 210V：一相500kVA → 150mm²（表2.13.2 最大 2500A 150mm² と同じ）→ サイズアップなし
  assert.strictEqual(C.selectEB('three', 1500, 210).sizeUp.length, 0);
});

test('標準容量（日立ラインアップ／単相750・1000追加）', () => {
  assert.deepStrictEqual(C.data.capacities.single.slice(-2), [750, 1000]);
  assert.deepStrictEqual(C.data.capacities.scott, [10, 20, 30, 50, 75, 100, 150, 200]);
  assert.strictEqual(C.data.capacities.three[0], 20);
  assert.strictEqual(C.data.capacities.three.slice(-1)[0], 2000);
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

test('CT：Y-0550 の定格一次電流（1φ20kVA → 120/5A）', () => {
  const r = C.calculate({ mode: 'single', kva: 20, v1: 6600, v2: 210 });
  assert.strictEqual(r.ct.ratio, '120/5A'); // 95.2A × 1.25 = 119A
  assert.strictEqual(r.ct.model.name, 'CW-15L / CW-15LM');
  assert.strictEqual(C.selectCT(30).ratio, '40/5A');
  assert.strictEqual(C.selectCT(130).ratio, '200/5A'); // 160/180/240A は使わない
  [160, 180, 240].forEach((a) => assert.ok(C.data.ct.primaries.indexOf(a) < 0));
  assert.strictEqual(C.selectCT(700).model.name, 'CW-40LM');
});

test('THR 例：単相100kVA 210V → CT 600/5A、TU-0 3.9A', () => {
  const r = C.calculate({ mode: 'single', kva: 100, v1: 6600, v2: 210 });
  assert.strictEqual(r.ct.ratio, '600/5A');
  assert.strictEqual(r.thr.setting, 3.9);
});

test('ブレーカーは定格・遮断容量を満たす', () => {
  for (const kva of [20, 50, 100, 300, 500, 1000, 1500]) {
    const r = C.calculate({ phase: 3, kva: kva, v1: 6600, v2: 210, mainBreaker: true });
    Object.values(r.breaker.makers).forEach((m) => {
      if (!m.pick) { return; }
      assert.ok(m.pick.rating >= r.i2, kva + 'kVA rating');
      assert.ok(m.pick.icu >= r.iscKa, kva + 'kVA icu');
    });
  }
});

test('THR 整定値は常に換算値以下（切り捨て）', () => {
  for (const mode of ['single', 'three', 'scott']) {
    for (const kva of [5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000]) {
      for (const v2 of [105, 210, 220, 440]) {
        const r = C.calculate({ mode: mode, kva: kva, v1: 6600, v2: v2 });
        if (!r.thr) { continue; }
        assert.ok(r.thr.setting <= r.thr.raw + 1e-9, mode + kva + ':' + r.thr.setting + '>' + r.thr.raw);
        assert.ok(r.thr.raw - r.thr.setting < 0.1 + 1e-9);
      }
    }
  }
});

test('主幹ブレーカー：カタログ転記値で選定', () => {
  const pick = (o) => {
    const r = C.calculate(Object.assign({ v1: 6600, mainBreaker: true }, o)).breaker.makers;
    return [r.mitsubishi.pick && r.mitsubishi.pick.model + ' ' + r.mitsubishi.pick.rating,
      r.fuji.pick && r.fuji.pick.model + ' ' + r.fuji.pick.rating];
  };
  // 三相100kVA 210V：274.9A・11.95kA
  assert.deepStrictEqual(pick({ mode: 'three', kva: 100, v2: 210 }), ['NF400-CW 300', 'BW400EAG 300']);
  // 単相100kVA 210V：476.2A・20.7kA
  assert.deepStrictEqual(pick({ mode: 'single', kva: 100, v2: 210 }), ['NF630-CW 500', 'BW630EAG 500']);
  // 三相500kVA 440V：656A・18.7kA(440V級)
  assert.deepStrictEqual(pick({ mode: 'three', kva: 500, v2: 440 }), ['NF800-CEW 700', 'BW800EAG 700']);
  // 三相300kVA 210V：824.8A → 1000AF
  assert.deepStrictEqual(pick({ mode: 'three', kva: 300, v2: 210 }), ['NF1000-SEW 900', 'BW1000RAE 900']);
  // 三相1000kVA 210V：2749A・74.3kA → 三菱MCCBは1600AFまで、富士 BW3200RAE
  assert.deepStrictEqual(pick({ mode: 'three', kva: 1000, v2: 210 }), [null, 'BW3200RAE 2800']);
  const acb = (o) => {
    const r = C.calculate(Object.assign({ v1: 6600, mainBreaker: true }, o)).breaker.makers;
    return [r.mitsubishi.acb && r.mitsubishi.acb.model, r.fuji.acb && r.fuji.acb.model];
  };
  assert.deepStrictEqual(acb({ mode: 'three', kva: 1000, v2: 210 }), ['AE3200-SW', 'DH30']);
  // 三相2000kVA 210V：5499A・94.8kA → ACB 6300AF（富士 DH60 120kA、三菱 AE6300-SW 130kA）
  assert.strictEqual(pick({ mode: 'three', kva: 2000, v2: 210 })[1], null);
  assert.deepStrictEqual(acb({ mode: 'three', kva: 2000, v2: 210 }), ['AE6300-SW', 'DH60']);
  // 三相500kVA 210V %Z4：1375A・34.4kA → AE1600-SW / DH16
  assert.deepStrictEqual(acb({ mode: 'three', kva: 500, v2: 210, z: 4 }), ['AE1600-SW', 'DH16']);
  // 遮断容量で上位グレードへ：三相150kVA 210V %Z1.0 → 412A・41kA
  assert.deepStrictEqual(pick({ mode: 'three', kva: 150, v2: 210, z: 1.0 }), ['NF630-CW 500', 'BW630EAG 500']);
  const hi = pick({ mode: 'three', kva: 150, v2: 210, z: 0.5 }); // 82kA
  assert.deepStrictEqual(hi, ['NF630-SW 500', 'BW630RAG 500']);
});

test('ブレーカー表はフレーム昇順', () => {
  Object.values(C.data.breaker.makers).forEach((m) => {
    [m.list, m.acb].forEach((l) => l.forEach((b, i) => { if (i > 0) { assert.ok(l[i - 1].af <= b.af, b.model); } }));
  });
});

test('主幹ブレーカーは既定で不要、幹線は二次定格電流基準', () => {
  const r = C.calculate({ mode: 'three', kva: 100, v1: 6600, v2: 210 });
  assert.strictEqual(r.breaker, null);
  assert.strictEqual(r.conductor.byBreaker, false);
  near(r.conductor.design, r.i2, 1e-9);
});

test('分岐ブレーカー：フレーム別、二次定格電流を流せるフレームまで', () => {
  // 三相100kVA 210V：274.9A・Is=274.9/2.8%≒9.8kA
  const r = C.calculate({ mode: 'three', kva: 100, v1: 6600, v2: 210 });
  const mi = r.branch.makers.mitsubishi.rows.map((x) => x.af + 'AF:' + x.model);
  assert.deepStrictEqual(mi, ['63AF:NF63-SV', '125AF:NF125-CV', '225AF:NF250-CV', '400AF:NF400-CW']);
  const fj = r.branch.makers.fuji.rows.map((x) => x.af + 'AF:' + x.model);
  assert.deepStrictEqual(fj, ['50AF:BW50SAG', '63AF:BW63SAG', '100AF:BW100EAG', '125AF:BW125JAG', '250AF:BW250EAG', '400AF:BW400EAG']);
  // 単相10kVA 210V：47.6A → 63AF / 50AF までで打ち切り
  const s1 = C.calculate({ mode: 'single', kva: 10, v1: 6600, v2: 210 });
  assert.deepStrictEqual(s1.branch.makers.mitsubishi.rows.map((x) => x.af), [63]);
  assert.deepStrictEqual(s1.branch.makers.fuji.rows.map((x) => x.af), [50]);
  // 富士カタログ 4.4（3相210V 500kVA：短絡34.4kA → 125AF は J(50kA)、250AF は E(36kA)、400AF は E(50kA)）
  const r5 = C.calculate({ mode: 'three', kva: 500, v1: 6600, v2: 210, z: 4 });
  const f5 = {};
  r5.branch.makers.fuji.rows.forEach((x) => { f5[x.af] = x.model; });
  assert.strictEqual(f5[125], 'BW125JAG');
  assert.strictEqual(f5[250], 'BW250EAG'); // 36kA ≥ 34.4kA
  assert.strictEqual(f5[400], 'BW400EAG');
  assert.strictEqual(f5[50], 'BW50HAG');
  // 63AF は NF63-HRV(85kA)、富士 63AF/100AF は Icu 不足で該当なし
  assert.strictEqual(r5.branch.makers.mitsubishi.rows[0].model, 'NF63-HRV');
  const f63 = r5.branch.makers.fuji.rows.find((x) => x.af === 63);
  assert.strictEqual(f63.ok, false);
  // 全行 Icu ≥ Is
  [r, s1].forEach((x) => Object.values(x.branch.makers).forEach((m) => m.rows.forEach((row) => {
    assert.ok(row.ok && row.icu >= x.iscKa, row.model);
  })));
});

test('電線・銅バーは設計電流以上', () => {
  const r = C.calculate({ phase: 3, kva: 750, v1: 6600, v2: 210, mainBreaker: true });
  r.conductor.cable.forEach((c) => {
    if (c.sq === null) { return; }
    assert.ok(c.parallel === 1 ? c.limit >= r.conductor.design : c.limit >= r.conductor.design * 0.6, c.name);
  });
  assert.ok(r.conductor.busbar.ampacity >= r.conductor.design);
});

test('電線規準・銅バー規準の転記値', () => {
  const pick = (cur) => { const c = C.selectCable(cur).find((x) => x.temp === '75℃'); return c.sq === null ? null : c.sq + 'x' + c.parallel; };
  assert.deepStrictEqual(C.selectCable(100).map((x) => x.temp), ['60℃', '75℃']); // IV・FP 60℃ と 75℃
  const p60 = (cur) => { const c = C.selectCable(cur)[0]; return c.sq === null ? null : c.sq + 'x' + c.parallel; };
  assert.strictEqual(p60(20), '5.5x1'); // 3.5sq は使わない
  assert.strictEqual(p60(95.2), '38x1'); // 125A以下→38sq
  assert.strictEqual(p60(225), '100x1');
  assert.strictEqual(p60(700), '250x2'); // 420A ≤ 450A
  assert.strictEqual(p60(800), null); // 480A > 450A → 銅バーのみ
  // 最小 5.5sq（3.5sq は使わない）
  assert.strictEqual(pick(10), '5.5x1');
  assert.strictEqual(pick(30), '5.5x1');
  assert.strictEqual(pick(50), '5.5x1');
  assert.strictEqual(pick(100), '22x1');
  assert.strictEqual(pick(225), '60x1');
  assert.strictEqual(pick(400), '150x1');
  assert.strictEqual(pick(500), '200x1');
  // 2条：1本 ≥ 電流×0.6。1000A → 600A以下 → 250sq×2
  assert.strictEqual(pick(1000), '250x2');
  // 1200A → 720A > 700A → 電線不可（銅バーのみ）
  assert.strictEqual(pick(1200), null);
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

test('母線電線は許容電流表（IV・FP 60℃/HIV・EM-IE・EM-LMFC 75℃）で選定', () => {
  const T = C.data.busCable.tables;
  const pick = (cur, temp) => { const c = C.selectCable(cur, T).find((x) => x.temp === temp); return c.sq === null ? null : c.sq + 'x' + c.parallel; };
  // 単相100kVA 210V → 476.2A
  const r = C.calculate({ mode: 'single', kva: 100, v1: 6600, v2: 210 });
  assert.deepStrictEqual(r.conductor.cable.map((x) => x.temp), ['60℃', '75℃']);
  assert.strictEqual(pick(476.2, '60℃'), '325x1'); // 530A
  assert.strictEqual(pick(476.2, '75℃'), '200x1'); // 506A
  assert.strictEqual(pick(40, '60℃'), '5.5x1');
  assert.strictEqual(pick(52, '75℃'), '5.5x1');
  assert.strictEqual(pick(1000, '75℃'), '250x2'); // 600A ≥ 600A
  assert.strictEqual(pick(1200, '75℃'), null); // 720A > 702A → 銅バーのみ
});

test('データ表は昇順', () => {
  const asc = (a) => a.every((v, i) => i === 0 || a[i - 1] < v);
  assert.ok(asc(C.data.ct.primaries));
  C.data.cable.tables.concat(C.data.busCable.tables).forEach((t) => {
    assert.ok(asc(t.limits)); assert.ok(asc(t.sizes)); assert.strictEqual(t.limits.length, t.sizes.length);
    assert.ok(t.sizes[0] >= 5.5);
  });
  assert.ok(asc(C.data.busbar.table.map((x) => x[1])));
  const mi = C.data.lbs.makers.mitsubishi;
  [mi.single[3300], mi.single[6600], mi.three[3300], mi.three[6600]].forEach((t) => assert.ok(asc(t.map((x) => x[0]))));
  assert.ok(asc(mi.combined.map((x) => x[0])));
});

test('三相4線式は三相と同じ計算（二次は線間電圧）', () => {
  const a = C.calculate({ mode: 'three4w', kva: 300, v1: 6600, v2: 415 });
  const b = C.calculate({ mode: 'three', kva: 300, v1: 6600, v2: 415 });
  near(a.i2, 300000 / (Math.sqrt(3) * 415), 1e-9);
  assert.strictEqual(a.ct.ratio, b.ct.ratio);
  assert.strictEqual(a.eb.voltClass, '400V級');
  assert.strictEqual(a.eb.label, b.eb.label);
});

test('灯動共用（日立）：一次は定格容量の三相、二次は三相側＝定格・単相側＝単相最大、%Zは周波数別', () => {
  const r = C.calculate({ mode: 'todo', kva: 100, v1: 6600, v2: 210, freq: 50 });
  const t = C.calculate({ mode: 'three', kva: 100, v1: 6600, v2: 210 });
  near(r.i1, t.i1, 1e-9);
  assert.strictEqual(r.fuse.mitsubishi.min, t.fuse.mitsubishi.min); // LBS は定格 100kVA の三相
  assert.strictEqual(r.fuse.fuji.value, t.fuse.fuji.value);
  assert.strictEqual(r.z.tr, 2.45); // ③ 50Hz
  assert.strictEqual(C.calculate({ mode: 'todo', kva: 100, v1: 6600, v2: 210, freq: 60 }).z.tr, 2.88);
  assert.strictEqual(r.todo.single.input.kva, 75); // ③ 単相最大 75kVA
  near(r.todo.three.i2, 100000 / (Math.sqrt(3) * 210), 1e-9);
  near(r.todo.single.i2, 75000 / 210, 1e-9);
  assert.strictEqual(r.todo.three.ct.ratio, '400/5A'); // 274.9×1.25=343.7
  assert.strictEqual(r.todo.single.ct.ratio, '500/5A'); // 357.1×1.25=446.4
  assert.strictEqual(r.eb.phaseKva, 75); // 単相最大・200V級 75kVA以下 → 22mm²
  assert.strictEqual(r.eb.label, '22mm²');
  assert.deepStrictEqual(C.data.todo.rows.map((x) => x[1]), [45, 55, 75, 87.5, 100]);
  assert.throws(() => C.calculate({ mode: 'todo', kva: 90, v1: 6600, v2: 210 })); // 標準外
});

test('スコットは一次電圧で高圧/低圧を判定', () => {
  assert.ok(C.calculate({ mode: 'scott', kva: 50, v1: 6600, v2: 210 }).fuse);
  assert.ok(C.calculate({ mode: 'scott', kva: 50, v1: 440, v2: 210 }).primaryBreaker);
});
