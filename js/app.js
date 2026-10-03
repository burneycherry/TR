/* 画面処理 */
(function () {
  'use strict';

  const C = window.TRCalc;
  const D = C.data;
  const STORE_KEY = 'tr-select-input-v2';
  const MANUAL = 'manual';

  // 電源相モードごとの電圧候補
  // 代表的な電圧のみ（特高・まれな電圧は「手入力」）
  const HV1 = [6600, 3300];
  const LV1 = [440, 420, 415, 400, 220, 210, 200];
  const V1ALL = HV1.concat(LV1);
  const V1_OPTIONS = { three: V1ALL, three4w: V1ALL, single2w: V1ALL, single3w: V1ALL, scott: V1ALL, todo: [6600] };
  const V2_OPTIONS = {
    three: [210, 200, 220, 400, 415, 420, 440],
    three4w: [415, 400, 420, 440],
    single2w: [210, 105, 200, 100],
    single3w: [210, 200],
    scott: [210, 105, 200, 100],
    todo: [210]
  };
  const V2_LABELS = {
    three4w: { 415: '415/240', 400: '400/230', 420: '420/242', 440: '440/254' },
    single3w: { 210: '210 (210/105)', 200: '200 (200/100)' }, scott: { 210: '210 (210/105)' }, todo: { 210: '210 (210/105)' }
  };
  const MODE_LABEL = { three: '三相3線', three4w: '三相4線', single2w: '単相2線', single3w: '単相3線', scott: 'スコット', todo: '灯動' };
  // 旧保存値：スコット高圧/低圧・低圧/低圧 → スコット、単相 → 単相3線（二次 105/100/440/420V は単相2線）
  function normUiMode(m, v2) {
    if (m && m.indexOf('scott') === 0) { return 'scott'; }
    if (m === 'single') { return [105, 100, 440, 420, 220].indexOf(Number(v2)) >= 0 ? 'single2w' : 'single3w'; }
    return V1_OPTIONS[m] ? m : 'three';
  }

  const $ = function (id) { return document.getElementById(id); };
  const el = {
    kva: $('kva'), v1: $('v1'), v2: $('v2'), v1m: $('v1m'), v2m: $('v2m'), z: $('z'), isc: $('isc'),
    kva1: $('kva1'), kva1Field: $('kva1Field'), todoLoad: $('todoLoad'),
    kvaSel: $('kvaSel'), results: $('results'), err: $('inputErr'), toast: $('toast'),
    tap: $('tap'), tapSupply: $('tapSupply'),
    kvaB: $('kvaB'), pf1: $('pf1'), pf3: $('pf3'), vvxLoad: $('vvxLoad'), connSel: $('connSel')
  };
  let lastText = '';

  function fmt(n, d) {
    if (n === null || n === undefined || !isFinite(n)) { return '-'; }
    return Number(n).toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function radio(name) {
    const r = document.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : null;
  }
  function setRadio(name, v) {
    const r = document.querySelector('input[name="' + name + '"][value="' + v + '"]');
    if (r) { r.checked = true; }
  }
  function uiMode() { return radio('mode') || 'three'; }
  function calcMode(m) { return m === 'three4w' ? 'three' : (m === 'single2w' || m === 'single3w' ? 'single' : m); }
  // 結線の選択（三相3線・三相4線、空＝代表例）
  let connChoice = '';
  function isVv() { return uiMode() === 'three' && (connChoice === 'Vv0' || connChoice === 'Vvx'); }
  function isVvx() { return uiMode() === 'three' && connChoice === 'Vvx'; }
  // 専用変圧器（異容量V結線）の容量 select：単相標準容量
  function buildKvaB(keep) {
    const list = D.capacities.single;
    const labels = {};
    list.forEach(function (k) { if (D.jisTr.capacities.single.indexOf(k) < 0) { labels[k] = k + '（JIS外）'; } });
    el.kvaB.innerHTML = list.map(function (k) { return '<option value="' + k + '"' + (k === Number(keep) ? ' selected' : '') + '>' + esc(labels[k] || String(k)) + '</option>'; }).join('');
    if (!(list.indexOf(Number(keep)) >= 0)) { el.kvaB.value = '50'; }
  }

  // 電圧 select（候補＋手入力）を作る
  function buildVolt(sel, manualInput, list, keep, labels) {
    sel.innerHTML = '';
    list.forEach(function (v) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = (labels && labels[v]) || String(v);
      sel.appendChild(o);
    });
    const om = document.createElement('option');
    om.value = MANUAL;
    om.textContent = '手入力…';
    sel.appendChild(om);
    if (keep === MANUAL) {
      sel.value = MANUAL;
    } else if (keep && list.indexOf(Number(keep)) >= 0) {
      sel.value = String(keep);
    } else if (keep && Number(keep) > 0) {
      sel.value = MANUAL;
      manualInput.value = String(keep);
    } else {
      sel.value = String(list[0]);
    }
    manualInput.hidden = sel.value !== MANUAL;
  }
  function voltValue(sel, manualInput) {
    return sel.value === MANUAL ? Number(manualInput.value) : Number(sel.value);
  }

  function buildVolts(k1, k2) {
    const m = uiMode();
    buildVolt(el.v1, el.v1m, V1_OPTIONS[m], k1);
    buildVolt(el.v2, el.v2m, V2_OPTIONS[m], k2, V2_LABELS[m]);
  }

  // 容量 select（標準容量＋手入力）
  function buildKva(keep) {
    const m = calcMode(uiMode());
    // V結線は単相変圧器1台あたりの容量
    const capKey = isVv() ? 'single' : m;
    const list = m === 'todo' ? D.todo.makers[radio('todoMaker') === 'mitsubishi' ? 'mitsubishi' : 'hitachi'].rows.map(function (r) { return r[0]; }) : D.capacities[capKey];
    // JIS C 4304/4306 表3 にない容量は「JIS外」
    const jisCaps = D.jisTr.capacities[capKey];
    let labels = null;
    if (jisCaps) {
      labels = {};
      list.forEach(function (k) { if (jisCaps.indexOf(k) < 0) { labels[k] = k + '（JIS外）'; } });
    }
    buildVolt(el.kvaSel, el.kva, list, keep, labels);
  }

  // タップ電圧（JIS 表4）：6kV 級の単相・三相・三相4線式・灯動（日立）で表示可
  function tapEnabled(inp) {
    const R = D.jisTr.v1Range;
    const okMode = inp.mode === 'single' || inp.mode === 'three' || (inp.mode === 'todo' && inp.todoMaker === 'hitachi');
    return okMode && inp.v1 >= R[0] && inp.v1 <= R[1] && inp.kva > 0;
  }
  function buildTaps(kva, keep) {
    const T = D.jisTr.taps;
    const list = kva > 0 && kva <= T.smallMaxKva ? T.small : T.large;
    const cur = keep || Number(el.tap.value) || 6600;
    const has = list.some(function (t) { return t[1] === cur; });
    el.tap.innerHTML = list.map(function (t) {
      const v = has ? cur : 6600;
      return '<option value="' + t[1] + '"' + (t[1] === v ? ' selected' : '') + '>' + esc(t[0] + t[1]) + '</option>';
    }).join('');
  }

  function readInput() {
    const m = uiMode();
    return {
      uiMode: m,
      mode: calcMode(m),
      trType: radio('trType') || 'oil',
      mainBreaker: radio('mainBrk') === 'yes',
      freq: radio('freq') === '60' ? 60 : 50,
      iscBasis: radio('iscBasis') === 'calc' ? 'calc' : 'jis',
      todoMaker: radio('todoMaker') === 'mitsubishi' ? 'mitsubishi' : 'hitachi',
      todoSide: radio('todoSide') === 'single' ? 'single' : 'three',
      todoLoad: el.todoLoad.value === '' ? null : Number(el.todoLoad.value),
      kva: voltValue(el.kvaSel, el.kva),
      v1: voltValue(el.v1, el.v1m),
      v2: voltValue(el.v2, el.v2m),
      z: el.z.value === '' ? null : Number(el.z.value),
      iscKa: el.isc.value === '' ? null : Number(el.isc.value),
      kva1: el.kva1.value === '' ? null : Number(el.kva1.value),
      wires: m === 'single2w' ? 2 : 3,
      conn: m === 'three' || m === 'three4w' ? connChoice : '',
      kvaB: Number(el.kvaB.value) || 0,
      vvxLead: radio('vvxLead') !== 'lag',
      pf1: el.pf1.value === '' ? null : Number(el.pf1.value),
      pf3: el.pf3.value === '' ? null : Number(el.pf3.value),
      vvxSide: radio('vvxSide') || 'three',
      vvxLoad: el.vvxLoad.value === '' ? null : Number(el.vvxLoad.value),
      tapOn: radio('tapOn') === 'yes',
      tap: Number(el.tap.value) || 6600,
      tapSupply: el.tapSupply.value === '' ? null : Number(el.tapSupply.value)
    };
  }

  function save(inp) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(inp)); } catch (e) { /* 保存不可でも動作継続 */ }
  }
  function load() {
    try {
      const s = localStorage.getItem(STORE_KEY);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }

  // エナジーサポートのヒューズ一覧（定格＋適合ホルダー）
  function esItems(items) {
    return items.map(function (x) {
      return '<strong>' + esc(x.model) + ' ' + esc(String(x.value)) + 'A</strong>' + (x.holders && x.holders.length ? '<br>' + note('ホルダー：' + esc(x.holders.join('・'))) : '');
    }).join('<br>');
  }
  function card(title, body, unverified) {
    return '<section class="card"><h2>' + title + (unverified ? ' <span class="badge">要確認</span>' : '') + '</h2>' + body + '</section>';
  }
  function kvItem(k, v, unit) {
    return '<div class="item"><div class="k">' + k + '</div><div class="v">' + v + (unit ? '<small>' + unit + '</small>' : '') + '</div></div>';
  }
  function row(th, td) { return '<tr><th>' + th + '</th><td>' + td + '</td></tr>'; }
  function note(s) { return '<span class="sub-note">' + s + '</span>'; }
  function anyUnverified(obj) {
    return Object.keys(obj).some(function (k) { return obj[k].verified === false; });
  }

  function breakerRows(b, t, label) {
    let h = '';
    Object.keys(b.makers).forEach(function (k) {
      const m = b.makers[k];
      const p = m.pick;
      const a = m.acb;
      let val = p ? '<strong>' + esc(p.model) + ' ' + p.rating + 'AT</strong><br>' + note(p.af + 'AF　Icu ' + p.icu + 'kA' + (p.needKa > 0 ? ' ≥ 必要 ' + fmt(p.needKa, 1) + 'kA' : '') + '（' + b.voltClass + '）')
        : '<strong>MCCB 該当なし</strong><br>' + note(esc(m.overNote || '上位機種・カスケード遮断等を個別検討'));
      // 800A 以上、または MCCB で選べない場合は ACB も示す
      if (a && (!p || b.need >= 800)) {
        val += '<br><span class="acb">ACB：<strong>' + esc(a.model) + '</strong> ' + a.rating + 'A　Icu ' + a.icu + 'kA</span>';
      }
      h += row(esc(m.name), val);
      t.push(label + '(' + m.name + '): ' + (p ? p.model + ' ' + p.rating + 'AT(' + p.af + 'AF) Icu' + p.icu + 'kA' : 'MCCB該当なし') +
        (a && (!p || b.need >= 800) ? ' / ACB ' + a.model + ' ' + a.rating + 'A' : ''));
    });
    return h;
  }

  // キュービクルの遮断容量の表（JIS C 4620 解説表1（油入）・表2（モールド）優先、無い範囲は認定の手引き 補足表1）
  function tblLine(j) {
    return j.ratings.map(function (x, i) { return x + 'A以下 ' + (j.values[i] === null ? '—' : fmt(j.values[i], 1) + 'kA'); }).join('／');
  }
  function jisNote(rc, inp) {
    const j = rc.jis;
    if (!j) {
      return inp.iscBasis === 'jis' && (rc.input.mode === 'three' || rc.input.mode === 'single') ?
        '<p class="sub-note">JIS C 4620 解説表1・2・認定の手引き 補足表1 の対象外のため計算値でブレーカーを選定</p>' : '';
    }
    const head = esc(j.name) + '（' + (j.src === 'jis' ? j.freq + 'Hz・' : j.circuit + '・') + j.kva + 'kVA' + (j.exact ? '' : '：直近上位の行') + '）';
    let h = '<p class="sub-note"><strong>' + head + 'でブレーカーを選定</strong><br>' + tblLine(j) + '<br>' +
      (j.src === 'jis' ? 'JIS C 4304 調査値（短絡電流の最大値）。' : 'JIS C 4620 解説表1・2 に無い範囲のため手引きで補完。') +
      j.ratings[j.ratings.length - 1] + 'A 超は計算値。</p>';
    if (rc.iscRef) {
      const g = rc.iscRef;
      h += '<p class="sub-note">参考：' + esc(g.name) + '（' + g.circuit + '・' + g.kva + 'kVA）<br>' + tblLine(g) + '</p>';
    }
    return h;
  }

  // 二次側の電圧（線間・対地）：結線と接地点から求める（無負荷・定格電圧）
  function secVolts(r, inp) {
    const v = r.input.v2;
    const h = v / 2;
    const ph = v / Math.sqrt(3);
    const f1 = function (x) { return fmt(x, x % 1 ? 1 : 0) + 'V'; };
    const m = r.input.mode;
    if (r.vvx) {
      const ld = r.input.lead !== false;
      return [['三相 線間（u-v・v-w・w-u）', f1(v)], ['単相 ' + (ld ? 'u-o・v-o（u-v' : 'v-o・w-o（v-w') + ' は ' + f1(v) + '）', f1(h)],
        ['対地 ' + (ld ? 'u・v' : 'v・w'), f1(h)], ['対地 ' + (ld ? 'w' : 'u') + '（o 接地）', f1(v * Math.sqrt(3) / 2)]];
    }
    if (m === 'todo') {
      return [['三相 線間（u-v・v-w・w-u）', f1(v)], ['単相 u-o・v-o（u-v は ' + f1(v) + '）', f1(h)],
        ['対地 u・v', f1(h)], ['対地 w（Δ頂点、o 接地）', f1(v * Math.sqrt(3) / 2)]];
    }
    if (m === 'scott') {
      // M座（u1-v1、中点 o1）・T座（u2-v2、中点 o2）の2列
      if (v <= 150) { return { cols: ['M座', 'T座'], rows: [['線間', 'u1-v1 ' + f1(v), 'u2-v2 ' + f1(v)], ['対地（各座一端接地）', 'u1 ' + f1(v), 'u2 ' + f1(v)]] }; }
      return { cols: ['M座', 'T座'], rows: [['線間', 'u1-v1 ' + f1(v), 'u2-v2 ' + f1(v)], ['中性線間', 'u1-o1・v1-o1 ' + f1(h), 'u2-o2・v2-o2 ' + f1(h)],
        ['対地（中点 o1・o2 接地）', 'u1・v1 ' + f1(h), 'u2・v2 ' + f1(h)]] };
    }
    if (m === 'single') {
      if (r.winding && r.winding.codes[0] === '単三u-v') { return [['線間 u-v', f1(v)], ['対地 u・v（中性点 o 接地）', f1(h)]]; }
      if (inp.uiMode === 'single2w') { return [['線間 u-v', f1(v)], ['対地 u（v 接地）', f1(v)]]; }
      return [['線間 u-v', f1(v)], ['u-o・v-o', f1(h)], ['対地 u・v（中性点 o 接地）', f1(h)]];
    }
    const code = r.winding ? r.winding.codes[0] : (v > 300 ? 'Dyn11' : 'Yd1');
    if (code === 'Dyn11' || code === 'Yyn0') {
      const dy = [['線間 u-v・v-w・w-u', f1(v)], ['対地 u・v・w（中性点 N 接地）', f1(ph)]];
      if (inp.uiMode === 'three4w') { dy.splice(1, 0, ['相電圧 u-N・v-N・w-N', f1(ph)]); }
      return dy;
    }
    return [['線間 u-v・v-w・w-u', f1(v)], ['対地 u・w（v 接地）', f1(v)], ['対地 v', '0V']];
  }
  function secVoltHtml(sv) {
    const head = '<table class="res" style="margin-top:8px"><tr><th colspan="' + (sv.cols ? 3 : 2) + '" style="width:auto">二次側の電圧（無負荷・定格）</th></tr>';
    if (sv.cols) {
      return head + '<tr><th></th>' + sv.cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr>' +
        sv.rows.map(function (x) { return '<tr><th>' + esc(x[0]) + '</th><td>' + esc(x[1]) + '</td><td>' + esc(x[2]) + '</td></tr>'; }).join('') + '</table>';
    }
    return head + sv.map(function (x) { return '<tr><th>' + esc(x[0]) + '</th><td><strong>' + esc(x[1]) + '</strong></td></tr>'; }).join('') + '</table>';
  }
  function secVoltText(sv) {
    if (sv.cols) { return sv.rows.map(function (x) { return x[0] + ' ' + x[1] + '・' + x[2]; }).join('／'); }
    return sv.map(function (x) { return x[0] + ' ' + x[1]; }).join('／');
  }

  // 結線図（代表例）：三菱 油入変圧器カタログ L-10034-H（仕様 p.9・スコット p.27・ダブルパワー p.23）、日立 灯動共用 製品ページ
  function wiring(r, inp) {
    const R = 32;
    const out = [];
    function ln(x1, y1, x2, y2) { out.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>'); }
    function dot(x, y) { out.push('<circle cx="' + x + '" cy="' + y + '" r="2.6" class="f"/>'); }
    function tx(x, y, t, a) { out.push('<text x="' + x + '" y="' + y + '" text-anchor="' + (a || 'middle') + '">' + esc(t) + '</text>'); }
    function gnd(x, y) {
      ln(x, y, x, 150); ln(x - 9, 150, x + 9, 150); ln(x - 6, 154, x + 6, 154); ln(x - 3, 158, x + 3, 158);
      tx(x + 13, 157, 'B種接地', 'start');
    }
    function tri(cx, cy) { return { a: [cx, cy - R], b: [cx - R * 0.866, cy + R / 2], c: [cx + R * 0.866, cy + R / 2] }; }
    // ベクトル図：角度 deg（反時計回り、0°=右）の点。U=90°・V=-30°・W=210° を基準に、二次は位相変位ぶん回転
    function pol(cx, cy, deg, r) { const a = deg * Math.PI / 180; return [cx + (r || R) * Math.cos(a), cy - (r || R) * Math.sin(a)]; }
    function lbl(q, cx, cy, t) {
      const dx = q[0] - cx, dy = q[1] - cy, d = Math.sqrt(dx * dx + dy * dy) || 1;
      tx(q[0] + dx / d * 11, q[1] + dy / d * 11 + 4, t);
    }
    function star(cx, cy, n) {
      const t = tri(cx, cy);
      ln(cx, cy, t.a[0], t.a[1]); ln(cx, cy, t.b[0], t.b[1]); ln(cx, cy, t.c[0], t.c[1]);
      tx(t.a[0], t.a[1] - 5, n[0]); tx(t.b[0] - 6, t.b[1] + 12, n[1]); tx(t.c[0] + 6, t.c[1] + 12, n[2]);
      return t;
    }
    function delta(cx, cy, n) {
      const t = tri(cx, cy);
      ln(t.a[0], t.a[1], t.b[0], t.b[1]); ln(t.b[0], t.b[1], t.c[0], t.c[1]); ln(t.c[0], t.c[1], t.a[0], t.a[1]);
      tx(t.a[0], t.a[1] - 5, n[0]); tx(t.b[0] - 6, t.b[1] + 12, n[1]); tx(t.c[0] + 6, t.c[1] + 12, n[2]);
      return t;
    }
    const m = r.input.mode;
    const v1 = r.input.v1;
    const v2 = r.input.v2;
    const P = 62, S = 196, Y0 = 72;
    let name = '';
    let outs = [];
    if (m === 'single' && r.winding && r.winding.codes[0] === '単三u-v') {
      // 単相2線 210V：JIS の単三専用変圧器の u-v 間を使用、中性点 o は B種接地
      ln(P, Y0 - R, P, Y0 + R); dot(P, Y0 - R); dot(P, Y0 + R); tx(P - 10, Y0 - R + 4, 'U', 'end'); tx(P - 10, Y0 + R + 4, 'V', 'end');
      ln(S, Y0 - R, S, Y0 + R); dot(S, Y0 - R); dot(S, Y0); dot(S, Y0 + R);
      tx(S - 8, Y0 - R + 4, 'u', 'end'); tx(S - 8, Y0 + 4, 'o', 'end'); tx(S - 8, Y0 + R + 4, 'v', 'end');
      ln(S, Y0, S + 22, Y0); gnd(S + 22, Y0);
      name = '単相2線（単三専用変圧器の u-v 間を使用、中性点 o 接地）';
      outs = ['単相2線', v2 + 'V（u-v）'];
    } else if (m === 'single' && inp.uiMode === 'single2w') {
      ln(P, Y0 - R, P, Y0 + R); dot(P, Y0 - R); dot(P, Y0 + R); tx(P - 10, Y0 - R + 4, 'U', 'end'); tx(P - 10, Y0 + R + 4, 'V', 'end');
      ln(S, Y0 - R, S, Y0 + R); dot(S, Y0 - R); dot(S, Y0 + R);
      tx(S - 8, Y0 - R + 4, 'u', 'end'); tx(S - 8, Y0 + R + 4, 'v', 'end');
      ln(S, Y0 + R, S + 22, Y0 + R); gnd(S + 22, Y0 + R);
      name = '単相2線（二次一端 v 接地）';
      outs = ['単相2線', v2 + 'V'];
    } else if (m === 'single') {
      ln(P, Y0 - R, P, Y0 + R); dot(P, Y0 - R); dot(P, Y0 + R); tx(P - 10, Y0 - R + 4, 'U', 'end'); tx(P - 10, Y0 + R + 4, 'V', 'end');
      ln(S, Y0 - R, S, Y0 + R); dot(S, Y0 - R); dot(S, Y0); dot(S, Y0 + R);
      tx(S - 8, Y0 - R + 4, 'u', 'end'); tx(S - 8, Y0 + 4, 'o', 'end'); tx(S - 8, Y0 + R + 4, 'v', 'end');
      ln(S, Y0, S + 22, Y0); gnd(S + 22, Y0);
      name = '単相 単三（中性点 o 接地）';
      outs = ['単相3線', v2 + '/' + (v2 / 2) + 'V'];
    } else if (m === 'scott') {
      // 一次：V—U 水平（M座）、W は中点から垂直（T座）。二次：u2-02-v2 垂直と v1-01-u1 水平の直交（三菱 L-10034-H ベクトル図）
      const yb = Y0 + 22;
      ln(P - R, yb, P + R, yb); ln(P, yb, P, yb - 1.6 * R);
      dot(P - R, yb); dot(P + R, yb); dot(P, yb - 1.6 * R); dot(P, yb);
      tx(P - R - 6, yb + 4, 'V', 'end'); tx(P + R + 6, yb + 4, 'U', 'start'); tx(P, yb - 1.6 * R - 6, 'W');
      const xv = S - 36, yt = Y0 - 36, yu = Y0 + 16;
      ln(xv, yt, xv, yu); dot(xv, yt); dot(xv, (yt + yu) / 2); dot(xv, yu);
      tx(xv - 6, yt + 4, 'v2', 'end'); tx(xv - 6, (yt + yu) / 2 + 4, 'o2', 'end'); tx(xv - 6, yu + 4, 'u2', 'end');
      const xh0 = xv + 12, xh1 = xv + 76, yh = yu + 8;
      ln(xh0, yh, xh1, yh); dot(xh0, yh); dot((xh0 + xh1) / 2, yh); dot(xh1, yh);
      tx(xh0, yh + 14, 'v1'); tx((xh0 + xh1) / 2 + 5, yh + 14, 'o1', 'start'); tx(xh1, yh + 14, 'u1');
      ln(xh0, yu - 6, xh0 + 6, yu - 6); ln(xh0 + 6, yu - 6, xh0 + 6, yu); // 直角記号
      // EB（B種接地）は各座の中点 o1・o2 から（ユーザー指定）
      const xg = xh1 + 22, y02 = (yt + yu) / 2, xm = (xh0 + xh1) / 2;
      ln(xv, y02, xg, y02); ln(xm, yh, xm, yh + 22); ln(xm, yh + 22, xg, yh + 22); ln(xg, y02, xg, yh + 22); gnd(xg, yh + 22);
      name = 'スコット結線（一次 T結線、二次 M座・T座は90°位相差、各座 単相3線。B種接地は中点 o1・o2 から）';
      outs = ['単相3線×2', v2 + '/' + (v2 / 2) + 'V'];
    } else if (m === 'todo') {
      const t = star(P, Y0, ['U', 'W', 'V']); dot(t.a[0], t.a[1]); dot(t.b[0], t.b[1]); dot(t.c[0], t.c[1]);
      // Yd1：二次は30°遅れ → u 60°・v -60°・w 180°（日立・三菱の結線図と同じ向き）
      const u = pol(S, Y0, 60), v = pol(S, Y0, -60), w = pol(S, Y0, 180), o = [(u[0] + v[0]) / 2, Y0];
      ln(w[0], w[1], u[0], u[1]); ln(u[0], u[1], v[0], v[1]); ln(v[0], v[1], w[0], w[1]);
      [u, v, w, o].forEach(function (q) { dot(q[0], q[1]); });
      tx(u[0] + 8, u[1] + 4, 'u', 'start'); tx(v[0] + 8, v[1] + 4, 'v', 'start'); tx(w[0] - 7, w[1] + 4, 'w', 'end'); tx(o[0] - 5, o[1] - 4, 'o', 'end');
      ln(o[0], o[1], o[0] + 28, o[1]); gnd(o[0] + 28, o[1]);
      name = 'Y-Δ 灯動共用（二次Δの一相中点 o を引出し・o 接地）';
      outs = ['三相 u-v-w', v2 + 'V', '単相 u-o-v', v2 + '-' + (v2 / 2) + 'V'];
    } else {
      // 三相：JIS C 4304/4306 表19・表20（ベクトル図の向きは JIS 表20：一次 U 210°・V 90°・W −30°）
      const wd = r.winding || { codes: [v2 > 300 ? 'Dyn11' : 'Yd1'] };
      const code = wd.codes[0];
      const PA = { u: 210, v: 90, w: -30 };
      const SA = code === 'Yd1' ? { u: 180, v: 60, w: -60 } : code === 'Dyn11' ? { u: 240, v: 120, w: 0 } : PA;
      const star1 = code === 'Yy0' || code === 'Yd1' || code === 'Yyn0';
      const star2 = code === 'Yy0' || code === 'Dyn11' || code === 'Yyn0';
      const neutral = code === 'Dyn11' || code === 'Yyn0';
      const pts = function (cx, A) { return { u: pol(cx, Y0, A.u), v: pol(cx, Y0, A.v), w: pol(cx, Y0, A.w) }; };
      const drawY = function (cx, q, n) { ['u', 'v', 'w'].forEach(function (k, i) { ln(cx, Y0, q[k][0], q[k][1]); dot(q[k][0], q[k][1]); lbl(q[k], cx, Y0, n[i]); }); };
      const drawD = function (cx, q, n) {
        // V結線は u-w 間（開放）を描かない
        ln(q.u[0], q.u[1], q.v[0], q.v[1]); ln(q.v[0], q.v[1], q.w[0], q.w[1]);
        if (code !== 'Vv0' && code !== 'Vvx') { ln(q.w[0], q.w[1], q.u[0], q.u[1]); }
        ['u', 'v', 'w'].forEach(function (k, i) { dot(q[k][0], q[k][1]); lbl(q[k], cx, Y0, n[i]); });
      };
      const pq = pts(P, PA), sq = pts(S, SA);
      (star1 ? drawY : drawD)(P, pq, ['U', 'V', 'W']);
      (star2 ? drawY : drawD)(S, sq, ['u', 'v', 'w']);
      if (neutral) {
        dot(S, Y0); if (code === 'Yyn0') { tx(S - 7, Y0 - 4, 'N', 'end'); } else { tx(S + 7, Y0 + 14, 'N', 'start'); }
        ln(S, Y0, S, Y0 + R + 10); ln(S, Y0 + R + 10, S + 30, Y0 + R + 10); gnd(S + 30, Y0 + R + 10);
        outs = inp.uiMode === 'three4w' ? ['三相4線', v2 + '/' + Math.round(v2 / Math.sqrt(3)) + 'V'] : ['三相 ' + v2 + 'V'];
      } else if (code === 'Vvx') {
        // 異容量V結線：共用（進み＝u-v、遅れ＝v-w）の中点 o を接地（参考資料 第1表）
        const a = wd.lead !== false ? sq.u : sq.w;
        const o = [(a[0] + sq.v[0]) / 2, (a[1] + sq.v[1]) / 2];
        dot(o[0], o[1]); tx(o[0] + (wd.lead !== false ? -6 : 6), o[1] - 4, 'o', wd.lead !== false ? 'end' : 'start');
        const xg = S + R + 14;
        ln(o[0], o[1], o[0], Y0 + R + 6); ln(o[0], Y0 + R + 6, xg, Y0 + R + 6); gnd(xg, Y0 + R + 6);
        outs = ['三相 ' + r.input.kva3 + 'kVA', '単相 ' + r.input.kva1 + 'kVA', '共用 ' + r.input.kva + 'kVA', '専用 ' + r.input.kvaB + 'kVA'];
      } else {
        // 二次一端（v）接地
        const xg = S + R + 14;
        ln(sq.v[0], sq.v[1], xg, sq.v[1]); gnd(xg, sq.v[1]);
        outs = code === 'Vv0' ? ['三相3線 ' + v2 + 'V', '単相 ' + r.input.kva + 'kVA×2'] : ['三相3線 ' + v2 + 'V'];
      }
      const NAMES = {
        Yyn0: 'Y-Y 中性点付き（Yyn0：位相変位 0°）中性点 N 接地',
        Vv0: 'V-V（単相変圧器2台、位相変位 0°、三相出力は1台の √3 倍）二次 v 接地',
        Vvx: 'V-V 異容量（共用＋専用の単相変圧器、灯動共用）共用変圧器の中点 o 接地',
        Yy0: 'Y-Y（Yy0：位相変位 0°）二次一端接地',
        Yd1: 'Y-Δ（Yd1：二次は一次より30°遅れ）二次一端接地',
        Dd0: 'Δ-Δ（Dd0：位相変位 0°）二次一端接地',
        Dyn11: 'Δ-Y（Dyn11：二次は一次より30°進み）中性点 N 接地'
      };
      name = (wd.selected ? '選択：' : (wd.codes[1] && wd.hitachi === code ? '代表例（日立標準）' : '代表例 ')) + NAMES[code] + (wd.codes[1] ? '。JIS 表19 では ' + NAMES[wd.codes[1]].split('）')[0] + '）も可' : '');
    }
    tx(P, 14, '一次 ' + v1 + 'V');
    tx(S, 14, '二次');
    outs.forEach(function (o2, i) { tx(262, Y0 - 6 - (outs.length > 2 ? 16 : 0) + i * 16, o2, 'start'); });
    const wd = r.winding;
    let src;
    if (wd && !wd.lv) {
      src = wd.jem ? 'JEM 1520/1521 準拠の標準品（' + D.jisTr.hitachi.name + '）、ベクトル図は JIS 表20' : D.jisTr.name + ' 表18〜20 による' + (wd.std ? '' : '（JIS 標準外の条件を含むため参考）');
    } else if (wd) {
      src = '低圧/低圧は JIS C 4304/4306 の対象外のため代表例';
    } else {
      src = '代表例（三菱 油入変圧器カタログ L-10034-H・日立 灯動共用 製品ページ）';
    }
    if (wd && wd.selected) { src = wd.lv ? '低圧/低圧は JIS C 4304/4306 の対象外' : (wd.codes[0] === 'Vvx' ? (wd.lead !== false ? '進み接続（単相負荷 u-v＝共用）' : '遅れ接続（単相負荷 v-w＝共用）') + '。参考：日本電気技術者協会 異容量V‐V結線方式 第1表' : wd.codes[0] === 'Vv0' ? '単相変圧器は ' + D.jisTr.name + ' 表3・表5（単三専用 210-105V の u-v 間を使用）' : D.jisTr.name + ' 表19 で確認'); }
    return '<svg class="wd" viewBox="0 0 340 168" role="img" aria-label="結線図">' + out.join('') + '</svg>' +
      '<p class="sub-note">' + esc(name) + '。' + esc(src) + '。実機は銘板・仕様書で確認。</p>' +
      (wd ? wd.notes.map(function (w) { return '<div class="warn">' + esc(w) + '</div>'; }).join('') : '') +
      secVoltHtml(secVolts(r, inp));
  }

  // 結線の選択（入力欄 #connSel、三相3線・三相4線のみ）：既定は代表例。選択肢の JIS外 表示は計算結果で決まる
  function buildConn(r, inp) {
    const wd = r.winding;
    const show = (inp.uiMode === 'three' || inp.uiMode === 'three4w') && !!wd;
    $('connField').hidden = !show;
    if (!show) { return; }
    const autoName = wd.auto.map(function (c) { return C.CONN_NAMES[c]; }).join(' 又は ');
    el.connSel.innerHTML = '<option value="">代表例：' + esc(autoName) + '</option>' +
      C.CONN_OPTIONS[inp.uiMode].map(function (c) {
        const out2 = !wd.lv && c !== 'Vv0' && c !== 'Vvx' && wd.auto.indexOf(c) < 0;
        return '<option value="' + c + '">' + esc(C.CONN_NAMES[c]) + (out2 ? '（JIS外）' : '') + '</option>';
      }).join('');
    el.connSel.value = wd.selected ? wd.codes[0] : '';
  }

  function render(r, inp) {
    const n = r.circuits;
    const per = n > 1 ? '（各座・' + n + '回路）' : '';
    const t = [];
    let html = '';
    // 二次側の回路（灯動は 三相回路・単相回路 の2つ）
    const secs = r.todo ? [
      [r.todo.three, '（三相側 ' + r.input.kva3 + 'kVA）', '[三相] '],
      [r.todo.single, '（単相側 ' + r.input.kva1 + 'kVA）', '[単相] ']
    ] : [[r, per, '']];

    const v2Lbl = (V2_LABELS[inp.uiMode] && V2_LABELS[inp.uiMode][r.input.v2]) || String(r.input.v2);
    const kvaLbl = r.vvx ? '異容量V結線 共用' + r.input.kva + 'kVA＋専用' + r.input.kvaB + 'kVA（配分 三相' + r.input.kva3 + '＋単相' + r.input.kva1 + 'kVA、' + (r.input.lead ? '進み' : '遅れ') + '接続）' : r.todo ? r.input.kva + 'kVA（配分 三相' + r.input.kva3 + '＋単相' + r.input.kva1 + 'kVA、' + r.input.freq + 'Hz）' : (r.input.vv ? 'V結線 単相' + r.input.kva + 'kVA×2（三相出力 ' + fmt(r.input.kvaOut, 1) + 'kVA）' : r.input.kva + 'kVA');
    t.push('【変圧器】' + MODE_LABEL[inp.uiMode] + ' ' + (r.input.trType === 'mold' ? 'モールド ' : '油入 ') + kvaLbl + ' ' + r.input.v1 + 'V/' + v2Lbl.split(' ')[0] + 'V');

    // 結線図
    html += card('結線図', wiring(r, inp));
    if (r.winding && !r.winding.lv) { t.push('【結線】' + (r.winding.selected ? '選択 ' : '') + r.winding.codes.join(' 又は ') + '（' + D.jisTr.name + (r.winding.std ? '' : '・標準外を含む') + '）'); }
    t.push('【二次電圧】' + secVoltText(secVolts(r, inp)));

    // タップ電圧（オン時のみ）：受電電圧に対する各タップの二次電圧
    if (tapEnabled(inp) && inp.tapOn) {
      const tt = C.tapTable(r.input.kva, r.input.v2, inp.tapSupply);
      const sel = tt.rows.filter(function (x) { return x.tap === inp.tap; })[0] || tt.rows.filter(function (x) { return x.mark === 'R'; })[0];
      const fmtV = function (v) {
        if (inp.uiMode === 'three4w') { return fmt(v, 1) + '/' + fmt(v / Math.sqrt(3), 1) + 'V'; }
        if (inp.uiMode === 'single3w' || inp.mode === 'todo') { return fmt(v, 1) + '/' + fmt(v / 2, 1) + 'V'; }
        return fmt(v, 1) + 'V';
      };
      let tb = '<p class="sub-note" style="margin-top:0">受電電圧 ' + tt.supply + 'V のときの二次電圧（無負荷）＝ 受電電圧 × ' + r.input.v2 + ' ÷ タップ電圧</p><table class="res">';
      tt.rows.forEach(function (x) {
        const on = x === sel;
        tb += '<tr' + (on ? ' class="pick"' : '') + '><th>' + esc(x.label) + 'V<br><small>' + esc(x.kind) + '</small></th><td>' + (on ? '<strong>' : '') + esc(fmtV(x.v2)) + (on ? '</strong>' : '') +
          ' <small>（' + (x.pct >= 0 ? '+' : '') + fmt(x.pct, 1) + '%）</small>' + (on ? ' ◀ 選択' : '') + '</td></tr>';
      });
      tb += '</table><p class="sub-note">タップを下げる（6450・6300V）と二次電圧が上がり、上げる（6750V）と下がります。' + (tt.small ? '1段（300V）で約 5%' : '1段（150V）で約 2.3%') + ' 変わります。R=定格電圧、F=全容量タップ（定格容量で使用可）、記号なし=低減容量タップ（定格容量より小さい容量になる。容量はメーカーに確認）。' +
        (tt.small ? '50kVA 以下は R6600・F6300・6000 の3タップ（単相は指定により F6750〜6150 の5タップも可：JIS 表4 注記2）。' : '') +
        '変圧器の電流・短絡電流などの選定計算は定格（R6600V）基準です。出典：' + esc(D.jisTr.name) + ' 表4。</p>';
      html += card('タップ電圧と二次電圧', tb);
      t.push('【タップ】' + sel.label + 'V（受電 ' + tt.supply + 'V → 二次 ' + fmtV(sel.v2) + '、' + (sel.pct >= 0 ? '+' : '') + fmt(sel.pct, 1) + '%）');
    }

    // 定格電流
    if (r.vvx) {
      const vs = r.vvx.split;
      html += card('定格電流',
        '<div class="kv">' + kvItem('一次 共用 I₁', fmt(r.i1, 2), 'A') + kvItem('一次 専用 I₁', fmt(r.i1b, 2), 'A') +
        kvItem('二次 三相 I₂', fmt(r.todo.three.i2, 1), 'A') + kvItem('二次 単相 I₂', fmt(r.todo.single.i2, 1), 'A') + '</div>' +
        '<p class="sub-note">異容量V結線：共用 ' + r.input.kva + 'kVA（必要 ' + fmt(vs.needK, 1) + 'kVA）・専用 ' + r.input.kvaB + 'kVA（必要 P3/√3 = ' + fmt(vs.needS, 1) + 'kVA）。' +
        '共用 = √(P1² + P3²/3 + (2/√3)·P1·P3·cos(30° ' + (vs.lead ? '+ θ3 − θ1' : '+ θ1 − θ3') + '))、力率 電灯 ' + vs.pf1 + '・動力 ' + fmt(vs.pf3, 3) + '（' + (vs.lead ? '進み' : '遅れ') + '接続）。' +
        '三相 ' + r.input.kva3 + 'kVA（' + r.input.v2 + 'V）＋単相 ' + r.input.kva1 + 'kVA（' + r.input.v2 + '-' + (r.input.v2 / 2) + 'V）でそれぞれ選定。出典：' + esc(r.todo.source) + '</p>' +
        r.todo.warn.map(function (w) { return '<div class="warn">' + esc(w) + '</div>'; }).join(''));
      t.push('一次電流 共用: ' + fmt(r.i1, 2) + 'A・専用: ' + fmt(r.i1b, 2) + 'A / 二次電流 三相: ' + fmt(r.todo.three.i2, 1) + 'A・単相: ' + fmt(r.todo.single.i2, 1) + 'A');
    } else if (r.todo) {
      html += card('定格電流',
        '<div class="kv">' + kvItem('一次電流 I₁', fmt(r.i1, 2), 'A') + kvItem('二次 三相 I₂', fmt(r.todo.three.i2, 1), 'A') +
        kvItem('二次 単相 I₂', fmt(r.todo.single.i2, 1), 'A') + '</div>' +
        '<p class="sub-note">' + esc(r.todo.name) + '：一次は定格 ' + fmt(r.input.kva, 0) + 'kVA の三相。二次は負荷配分曲線上の配分 三相側 ' + r.input.kva3 + 'kVA（' + r.input.v2 + 'V）＋単相側 ' + r.input.kva1 + 'kVA（' + r.input.v2 + '-' + (r.input.v2 / 2) + 'V）でそれぞれ選定（' + (r.todo.split.side === 'single' ? '単相側' : '三相側') + 'を入力）。出典：' + esc(r.todo.source) + '</p>' +
        r.todo.warn.map(function (w) { return '<div class="warn">' + esc(w) + '</div>'; }).join(''));
      t.push('一次電流: ' + fmt(r.i1, 2) + 'A / 二次電流 三相: ' + fmt(r.todo.three.i2, 1) + 'A・単相: ' + fmt(r.todo.single.i2, 1) + 'A');
    } else {
      html += card('定格電流',
        '<div class="kv">' + kvItem('一次電流 I₁', fmt(r.i1, 2), 'A') + kvItem('二次電流 I₂' + (n > 1 ? '（各座）' : ''), fmt(r.i2, 1), 'A') + '</div>' +
        (n > 1 ? '<p class="sub-note">スコット二次：M座・T座 各 ' + fmt(r.input.kva / 2, 1) + 'kVA の単相回路</p>' : '') +
        (r.input.vv ? '<p class="sub-note">V結線：単相 ' + r.input.kva + 'kVA×2、三相出力 ' + fmt(r.input.kvaOut, 1) + 'kVA（1台の √3 倍）。線電流＝1台の定格電流 ' + r.input.kva + 'kVA÷' + r.input.v2 + 'V。短絡電流は1台の端子短絡（単相 %Z）として計算</p>' : '') +
        (inp.uiMode === 'three4w' ? '<p class="sub-note">三相4線式 ' + esc(v2Lbl) + 'V：電流は線間電圧 ' + r.input.v2 + 'V で計算</p>' : ''));
      t.push('一次電流: ' + fmt(r.i1, 2) + 'A / 二次電流' + (n > 1 ? '(各座)' : '') + ': ' + fmt(r.i2, 1) + 'A');
    }

    // 短絡電流
    secs.forEach(function (sc) {
      const rc = sc[0];
      const sx = sc[1];
      const tg = sc[2];
      let zNote = '変圧器 %Z = ' + fmt(rc.z.tr, 2) + '%' + (rc.z.trIsDefault ? (inp.mode === 'todo' ? '（未入力のため灯動共用変圧器の標準値）' : '（未入力のため ' + D.defaultZ.name + ' の' + (rc.input.trType === 'mold' ? 'モールド' : '油入') + '・' + (inp.freq === 60 ? 60 : 50) + 'Hz の値）') : '');
      if (r.vvx) { zNote += '。共用 ' + r.sc[0].kva + 'kVA ' + fmt(r.sc[0].isc, 2) + 'kA・専用 ' + r.sc[1].kva + 'kVA ' + fmt(r.sc[1].isc, 2) + 'kA の端子短絡（単相 %Z）の大きい方を使用'; }
      zNote += rc.z.src > 0 ? '、電源側 %Z = ' + fmt(rc.z.src, 3) + '%（変圧器容量基準）' : '、電源側は無限大母線';
      html += card('二次側 短絡電流' + sx,
        '<div class="kv">' + kvItem('合成 %Z', fmt(rc.z.total, 2), '%') + kvItem('短絡電流 Is', fmt(rc.iscKa, 2), 'kA') + '</div>' +
        '<p class="sub-note">' + esc(zNote) + '</p>');
      t.push(tg + '二次短絡電流: ' + fmt(rc.iscKa, 2) + 'kA（%Z ' + fmt(rc.z.total, 2) + '%）');
    });

    // 一次側：高圧 → LBS ヒューズ、低圧 → 一次側ブレーカー
    if (r.fuse) {
      const f = r.fuse;
      let fb = '<table class="res">';
      const mi = f.mitsubishi;
      let mv;
      if (!mi.ok) {
        mv = '<strong>' + esc(mi.msg) + '</strong>' + (mi.method ? '<br>' + note(esc(mi.method)) : '');
        t.push('LBSヒューズ(三菱): ' + mi.msg);
      } else if (mi.value) {
        mv = '<strong>' + esc(mi.value) + '</strong><br>' + note(esc(mi.series) + '　' + esc(mi.method));
        t.push('LBSヒューズ(三菱): ' + mi.value);
      } else {
        mv = '<strong>推奨 ' + esc(mi.min) + '</strong><br>' + note('最大 ' + esc(mi.max) + '<br>' + esc(mi.series) + '　' + esc(mi.method));
        t.push('LBSヒューズ(三菱): 推奨' + mi.min + '（最大' + mi.max + '）');
      }
      fb += row(esc(mi.name), mv);
      const fu = f.fuji;
      let fv;
      if (!fu.ok) {
        fv = '<strong>' + esc(fu.msg) + '</strong>' + (fu.model ? '<br>' + note(esc(fu.model) + (fu.method ? '　' + esc(fu.method) : '')) : '');
        t.push('LBSヒューズ(富士): ' + fu.msg);
      } else {
        fv = '<strong>' + esc(fu.value) + '</strong><br>' + note(esc(fu.series) + '　' + esc(fu.model) + '<br>' + esc(fu.method));
        t.push('LBSヒューズ(富士): ' + fu.value + '（' + fu.model + '）');
      }
      fb += row(esc(fu.name), fv);
      const es = f.energys;
      let ev;
      if (!es.ok) {
        ev = '<strong>' + esc(es.msg) + '</strong>' + (es.method ? '<br>' + note(esc(es.method)) : '');
        t.push('LBSヒューズ(エナジーサポート): ' + es.msg);
      } else {
        ev = esItems(es.items) + '<br>' + note(esc(es.method));
        t.push('LBSヒューズ(エナジーサポート): ' + es.value);
      }
      fb += row(esc(es.name), ev);
      // カットアウト（PC）用ヒューズ：非限流＋QC-1
      const ec = es.cutout;
      if (ec) {
        fb += row(esc(es.name) + '<br><small>カットアウト（PC）</small>', ec.ok ? esItems(ec.items) + '<br>' + note(esc(ec.method)) : '<strong>' + esc(ec.msg) + '</strong>' + (ec.method ? '<br>' + note(esc(ec.method)) : ''));
        t.push('カットアウトヒューズ(エナジーサポート): ' + (ec.ok ? ec.value : ec.msg));
      }
      fb += '</table><p class="sub-note">三菱：' + esc(mi.note) + '<br>富士：' + esc(fu.note) + '<br>エナジーサポート：' + esc(es.note) + '</p>';
      f.warn.forEach(function (w) { fb += '<div class="warn">' + esc(w) + '</div>'; });
      html += card('LBS 限流ヒューズ（一次側）', fb, mi.verified === false || fu.verified === false || es.verified === false);
    }
    if (r.primaryBreaker) {
      const pb = r.primaryBreaker;
      const cat = pb.catalog;
      let pbb = '';
      // 三菱：カタログ「変圧器一次側用遮断器の選定」表4-25（励磁突入電流例①〜③）
      pbb += '<h3 class="sub-h">三菱電機　<small>' + esc(cat.name) + '</small></h3>';
      if (cat.row) {
        const cr = cat.row;
        pbb += '<p class="sub-note" style="margin-top:0">' + esc(cat.table) + '・' + cr.kva + 'kVA（定格一次電流 ' + cr.i1 + 'A）' + (cr.exact ? '' : '：表にない容量のため直近上位の行') + (cat.scott ? '。スコット専用の表は無いため三相表を準用（励磁突入電流は変圧器メーカーに確認）' : '') + '</p><table class="res">';
        const tx = [];
        cr.examples.forEach(function (ex, i) {
          const head = '励突例' + ['①', '②', '③'][i] + '<br>' + note(ex.peak ? '第1波 ' + ex.peak + '倍' : '');
          const body = ex.items.length ? ex.items.map(function (it) { return '<strong>' + esc(it[0]) + '</strong> ' + it[1] + 'A'; }).join('<br>') : '<strong>該当なし</strong><br>' + note('個別選定');
          pbb += row(head, body);
          tx.push(['①', '②', '③'][i] + (ex.items.length ? ex.items.map(function (it) { return it[0] + ' ' + it[1] + 'A'; }).join(' / ') : '該当なし'));
        });
        pbb += '</table>';
        t.push('一次側ブレーカー(三菱 表4-25 ' + cat.table + ' ' + cr.kva + 'kVA): ' + tx.join('　'));
        pbb += '<p class="sub-note">' + cat.notes.map(esc).join('<br>') + '<br>三菱 63AF は 50A まで（60・63A は除外）。</p>';
      } else {
        pbb += '<p class="sub-note">一次電圧 ' + r.input.v1 + 'V はカタログ表（210V・420V）の対象外です。個別に選定してください。</p>';
      }
      // 富士：カタログ 4.11「変圧器一次側回路の選定」（一次側短絡電流 kA 行 × 容量列）
      const fc = pb.fujiCatalog;
      pbb += '<h3 class="sub-h">富士電機　<small>' + esc(fc.name) + '</small></h3>';
      if (fc.col) {
        const c = fc.col;
        pbb += '<p class="sub-note" style="margin-top:0">' + esc(fc.table) + '・' + c.kva + 'kVA' + (c.exact ? '' : '：表にない容量のため直近上位の列') +
          (pb.iscGiven ? '。一次側短絡電流 ' + fmt(pb.iscKa, 1) + 'kA の行を採用' : '。一次側短絡電流が未入力のため全行を表示') + (fc.scott ? '。スコット専用の表は無いため三相表を準用（励磁突入電流は変圧器メーカーに確認）' : '') + '</p><table class="res">';
        c.rows.forEach(function (x, j) {
          const hit = j === c.sel;
          const val = x.model ? (hit ? '<strong>' + esc(x.model) + '</strong> ← 採用' : esc(x.model)) + '<br>' + note(x.af + 'AF　' + x.rating + 'A') : note('記載なし');
          if (!pb.iscGiven || hit || c.sel < 0) { pbb += row((hit ? '<strong>' : '') + x.ka + 'kA以下' + (hit ? '</strong>' : ''), val); }
        });
        pbb += '</table>';
        if (c.over) { pbb += '<div class="warn">一次側短絡電流が表の最大（' + c.rows[c.rows.length - 1].ka + 'kA）を超えます。個別に選定してください。</div>'; }
        const s1 = c.sel >= 0 ? c.rows[c.sel] : null;
        t.push('一次側ブレーカー(富士 4.11 ' + fc.table + ' ' + c.kva + 'kVA): ' + (s1 ? s1.model + '（' + s1.ka + 'kA以下）' : '一次側短絡電流により選定'));
        pbb += '<p class="sub-note">' + fc.notes.map(esc).join('<br>') + '</p>';
      } else {
        pbb += '<p class="sub-note">一次電圧 ' + r.input.v1 + 'V・容量はカタログ表（220V・440V、三相〜200kVA・単相〜100kVA）の対象外です。個別に選定してください。</p>';
      }
      if (!pb.iscGiven) { pbb += '<div class="warn">一次側短絡電流が未入力です。「一次側短絡電流 [kA]」を入力すると富士の該当行を選定し、遮断容量も確認できます。</div>'; }
      html += card('一次側 ブレーカー', pbb, anyUnverified(pb.makers));
    }

    // CT
    secs.forEach(function (sc) {
      const rc = sc[0];
      const sx = sc[1];
      const tg = sc[2];
      const ctBody = '<div class="kv">' + kvItem('変流比', rc.ct.ratio ? esc(rc.ct.ratio) : '該当なし', '') +
        kvItem('定格時 CT二次', rc.ct.primary ? fmt(rc.i2 * rc.ct.secondary / rc.ct.primary, 2) : '-', 'A') + '</div>' +
        '<p class="sub-note">基準: CT一次 ≥ I₂ × ' + D.ct.factor + '（= ' + fmt(rc.ct.need, 1) + 'A）の最小標準値（' + esc(D.ct.source) + '）。' +
        (rc.ct.model ? '形名例：三菱 ' + esc(rc.ct.model.name) + '（' + rc.ct.model.va + 'VA）。' : '') +
        '負担は計器・THR・配線の合計VA以上。</p>';
      html += card('二次側 CT' + sx, ctBody);
      t.push(tg + '二次側CT' + (rc.circuits > 1 ? '(各座)' : '') + ': ' + (rc.ct.ratio || '該当なし') + (rc.ct.model ? '（' + rc.ct.model.name + '）' : ''));
    });

    // THR
    secs.forEach(function (sc) {
      const rc = sc[0];
      const sx = sc[1];
      const tg = sc[2];
      if (rc.thr) {
        const th = rc.thr;
        const tb = '<div class="kv">' + kvItem('整定値', fmt(th.setting, 1), 'A') + kvItem('機種', esc(th.name + ' ' + th.model), '') + '</div>' +
          '<p class="sub-note">I₂ ' + fmt(rc.i2, 1) + 'A × 5 / ' + esc(th.ct.split('/')[0]) + ' = ' + fmt(th.raw, 3) + 'A → ' + D.thr.step + 'A 単位で切り捨て（過負荷前に警報を出すため）</p>';
        html += card('二次側 THR（サーマルリレー）' + sx, tb, th.verified === false);
        t.push(tg + 'THR: ' + th.name + ' ' + th.model + ' 整定 ' + fmt(th.setting, 1) + 'A（CT ' + th.ct + '）');
      }
    });

    // 電線・銅バー
    secs.forEach(function (sc) {
      const rc = sc[0];
      const sx = sc[1];
      const tg = sc[2];
      const cd = rc.conductor;
      let cb = '<p class="sub-note" style="margin-top:0">設計電流 ' + fmt(cd.design, cd.byBreaker ? 0 : 1) + 'A（' + (cd.byBreaker ? '主幹ブレーカー定格以上' : '二次定格電流') + '）</p><table class="res">';
      const cabTxts = [];
      cd.cable.forEach(function (c) {
        const txt = c.sq ? c.sq + 'sq' + (c.parallel > 1 ? ' × ' + c.parallel + '条' : '') : '—（2条超のため銅バー）';
        const sub = !c.sq ? c.name : c.name + '　' + '許容電流 ' + c.limit + 'A' +
          (c.parallel > 1 ? '（2条：1本 ≥ ' + fmt(c.need, 1) + 'A＝電流×' + D.cable.parallelRatio + '）' : '');
        cb += row(esc(c.name.split('（')[0]) + '<br>' + esc(c.temp), '<strong>' + esc(txt) + '</strong><br>' + note(esc(sub)));
        cabTxts.push(c.name.split('（')[0] + ' ' + c.temp + ' ' + txt);
      });
      const bus = cd.busbar;
      cb += row('銅バー', '<strong>' + (bus ? esc(bus.size) : '該当なし（個別設計）') + '</strong>' + (bus ? '<br>' + note('許容 ' + bus.ampacity + 'A') : ''));
      cb += '</table><p class="sub-note">' + esc(D.busCable.note) + '<br>' + esc(D.busbar.note) + '</p>';
      html += card('二次側 母線（電線・銅バー）' + sx, cb, !(D.busCable.verified && D.busbar.verified));
      t.push(tg + '母線電線: ' + cabTxts.join(' / '));
      t.push(tg + '母線銅バー: ' + (bus ? bus.size : '該当なし'));
    });

    // EB（B種接地線）
    if (r.eb) {
      const e = r.eb;
      let up = '';
      if (e.sq === null) {
        up = '';
      } else {
        const who = e.maxByMain ? '主幹ブレーカー ' + fmt(e.maxA, 0) + 'A'
          : '分岐ブレーカー最大 ' + fmt(e.maxA, 0) + 'A（二次電流 ' + fmt(e.i2, 1) + 'A 以下）';
        if (e.sizeUp.length) {
          up = '<p class="sub-note"><strong>分岐（主幹）ブレーカーのサイズによりサイズアップ</strong>（表2.13.2）<br>' +
            'ブレーカー ' + e.baseMax + 'A以下：' + esc(e.label) + '（表2.13.1のまま）<br>' +
            e.sizeUp.map(function (u) { return esc(u.from + 'A超〜' + u.to + 'A：' + u.label + (u.r4 ? '（令和4年版 表2.13.2 参考）' : '')); }).join('<br>') +
            (e.maxA > e.t2Max ? '<br>' + e.t2Max + 'A超：表2.13.2 範囲外（個別検討）' : '') +
            '<br>' + note('想定する最大：' + esc(who)) + '</p>';
        } else if (e.baseMax >= e.t2Max) {
          up = '<p class="sub-note">表2.13.2（〜' + e.t2Max + 'A）より太いため、ブレーカーのサイズによるサイズアップなし</p>';
        } else {
          up = '<p class="sub-note">' + esc(who) + ' ≤ ' + e.baseMax + 'A のため、ブレーカーのサイズによるサイズアップなし</p>';
        }
      }
      const upTxt = e.sizeUp.map(function (u) { return u.from + 'A超' + (u.to > u.from ? '〜' + u.to + 'A' : '') + ' → ' + u.label + (u.r4 ? '（令和4年版）' : ''); });
      if (e.sq !== null && e.maxA > e.t2Max) { upTxt.push(e.t2Max + 'A超 → 個別検討'); }
      const upLine = upTxt.length ? '<span class="up">⚠ サイズアップ有<br>' + upTxt.map(esc).join('<br>') + '</span>' : '';
      const eb = '<div class="kv">' + kvItem('EB 接地線', (e.label ? esc(e.label) : '個別検討') + upLine, '') +
        kvItem('一相分容量', fmt(e.phaseKva, 1), 'kVA') + '</div>' +
        '<p class="sub-note">内線規程 1350-5表・表2.13.1（' + e.voltClass + '）：' + (e.sq === null ? '範囲外（内線規程 資料1-3-6 により個別検討）' : e.sq + 'mm²' + (e.kk ? '（内線規程の表は超過、公共建築工事標準仕様書 表2.13.1 の値）' : (e.naisen && e.naisen !== e.sq + 'mm²' ? '（内線規程は ' + e.naisen + ' 以上）' : ''))) + '</p>' + up +
        '<p class="sub-note">B種接地工事の接地線の太さ（' + e.voltClass + '・銅線）。一相分容量：三相=定格÷3、単相=定格、スコット=定格÷2、灯動共用=単相分＋三相分÷3、同容量V結線=単相1台分、異容量V結線=大きい容量の単相変圧器（1350-5表 備考2・表2.13.1 備考(1)(ウ)）。多線式は最大使用電圧で適用（単相3線式は200V級）。<br>' + esc(D.eb.note) + '</p>';
      html += card('EB（B種接地線）サイズ', eb, e.verified === false);
      t.push('EB: ' + (e.label || '個別検討') + (e.sizeUp.length ? '（ブレーカー ' + e.baseMax + 'A超は表2.13.2でサイズアップ：' + e.sizeUp.map(function (u) { return '〜' + u.to + 'A ' + u.label; }).join('、') + (e.maxByMain ? '・主幹' : '')  + '）' : ''));
    }

    // 主幹ブレーカー（必要時のみ）
    secs.forEach(function (sc) {
      const rc = sc[0];
      const sx = sc[1];
      const tg = sc[2];
      if (rc.breaker) {
        let bb = '<p class="sub-note" style="margin-top:0">条件: 定格 ≥ ' + fmt(rc.breaker.need, 1) + 'A、' + rc.breaker.voltClass + ' Icu ≥ ' +
          (rc.jis ? esc(rc.jis.name) + ' の定格列の値（' + rc.jis.ratings[rc.jis.ratings.length - 1] + 'A超は ' + fmt(rc.iscKa, 2) + 'kA）' : fmt(rc.iscKa, 2) + 'kA') + (rc.input.mode === 'three' ? '' : '（2P）') + '</p><table class="res">';
        bb += breakerRows(rc.breaker, t, '主幹');
        bb += '</table>';
        html += card('二次側 主幹ブレーカー' + sx, bb, anyUnverified(rc.breaker.makers));
      }
    });

    // 分岐ブレーカー（フレーム別）
    secs.forEach(function (sc) {
      const rc = sc[0];
      const sx = sc[1];
      const tg = sc[2];
      const br = rc.branch;
      let brb = '<p class="sub-note" style="margin-top:0">条件: ' + br.voltClass + ' Icu ≥ ' +
        (rc.jis ? esc(rc.jis.name) + '（フレーム最大定格の列）' : fmt(rc.iscKa, 2) + 'kA') + (rc.input.mode === 'three' ? '' : '（2P）') +
        '。二次定格電流 ' + fmt(rc.i2, 1) + 'A を流せるフレームまで表示</p>';
      brb += jisNote(rc, inp);
      Object.keys(br.makers).forEach(function (k) {
        const m = br.makers[k];
        brb += '<h3 class="sub-h">' + esc(m.name) + '　<small>' + esc(m.series) + '</small></h3><table class="res">';
        const tx = [];
        m.rows.forEach(function (x) {
          const range = x.minRating === x.maxRating ? x.maxRating + 'A' : x.minRating + '〜' + x.maxRating + 'A';
          const val = x.ok ? '<strong>' + esc(x.model) + '</strong><br>' + note('Icu ' + x.icu + 'kA ≥ 必要 ' + fmt(x.needKa, 1) + 'kA　定格 ' + range)
            : '<strong>該当なし</strong><br>' + note('最大 ' + esc(x.model) + ' Icu ' + x.icu + 'kA で不足（カスケード等を検討）');
          brb += row(x.af + 'AF', val);
          tx.push(x.af + 'AF ' + (x.ok ? x.model : '該当なし'));
        });
        brb += '</table>';
        t.push(tg + '分岐(' + m.name + '): ' + tx.join(' / '));
      });
      html += card('二次側 分岐ブレーカー（フレーム別）' + sx, brb, anyUnverified(br.makers));
    });

    el.results.innerHTML = html;
    t.push('※メーカーカタログ・内線規程・社内規準による選定（data ' + D.version + '）');
    lastText = t.join('\n');
  }

  function update() {
    const inp = readInput();
    const todo = inp.mode === 'todo';
    el.kva1Field.hidden = !(inp.mode === 'three' && inp.v1 > 600 && !isVv());
    if (el.kva1Field.hidden) { inp.kva1 = null; }
    $('freqField').hidden = !todo;
    const tapOk = tapEnabled(inp);
    $('tapField').hidden = !tapOk;
    buildTaps(inp.kva);
    inp.tap = Number(el.tap.value) || 6600;
    $('tapBox').hidden = !(tapOk && inp.tapOn);
    el.tapSupply.placeholder = String(inp.v1 || 6600);
    if (inp.tapSupply === null) { inp.tapSupply = inp.v1; }
    $('todoMakerField').hidden = !todo;
    $('kvaLabel').textContent = todo ? '定格容量 [kVA]（灯動共用）' : (isVvx() ? '共用変圧器 [kVA]（単相、電灯＋動力）' : (isVv() ? '容量 [kVA]（V結線：単相変圧器1台あたり）' : '容量 [kVA]'));
    $('vvxField').hidden = !isVvx();
    if (isVvx()) {
      const sp = C.vvxSplit(inp.kva, inp.kvaB, inp.vvxSide, inp.vvxLoad, inp.pf1, inp.pf3, inp.vvxLead);
      el.vvxLoad.placeholder = inp.vvxSide === 'pct' ? '空欄=100%' : (inp.vvxSide === 'single' ? '空欄=三相最大' : '空欄=最大 ' + (sp.p3max || '') + 'kVA');
      $('vvxInfo').textContent = sp.error ? '' : '→ 三相 ' + sp.three + 'kVA（最大 √3×専用 = ' + sp.p3max + 'kVA の ' + fmt(sp.pct, 0) + '%）＋ 単相 ' + sp.single + 'kVA';
    }
    const tr = todo ? C.todoRow(inp.todoMaker, inp.kva) : null;
    $('todoInfo').textContent = tr ? '三相側 最大 ' + tr.kva + 'kVA ／ 単相210-105V 最大 ' + tr.single + 'kVA（負荷配分曲線）、%Z ' +
      (tr.zRange ? tr.zRange[0] + '%(50Hz)・' + tr.zRange[1] + '%(60Hz) → 下限 ' + tr.z50 + '% を使用' : tr.z50 + '%(50Hz)・' + tr.z60 + '%(60Hz)') : '';
    const sp = tr ? C.todoSplit(inp.todoMaker, tr.kva, inp.todoSide, inp.todoLoad) : null;
    if (sp && !sp.error) {
      el.todoLoad.placeholder = '空欄=折れ点 ' + (inp.todoSide === 'single' ? sp.knee[1] : sp.knee[0]) + 'kVA';
      $('todoSplit').textContent = '→ 三相側 ' + sp.three + 'kVA ＋ 単相側 ' + sp.single + 'kVA（曲線上）';
    } else {
      $('todoSplit').textContent = '';
    }
    el.z.placeholder = '標準 ' + (tr ? (inp.freq === 60 ? tr.z60 : tr.z50) : C.defaultZ(todo ? 'three' : inp.mode, inp.kva || 0, inp.v2, inp.trType, inp.freq)) + '%';
    $('connField').hidden = !(inp.uiMode === 'three' || inp.uiMode === 'three4w');
    try {
      const r = C.calculate(inp);
      el.err.textContent = '';
      buildConn(r, inp);
      render(r, inp);
    } catch (e) {
      el.err.textContent = e.message;
      el.results.innerHTML = '';
      lastText = '';
    }
    save({
      uiMode: inp.uiMode, trType: inp.trType, mainBreaker: inp.mainBreaker, freq: inp.freq, iscBasis: inp.iscBasis, todoMaker: inp.todoMaker, todoSide: inp.todoSide, todoLoad: el.todoLoad.value, kva: el.kvaSel.value === MANUAL ? (el.kva.value || MANUAL) : el.kvaSel.value,
      v1: el.v1.value === MANUAL ? (el.v1m.value || MANUAL) : el.v1.value,
      v2: el.v2.value === MANUAL ? (el.v2m.value || MANUAL) : el.v2.value,
      z: el.z.value, isc: el.isc.value, kva1: el.kva1.value, tapOn: inp.tapOn, conn: connChoice, kvaB: el.kvaB.value, vvxLead: inp.vvxLead, pf1: el.pf1.value, pf3: el.pf3.value, vvxSide: inp.vvxSide, vvxLoad: el.vvxLoad.value, tap: el.tap.value, tapSupply: el.tapSupply.value
    });
  }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    setTimeout(function () { el.toast.classList.remove('show'); }, 1600);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) { resolve(); } else { reject(new Error('copy failed')); }
    });
  }

  function init() {
    $('ver').textContent = 'data ' + D.version;
    const s = load();
    if (s) {
      setRadio('mode', normUiMode(s.uiMode, s.v2));
      connChoice = typeof s.conn === 'string' ? s.conn : '';
      setRadio('vvxLead', s.vvxLead === false ? 'lag' : 'lead');
      setRadio('vvxSide', ['three', 'single', 'pct'].indexOf(s.vvxSide) >= 0 ? s.vvxSide : 'three');
      el.pf1.value = s.pf1 || ''; el.pf3.value = s.pf3 || ''; el.vvxLoad.value = s.vvxLoad || '';
      setRadio('trType', s.trType === 'mold' ? 'mold' : 'oil');
      setRadio('mainBrk', s.mainBreaker ? 'yes' : 'no');
      setRadio('freq', s.freq === 60 ? '60' : '50');
      setRadio('iscBasis', s.iscBasis === 'calc' ? 'calc' : 'jis');
      setRadio('todoSide', s.todoSide === 'single' ? 'single' : 'three');
      setRadio('todoMaker', s.todoMaker === 'mitsubishi' ? 'mitsubishi' : 'hitachi');
      el.todoLoad.value = s.todoLoad || '';
      el.z.value = s.z || '';
      el.isc.value = s.isc || '';
      el.kva1.value = s.kva1 || '';
      setRadio('tapOn', s.tapOn ? 'yes' : 'no');
      el.tapSupply.value = s.tapSupply || '';
      buildTaps(Number(s.kva) || 300, Number(s.tap) || 6600);
    }
    buildKvaB(s && s.kvaB ? s.kvaB : 50);
    buildVolts(s ? s.v1 : null, s ? s.v2 : 210);
    buildKva(s && s.kva ? s.kva : 300);

    Array.prototype.forEach.call(document.querySelectorAll('input[name="mode"]'), function (r) {
      r.addEventListener('change', function () {
        // 新しいモードの候補にない値は引き継がず、そのモードの既定値にする
        const v2 = voltValue(el.v2, el.v2m);
        const kva = voltValue(el.kvaSel, el.kva);
        const m = uiMode();
        const kvaList = m === 'todo' ? D.todo.makers[radio('todoMaker') === 'mitsubishi' ? 'mitsubishi' : 'hitachi'].rows.map(function (x) { return x[0]; }) : D.capacities[isVv() ? 'single' : calcMode(m)];
        buildVolts(null, V2_OPTIONS[m].indexOf(v2) >= 0 ? v2 : null);
        buildKva(kvaList.indexOf(kva) >= 0 ? kva : (kvaList.indexOf(300) >= 0 ? 300 : kvaList[Math.floor(kvaList.length / 2)]));
        update();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="todoMaker"]'), function (r) {
      r.addEventListener('change', function () {
        const kva = voltValue(el.kvaSel, el.kva);
        const list = D.todo.makers[radio('todoMaker') === 'mitsubishi' ? 'mitsubishi' : 'hitachi'].rows.map(function (x) { return x[0]; });
        buildKva(list.indexOf(kva) >= 0 ? kva : list[Math.floor(list.length / 2)]);
        update();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="trType"], input[name="mainBrk"], input[name="freq"], input[name="todoSide"], input[name="iscBasis"], input[name="tapOn"], input[name="vvxLead"], input[name="vvxSide"]'), function (r) {
      r.addEventListener('change', update);
    });
    [el.kva, el.z, el.isc, el.kva1, el.v1m, el.v2m, el.todoLoad, el.tapSupply, el.pf1, el.pf3, el.vvxLoad].forEach(function (i) { i.addEventListener('input', update); });
    el.kvaB.addEventListener('change', update);
    el.tap.addEventListener('change', update);
    // 結線の選択
    el.connSel.addEventListener('change', function () {
      const wasVv = isVv();
      connChoice = el.connSel.value;
      if (wasVv !== isVv()) { buildKva(voltValue(el.kvaSel, el.kva)); }
      update();
    });
    [[el.kvaSel, el.kva], [el.v1, el.v1m], [el.v2, el.v2m]].forEach(function (p) {
      p[0].addEventListener('change', function () {
        p[1].hidden = p[0].value !== MANUAL;
        if (!p[1].hidden) { p[1].focus(); }
        update();
      });
    });

    $('copyBtn').addEventListener('click', function () {
      if (!lastText) { return; }
      copyText(lastText).then(function () { toast('コピーしました'); }, function () { toast('コピーできませんでした'); });
    });
    $('resetBtn').addEventListener('click', function () {
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* noop */ }
      setRadio('mode', 'three'); setRadio('trType', 'oil'); setRadio('mainBrk', 'no'); setRadio('freq', '50'); setRadio('iscBasis', 'jis'); setRadio('todoSide', 'three'); setRadio('todoMaker', 'hitachi'); el.todoLoad.value = '';
      setRadio('tapOn', 'no'); el.tapSupply.value = ''; connChoice = '';
      setRadio('vvxLead', 'lead'); setRadio('vvxSide', 'three'); el.pf1.value = ''; el.pf3.value = ''; el.vvxLoad.value = ''; buildKvaB(50); buildTaps(300, 6600);
      el.kva.value = ''; el.z.value = ''; el.isc.value = ''; el.kva1.value = '';
      el.v1m.value = ''; el.v2m.value = '';
      buildVolts(null, 210); buildKva(300); update();
    });

    update();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(function () { /* オフライン非対応でも動作 */ });
      });
    }
  }

  init();
})();
