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

test('%Z 未入力は標準値を使用（日立 ST-156 特性表）', () => {
  const r = C.calculate({ phase: 3, kva: 300, v1: 6600, v2: 210 });
  assert.strictEqual(r.z.tr, 4.63); // 油入 50Hz 三相210V 300kVA
  assert.strictEqual(r.z.trIsDefault, true);
  near(r.iscKa, 17.8, 0.05); // カタログの二次短絡電流 17.8kA と一致
  assert.strictEqual(C.defaultZ('three', 2000, 210), 7.07);
  assert.strictEqual(C.defaultZ('three', 2000, 420), 6.2);
  assert.strictEqual(C.defaultZ('three', 2000, 440, 'oil', 60), 6.85);
  assert.strictEqual(C.defaultZ('single', 75, 210), 2.61);
  assert.strictEqual(C.defaultZ('single', 10, 210, 'mold', 50), 3.66);
  assert.strictEqual(C.defaultZ('three', 300, 210, 'mold', 60), 7.54);
  assert.strictEqual(C.defaultZ('three', 30, 420), 2.61); // 表の最小(75kVA)未満は最小容量の値
  assert.strictEqual(C.defaultZ('single', 1000, 210), 5.31); // 表にない容量は直近下位
  const m = C.calculate({ phase: 1, kva: 100, v1: 6600, v2: 210, trType: 'mold', freq: 60 });
  assert.strictEqual(m.z.tr, 8.06);
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
    const r = C.calculate(Object.assign({ v1: 6600, mainBreaker: true, iscBasis: 'calc' }, o)).breaker.makers;
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
    const r = C.calculate(Object.assign({ v1: 6600, mainBreaker: true, iscBasis: 'calc' }, o)).breaker.makers;
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
  // 三相100kVA 210V：274.9A・Is=274.9/2.8%≒9.8kA（計算値基準）
  const r = C.calculate({ mode: 'three', kva: 100, v1: 6600, v2: 210, z: 2.8, iscBasis: 'calc' });
  const mi = r.branch.makers.mitsubishi.rows.map((x) => x.af + 'AF:' + x.model);
  assert.deepStrictEqual(mi, ['63AF:NF63-SV', '125AF:NF125-CV', '225AF:NF250-CV', '400AF:NF400-CW']);
  const fj = r.branch.makers.fuji.rows.map((x) => x.af + 'AF:' + x.model);
  assert.deepStrictEqual(fj, ['50AF:BW50SAG', '63AF:BW63SAG', '100AF:BW100EAG', '125AF:BW125JAG', '250AF:BW250EAG', '400AF:BW400EAG']);
  // 単相10kVA 210V：47.6A → 63AF / 50AF までで打ち切り
  const s1 = C.calculate({ mode: 'single', kva: 10, v1: 6600, v2: 210, iscBasis: 'calc' });
  assert.deepStrictEqual(s1.branch.makers.mitsubishi.rows.map((x) => x.af), [63]);
  assert.deepStrictEqual(s1.branch.makers.fuji.rows.map((x) => x.af), [50]);
  // 富士カタログ 4.4（3相210V 500kVA：短絡34.4kA → 125AF は J(50kA)、250AF は E(36kA)、400AF は E(50kA)）
  const r5 = C.calculate({ mode: 'three', kva: 500, v1: 6600, v2: 210, z: 4, iscBasis: 'calc' });
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

test('JIS C 4620 解説表1：キュービクルの遮断容量（既定で優先）', () => {
  const J = C.data.jisC4620;
  const row = (m, k, f) => C.jisRow(m, k, 6600, 210, f);
  assert.deepStrictEqual(row('three', 100, 50).values, [9.0, 11.3, 12.5, 12.7, null]);
  assert.deepStrictEqual(row('three', 750, 60).values, [16.3, 30.5, 41.7, 42.8, 43.2]);
  assert.deepStrictEqual(row('single', 500, 50).values, [14.7, 30.4, 47.4, 49.4, 50.1]);
  assert.deepStrictEqual(row('single', 75, 60).values, [9.7, 13.9, 16.6, 16.9, null]);
  assert.strictEqual(row('three', 1000, 50), null); // 表外
  assert.strictEqual(row('single', 750, 50), null);
  assert.strictEqual(row('three', 20, 50).kva, 30); // 表にない容量は直近上位行
  assert.strictEqual(C.jisRow('three', 100, 6600, 440, 50), null); // 210V級のみ
  assert.strictEqual(C.jisRow('scott', 100, 6600, 210, 50), null);
  assert.strictEqual(C.jisAt(row('three', 100, 50), 63).ka, 11.3); // 63A → 125A以下列（富士 63AF）
  assert.strictEqual(C.jisAt(row('three', 100, 50), 630).ka, 12.7); // — は行の最大値
  assert.strictEqual(C.jisAt(row('three', 100, 50), 800), null); // 630A超は計算値
  // 分岐：フレームの最大定格の列の値を必要 Icu に
  const r = C.calculate({ mode: 'three', kva: 100, v1: 6600, v2: 210, freq: 50 });
  assert.ok(r.jis);
  const f = r.branch.makers.mitsubishi.rows;
  assert.deepStrictEqual(f.map((x) => x.af + ':' + x.needKa), ['63:9', '125:11.3', '225:12.5', '400:12.7']); // 三菱 63AF は 50A まで → 60A以下列
  f.forEach((x) => assert.ok(!x.ok || x.icu >= x.needKa));
  // 主幹：単相100kVA 476.2A → 500A → 630A以下列 18.7kA
  const m = C.calculate({ mode: 'single', kva: 100, v1: 6600, v2: 210, freq: 50, mainBreaker: true });
  assert.strictEqual(m.breaker.makers.mitsubishi.pick.needKa, 18.7);
  // 計算値基準を選ぶと JIS は使わない
  assert.strictEqual(C.calculate({ mode: 'three', kva: 100, v1: 6600, v2: 210, iscBasis: 'calc' }).jis, null);
  // 表の昇順
  ['three', 'single'].forEach((t) => [50, 60].forEach((hz) => {
    const rows = J[t][hz];
    assert.ok(rows.every((x, i) => i === 0 || x[0] > rows[i - 1][0]));
    rows.forEach((x) => { const v = x[1].filter((y) => y !== null); assert.ok(v.every((y, i) => i === 0 || y >= v[i - 1])); });
  }));
});

test('認定の手引き 補足表1：JIS に無い範囲を補完', () => {
  // 三相1000kVA 210V → JIS 表外 → 手引き 200V回路
  const r = C.calculate({ mode: 'three', kva: 1000, v1: 6600, v2: 210, freq: 50 });
  assert.strictEqual(r.jis.src, 'guide');
  assert.deepStrictEqual(r.jis.values, [16.2, 33.4, 48.2, 52.7, 54.5]);
  assert.strictEqual(C.jisAt(r.jis, 225).ka, 48.2);
  assert.strictEqual(C.jisAt(r.jis, 630), null); // 600A超は計算値
  // 三相500kVA 440V → 400V回路
  const g = C.guideRow('three', 500, 6600, 440);
  assert.deepStrictEqual(g.values, [17.5, 21.3, 22.6, 22.9, 23.0]);
  assert.deepStrictEqual(C.guideRow('three', 2000, 6600, 440).values, [27.7, 43.5, 50.5, 52.0, 52.7]);
  assert.strictEqual(C.guideRow('three', 50, 6600, 440).kva, 75); // 直近上位
  assert.deepStrictEqual(C.guideRow('single', 300, 6600, 210).values, [13.1, 24.7, 33.2, 35.6, 36.7]);
  assert.strictEqual(C.guideRow('single', 750, 6600, 210), null);
  assert.strictEqual(C.guideRow('three', 100, 440, 210), null); // 低圧受電は対象外
  // 両表がある範囲は JIS 優先、手引きは参考
  const b = C.calculate({ mode: 'three', kva: 100, v1: 6600, v2: 210, freq: 50 });
  assert.strictEqual(b.jis.src, 'jis');
  assert.deepStrictEqual(b.iscRef.values, [8.5, 11.2, 12.5, 12.8, 13.0]);
  // 三相4線 415V も 400V回路の表
  assert.strictEqual(C.calculate({ mode: 'three4w', kva: 300, v1: 6600, v2: 415 }).jis.src, 'guide');
  const G = C.data.guideIsc;
  [G.v200.three, G.v200.single, G.v400.three].forEach((t) => {
    assert.ok(t.every((x, i) => i === 0 || x[0] > t[i - 1][0]));
    t.forEach((x) => assert.ok(x[1].every((y, i) => i === 0 || y >= x[1][i - 1])));
  });
});

test('一次側ブレーカー：三菱 Y-0701 表4-25（変圧器一次側用遮断器の選定）', () => {
  const S = (m, k, v) => C.selectPrimaryMitsubishi(m, k, v).row;
  const items = (ex) => ex.items.map((x) => x[0] + ' ' + x[1]);
  // 三相210V 50kVA（137A）
  const r = S('three', 50, 210);
  assert.strictEqual(r.i1, 137);
  assert.deepStrictEqual(r.examples.map((e) => e.peak), [20, 23, 16]);
  assert.deepStrictEqual(items(r.examples[0]), ['NF250-SEV, NF250-HEV 175', 'NF400-CW 350', 'NF400-SW 250']);
  // 単相210V 5kVA 例①
  assert.deepStrictEqual(items(S('single', 5, 210).examples[0]), ['NF125-CV（注1） 60', 'NF125-CV, NF125-SV, NF125-HV 100', 'NF125-SEV, NF125-HEV 50']);
  // 三相420V 300kVA 例①
  assert.deepStrictEqual(items(S('three', 300, 440).examples[0]), ['NF630-CW 600', 'NF630-SW 500', 'NF630-SEW, NF630-HEW 500']);
  // 単相420V 500kVA は ②のみ倍数あり・形名なし
  assert.strictEqual(S('single', 500, 420).examples[0].items.length, 0);
  // 三相210V 500kVA 例① は —
  assert.strictEqual(S('three', 500, 210).examples[0].peak, null);
  // 63AF は 50A まで：三相210V 15kVA 例③ の NF63-CV, NF63-SV 63A は除外
  assert.deepStrictEqual(items(S('three', 15, 210).examples[2]), ['NF63-CV（注1） 50', 'NF125-CV, NF125-SV 75']);
  // 表にない容量は直近上位、対象外電圧は row なし
  assert.strictEqual(S('three', 40, 210).kva, 50);
  assert.strictEqual(C.selectPrimaryMitsubishi('three', 50, 100).row, null);
  // スコット（一次三相210V）
  assert.strictEqual(C.calculate({ mode: 'scott', kva: 50, v1: 210, v2: 210 }).primaryBreaker.catalog.row.i1, 137);
  // 全表：一次電流＝kVA から計算した値
  const T = C.data.primaryBrk.tables;
  Object.keys(T).forEach((k) => T[k].forEach((row) => {
    const v = k.endsWith('210') ? 210 : 420;
    const i1 = k.startsWith('single') ? row[0] * 1000 / v : row[0] * 1000 / (Math.sqrt(3) * v);
    assert.ok(Math.abs(row[1] - i1) / i1 < 0.01, k + ' ' + row[0]);
  }));
  // NF63-CV/SV/HV の定格は 50A まで
  C.data.breaker.makers.mitsubishi.list.filter((b) => b.af === 63).forEach((b) => assert.ok(Math.max(...b.ratings) <= 50, b.model));
});

test('一次側ブレーカー：富士 62D2-J-0030f 4.11（一次側短絡電流 × 容量）', () => {
  const F = (m, k, v, isc) => C.selectPrimaryFuji(m, k, v, isc).col;
  const pick = (m, k, v, isc) => { const c = F(m, k, v, isc); return c.rows[c.sel].model; };
  // 三相 200-220V/105V：50kVA・10kA → BW250EAT-3P150
  assert.strictEqual(pick('three', 50, 210, 10), 'BW250EAT-3P150');
  // 三相 400-440V/210V：1.5kA・0.5kVA → BW32AAG-3P003、10kVA → BW32SAT-3P020、200kVA → BW400EAT-3P350
  assert.strictEqual(pick('three', 0.5, 440, 1.5), 'BW32AAG-3P003');
  assert.strictEqual(pick('three', 10, 440, 1.5), 'BW32SAT-3P020');
  assert.strictEqual(pick('three', 200, 440, 1.5), 'BW400EAT-3P350');
  // 結合セル：三相440V 18kA は 0.5〜10kVA すべて BW125JAG-3P015
  [0.5, 3, 10].forEach((k) => assert.strictEqual(pick('three', k, 440, 18), 'BW125JAG-3P015'));
  // 単相 200-220V：2.5kA 1.5kVA と 2.0kVA は同じ BW32SAT-2P015、100kVA は BX800RAE-3P800
  assert.strictEqual(pick('single', 1.5, 210, 2.5), 'BW32SAT-2P015');
  assert.strictEqual(pick('single', 2, 210, 2.5), 'BW32SAT-2P015');
  assert.strictEqual(pick('single', 100, 210, 2.5), 'BX800RAE-3P800');
  // 単相 400-440V：10kA 10kVA → BW63RAG-2P060（形式から 63AF 60A）
  const c = F('single', 10, 440, 10);
  assert.deepStrictEqual([c.rows[c.sel].model, c.rows[c.sel].af, c.rows[c.sel].rating], ['BW63RAG-2P060', 63, 60]);
  // 記載なし（－）と表の最大超過
  assert.strictEqual(F('three', 200, 440, 65).rows[8].model, null);
  assert.ok(F('three', 50, 210, 200).over);
  // 短絡電流未入力は sel なし（全行表示）、直近上位列
  assert.strictEqual(F('three', 40, 210, 0).sel, -1);
  assert.strictEqual(F('three', 40, 210, 0).kva, 50);
  assert.strictEqual(C.selectPrimaryFuji('three', 50, 100, 10).col, null);
  // 表の形：各行の列数＝容量数
  Object.values(C.data.fujiPrimary.tables).forEach((t) => t.rows.forEach((r) => assert.strictEqual(r[1].length, t.kva.length)));
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

test('灯動共用（日立）：一次は定格容量の三相、二次は負荷配分曲線上の配分、%Zは周波数別', () => {
  // 未入力は折れ点：③100kVA → 三相50＋単相50
  const r = C.calculate({ mode: 'todo', kva: 100, v1: 6600, v2: 210, freq: 50 });
  const t = C.calculate({ mode: 'three', kva: 100, v1: 6600, v2: 210 });
  near(r.i1, t.i1, 1e-9);
  assert.strictEqual(r.fuse.mitsubishi.min, t.fuse.mitsubishi.min); // LBS は定格 100kVA の三相
  assert.strictEqual(r.fuse.fuji.value, t.fuse.fuji.value);
  assert.strictEqual(r.z.tr, 2.45); // ③ 50Hz
  assert.strictEqual(C.calculate({ mode: 'todo', kva: 100, v1: 6600, v2: 210, freq: 60 }).z.tr, 2.88);
  assert.strictEqual(r.input.kva3, 50);
  assert.strictEqual(r.input.kva1, 50);
  near(r.todo.single.i2, 50000 / 210, 1e-9);
  near(r.eb.phaseKva, 50 + 50 / 3, 1e-9); // 66.7kVA・200V級 → 22mm²
  assert.strictEqual(r.eb.label, '22mm²');
  // ⑤150kVA：三相90 → 単相55、三相100 → 単相50、単相50 → 三相100
  const sp = (k, side, v) => { const x = C.todoSplit('hitachi', k, side, v); return x.three + '+' + x.single; };
  assert.strictEqual(sp(150, 'three', 90), '90+55');
  assert.strictEqual(sp(150, 'three', null), '100+50');
  assert.strictEqual(sp(150, 'single', 50), '100+50');
  assert.strictEqual(sp(70, 'single', 30), '30+30');
  assert.strictEqual(sp(125, 'three', 75), '75+50');
  assert.ok(C.todoSplit('hitachi', 150, 'three', 160).error); // 最大超過
  const r5 = C.calculate({ mode: 'todo', kva: 150, v1: 6600, v2: 210, todoSide: 'three', todoLoad: 90 });
  assert.strictEqual(r5.todo.three.ct.ratio, '400/5A'); // 247.4×1.25=309.3
  assert.strictEqual(r5.todo.single.input.kva, 55);
  assert.throws(() => C.calculate({ mode: 'todo', kva: 150, v1: 6600, v2: 210, todoLoad: 150 })); // 単相0
  assert.throws(() => C.calculate({ mode: 'todo', kva: 90, v1: 6600, v2: 210 })); // 標準外
});

test('灯動共用（三菱 ダブルパワー RA-3R）：負荷分担曲線・%Z下限・単相100kVA超の注意', () => {
  const r = C.calculate({ mode: 'todo', todoMaker: 'mitsubishi', kva: 300, v1: 6600, v2: 210 });
  assert.strictEqual(r.input.kva3, 200); // 【200+100】
  assert.strictEqual(r.input.kva1, 100);
  assert.strictEqual(r.z.tr, 2.2); // 保証値 2.2～4.1 の下限
  assert.strictEqual(r.todo.three.ct.ratio, '750/5A'); // 549.9×1.25=687.3
  assert.strictEqual(r.todo.single.ct.ratio, '600/5A'); // 476.2×1.25=595.2
  near(r.eb.phaseKva, 100 + 200 / 3, 1e-9); // 166.7kVA・200V級 → 60mm²
  assert.strictEqual(r.eb.label, '60mm²');
  assert.strictEqual(r.todo.warn.length, 0);
  const sp = (k, side, v) => { const x = C.todoSplit('mitsubishi', k, side, v); return x.three + '+' + x.single; };
  assert.strictEqual(sp(150, 'three', null), '100+50');
  assert.strictEqual(sp(300, 'three', 250), '250+50');
  assert.strictEqual(sp(200, 'three', 133), '133+67');
  assert.strictEqual(sp(500, 'three', 399.3), '399.3+99.2');
  const r5 = C.calculate({ mode: 'todo', todoMaker: 'mitsubishi', kva: 500, v1: 6600, v2: 210 }); // 【333+167】
  assert.strictEqual(r5.input.kva1, 167);
  assert.strictEqual(r5.todo.warn.length, 1); // 単相 100kVA 超
  assert.deepStrictEqual(C.data.todo.makers.mitsubishi.rows.map((x) => x[0]), [50, 75, 100, 150, 200, 300, 500]);
  Object.values(C.data.todo.makers).forEach((M) => Object.keys(M.curves).forEach((k) => {
    const c = M.curves[k];
    assert.strictEqual(c[c.length - 1][0], Number(k)); // 終点＝定格容量
    assert.ok(c.every((p, i) => i === 0 || (p[0] > c[i - 1][0] && p[1] < c[i - 1][1]))); // 単調
  }));
  assert.throws(() => C.calculate({ mode: 'todo', todoMaker: 'mitsubishi', kva: 70, v1: 6600, v2: 210 })); // 三菱に70なし
});

test('スコットは一次電圧で高圧/低圧を判定', () => {
  assert.ok(C.calculate({ mode: 'scott', kva: 50, v1: 6600, v2: 210 }).fuse);
  assert.ok(C.calculate({ mode: 'scott', kva: 50, v1: 440, v2: 210 }).primaryBreaker);
});

test('JIS C 4304/4306 結線（表19・表6）', () => {
  const w = (kva, v2, f, v1) => C.jisWinding(kva === 'single' ? 'single' : 'three', kva === 'single' ? 50 : kva, v1 || 6600, v2, f);
  assert.deepStrictEqual(w(20, 210).codes, ['Yy0']);
  assert.deepStrictEqual(w(50, 210).codes, ['Yy0']);
  assert.deepStrictEqual(w(75, 210).codes, ['Yd1']);
  assert.deepStrictEqual(w(500, 210).codes, ['Yd1']);
  // 750・1000kVA は JIS 表19 で Y-Δ 又は Δ-Δ、日立標準（ST-156）の Δ-Δ を先頭
  assert.deepStrictEqual(w(750, 210).codes, ['Dd0', 'Yd1']);
  assert.deepStrictEqual(w(1000, 210).codes, ['Dd0', 'Yd1']);
  assert.deepStrictEqual(w(1500, 210).codes, ['Dd0']);
  assert.strictEqual(w(1500, 210).std, true);
  const n50 = w(2000, 420, 50);
  assert.deepStrictEqual(n50.codes, ['Dyn11']);
  assert.strictEqual(n50.std, true);
  assert.strictEqual(w(2000, 440, 50).std, false); // 440V は 60Hz
  assert.strictEqual(w(2000, 440, 60).std, true);
  assert.strictEqual(w(500, 420, 50).std, false); // JIS の Δ-Y は 1500・2000kVA のみ
  assert.strictEqual(w(500, 420, 50).jem, true); // 日立標準品（JEM 1520/1521）
  assert.strictEqual(w(300, 210, 50, 3300).std, false); // JIS は 6kV 配電用
  assert.deepStrictEqual(w(300, 210, 50, 3300).codes, ['Yd1']);
  assert.strictEqual(w(300, 220).std, false);
  assert.strictEqual(w(300, 210, 50, 420).lv, true); // 低圧/低圧は対象外
  assert.deepStrictEqual(w('single', 210).codes, ['単三']);
  assert.strictEqual(C.jisWinding('single', 750, 6600, 210, 50).std, false);
  assert.strictEqual(C.jisWinding('scott', 50, 6600, 210, 50), null);
  assert.deepStrictEqual(C.calculate({ phase: 3, kva: 30, v1: 6600, v2: 210 }).winding.codes, ['Yy0']);
});

test('タップ電圧と二次電圧（JIS 表4）', () => {
  const big = C.tapTable(300, 210, 6600);
  assert.deepStrictEqual(big.rows.map(r => r.label), ['F6750', 'R6600', 'F6450', 'F6300', '6150']);
  near(big.rows[2].v2, 6600 * 210 / 6450, 1e-9); // 214.88V
  near(big.rows[1].pct, 0, 1e-9);
  assert.strictEqual(big.rows[4].kind, '低減容量タップ');
  const small = C.tapTable(50, 210, 6600);
  assert.deepStrictEqual(small.rows.map(r => r.label), ['R6600', 'F6300', '6000']);
  near(C.tapTable(75, 210, 6750).rows[0].v2, 210, 1e-9); // 受電 6750V・タップ F6750 → 210V
});

test('分岐の必要 Icu はフレームの最大定格の列（三菱 63AF は 50A まで → 60A以下列）', () => {
  const r = C.calculate({ mode: 'single', kva: 300, v1: 6600, v2: 210, freq: 60 });
  const mi = r.branch.makers.mitsubishi.rows[0];
  assert.strictEqual(mi.af, 63);
  assert.strictEqual(mi.jisCol, 60);
  assert.strictEqual(mi.needKa, 13.4);
  assert.strictEqual(mi.model, 'NF63-SV'); // 15kA ≥ 13.4kA
  const fj = r.branch.makers.fuji.rows;
  assert.strictEqual(fj.find((x) => x.af === 50).jisCol, 60);
  assert.strictEqual(fj.find((x) => x.af === 63).jisCol, 125); // 富士 63AF は 63A まで
});

test('結線の選択：既定は代表例、JIS 外の選択は注意', () => {
  const auto = C.calculate({ mode: 'three', kva: 300, v1: 6600, v2: 210 });
  assert.deepStrictEqual(auto.winding.codes, ['Yd1']);
  assert.strictEqual(auto.winding.selected, false);
  const dd = C.calculate({ mode: 'three', kva: 300, v1: 6600, v2: 210, conn: 'Dd0' });
  assert.deepStrictEqual(dd.winding.codes, ['Dd0']);
  assert.strictEqual(dd.winding.std, false);
  assert.ok(dd.winding.notes.some((n) => n.indexOf('JIS 標準外') >= 0));
  const ok = C.calculate({ mode: 'three', kva: 1000, v1: 6600, v2: 210, conn: 'Yd1' }); // 表19 で可
  assert.strictEqual(ok.winding.std, true);
  assert.ok(!ok.winding.notes.some((n) => n.indexOf('JIS 標準外') >= 0));
  const dy = C.calculate({ mode: 'three', kva: 300, v1: 6600, v2: 210, conn: 'Dyn11' });
  assert.ok(dy.winding.notes.some((n) => n.indexOf('JIS 標準外') >= 0));
  // 三相4線は Dyn11 固定（選択は無視）
  const n4 = C.calculate({ mode: 'three4w', uiMode: 'three4w', kva: 300, v1: 6600, v2: 420, conn: 'Yy0' });
  assert.deepStrictEqual(n4.winding.codes, ['Dyn11']);
  // 単相2線は JIS 標準外の注意
  const s2 = C.calculate({ mode: 'single', kva: 50, v1: 6600, v2: 105, wires: 2 });
  assert.strictEqual(s2.winding.std, false);
  assert.deepStrictEqual(s2.winding.codes, ['単相2線']);
});

test('灯動は JIS 結線判定の対象外', () => {
  const r = C.calculate({ mode: 'todo', kva: 100, v1: 6600, v2: 210, todoMaker: 'hitachi' });
  assert.strictEqual(r.winding, null);
});

test('V結線（単相変圧器2台）：線電流＝1台の定格電流、単相1台分の %Z・EB', () => {
  const r = C.calculate({ mode: 'three', uiMode: 'three', kva: 50, v1: 6600, v2: 210, conn: 'Vv0' });
  assert.strictEqual(r.input.vv, true);
  near(r.input.kvaOut, 50 * Math.sqrt(3), 1e-9);
  near(r.i2, 50000 / 210, 1e-9); // 238.1A
  near(r.i1, 50000 / 6600, 1e-9);
  assert.strictEqual(r.z.tr, C.defaultZ('single', 50, 210)); // 単相 %Z
  assert.strictEqual(r.jis, null); // JIS C 4620 表の対象外 → 計算値
  assert.strictEqual(r.eb.phaseKva, 50); // 一相分容量＝1台分
  assert.deepStrictEqual(r.winding.codes, ['Vv0']);
  assert.strictEqual(r.winding.std, true); // 単相 50kVA・210V（JIS 単三変圧器2台）
  assert.ok(r.fuse.warn.some((w) => w.indexOf('V結線') >= 0));
});

test('三相4線 Y-Y（Yyn0）は選択可・JIS 外の注意、三相3線では選べない', () => {
  const y = C.calculate({ mode: 'three', uiMode: 'three4w', kva: 300, v1: 6600, v2: 420, conn: 'Yyn0' });
  assert.deepStrictEqual(y.winding.codes, ['Yyn0']);
  assert.strictEqual(y.winding.std, false);
  assert.ok(y.winding.notes.some((n) => n.indexOf('JIS 標準外') >= 0));
  const t3 = C.calculate({ mode: 'three', uiMode: 'three', kva: 300, v1: 6600, v2: 210, conn: 'Yyn0' });
  assert.deepStrictEqual(t3.winding.codes, ['Yd1']); // 三相3線の選択肢に無い → 代表例
  const n4 = C.calculate({ mode: 'three', uiMode: 'three4w', kva: 300, v1: 6600, v2: 420, conn: 'Vv0' });
  assert.deepStrictEqual(n4.winding.codes, ['Dyn11']);
  assert.strictEqual(n4.input.vv, false);
});

test('単相2線 210V は JIS 単三変圧器の u-v 使用（JIS 内）、105V は JIS 外', () => {
  const a = C.calculate({ mode: 'single', kva: 50, v1: 6600, v2: 210, wires: 2 });
  assert.deepStrictEqual(a.winding.codes, ['単三u-v']);
  assert.strictEqual(a.winding.std, true);
  const b = C.calculate({ mode: 'single', kva: 50, v1: 6600, v2: 105, wires: 2 });
  assert.strictEqual(b.winding.std, false);
});

test('異容量V-V結線：日本電気技術者協会 第2表・第1表の計算例と照合', () => {
  // 第2表（三相を許容限度まで、力率同一）[Ta, Tb, P1, P3]
  [[10, 5, 5.4, 8.7], [100, 50, 53.5, 86.6], [75, 30, 47.5, 52], [250, 150, 108.6, 259.8], [300, 250, 56.2, 433]].forEach(([ta, tb, p1, p3]) => {
    const s = C.vvxSplit(ta, tb, 'three', null, null, null, true);
    near(s.single, p1, 0.05); near(s.three, p3, 0.05);
  });
  // 第1表 計算例：P1=10kVA cosθ1=1、P3=30kVA cosθ3=0.866 → 進み Ta=23.9、遅れ 共用=27.3、専用=17.3
  const need = (lead) => {
    const t1 = 0, t3 = Math.acos(0.866);
    const c = Math.cos(Math.PI / 6 + (lead ? t3 - t1 : t1 - t3));
    return Math.sqrt(100 + 900 / 3 + 2 / Math.sqrt(3) * 10 * 30 * c);
  };
  near(need(true), 23.9, 0.05); near(need(false), 27.3, 0.05); near(30 / Math.sqrt(3), 17.3, 0.05);
  // vvxSplit 逆算：共用 23.9・専用 17.3、三相 30kVA を入れると単相 ≒10kVA（進み）
  const back = C.vvxSplit(need(true), 30 / Math.sqrt(3), 'three', 30, 1, 0.866, true);
  near(back.single, 10, 0.1);
  // 計算：EB 一相分容量は大きい方、各回路の短絡電流は端子短絡の大きい方
  const r = C.calculate({ mode: 'three', uiMode: 'three', conn: 'Vvx', kva: 100, kvaB: 50, v1: 6600, v2: 210 });
  assert.strictEqual(r.eb.phaseKva, 100);
  near(r.todo.three.i2, 86.6 * 1000 / (Math.sqrt(3) * 210), 0.1);
  near(r.todo.single.i2, 53.5 * 1000 / 210, 0.1);
  assert.strictEqual(r.todo.three.iscKa, Math.max(r.sc[0].isc, r.sc[1].isc));
  // 割合指定：三相 50%
  const pct = C.vvxSplit(100, 50, 'pct', 50, null, null, true);
  near(pct.three, 43.3, 0.05);
});
