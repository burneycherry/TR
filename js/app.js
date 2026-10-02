/* 画面処理 */
(function () {
  'use strict';

  const C = window.TRCalc;
  const D = C.data;
  const STORE_KEY = 'tr-select-input-v2';
  const MANUAL = 'manual';

  // 電源相モードごとの電圧候補
  const HV1 = [6600, 3300, 22000];
  const LV1 = [440, 420, 415, 400, 220, 210, 200];
  const V1_OPTIONS = { three: HV1.concat(LV1), three4w: HV1.concat(LV1), single: HV1.concat(LV1), scott: HV1.concat(LV1), todo: HV1.concat(LV1) };
  const V2_OPTIONS = {
    three: [210, 200, 220, 400, 415, 420, 440],
    three4w: [415, 400, 420, 440],
    single: [210, 105, 200, 100, 440, 420],
    scott: [210, 105, 200, 100],
    todo: [210]
  };
  const V2_LABELS = {
    three4w: { 415: '415/240', 400: '400/230', 420: '420/242', 440: '440/254' },
    single: { 210: '210 (210/105)' }, scott: { 210: '210 (210/105)' }, todo: { 210: '210 (210/105)' }
  };
  const MODE_LABEL = { three: '三相', three4w: '三相4線式', single: '単相', scott: 'スコット', todo: '灯動' };
  // 旧保存値（スコット高圧/低圧・低圧/低圧）は スコット に統一
  function normUiMode(m) { return m && m.indexOf('scott') === 0 ? 'scott' : (V1_OPTIONS[m] ? m : 'three'); }

  const $ = function (id) { return document.getElementById(id); };
  const el = {
    kva: $('kva'), v1: $('v1'), v2: $('v2'), v1m: $('v1m'), v2m: $('v2m'), z: $('z'), isc: $('isc'),
    kva1: $('kva1'), kva1Field: $('kva1Field'), todoLoad: $('todoLoad'),
    kvaSel: $('kvaSel'), results: $('results'), err: $('inputErr'), toast: $('toast')
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
  function calcMode(m) { return m === 'three4w' ? 'three' : m; }

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
    const labels = m === 'single' ? { 750: '750（JIS外）', 1000: '1000（JIS外）' } : null;
    const list = m === 'todo' ? D.todo.makers[radio('todoMaker') === 'mitsubishi' ? 'mitsubishi' : 'hitachi'].rows.map(function (r) { return r[0]; }) : D.capacities[m];
    buildVolt(el.kvaSel, el.kva, list, keep, labels);
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
      kva1: el.kva1.value === '' ? null : Number(el.kva1.value)
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

  // キュービクルの遮断容量の表（JIS C 4620 解説表1 優先、無い範囲は認定の手引き 補足表1）
  function tblLine(j) {
    return j.ratings.map(function (x, i) { return x + 'A以下 ' + (j.values[i] === null ? '—' : fmt(j.values[i], 1) + 'kA'); }).join('／');
  }
  function jisNote(rc, inp) {
    const j = rc.jis;
    if (!j) {
      return inp.iscBasis === 'jis' && (rc.input.mode === 'three' || rc.input.mode === 'single') ?
        '<p class="sub-note">JIS C 4620 解説表1・認定の手引き 補足表1 の対象外のため計算値でブレーカーを選定</p>' : '';
    }
    const head = esc(j.name) + '（' + (j.src === 'jis' ? j.freq + 'Hz・' : j.circuit + '・') + j.kva + 'kVA' + (j.exact ? '' : '：直近上位の行') + '）';
    let h = '<p class="sub-note"><strong>' + head + 'でブレーカーを選定</strong><br>' + tblLine(j) + '<br>' +
      (j.src === 'jis' ? 'JIS C 4304 調査値（短絡電流の最大値）。' : 'JIS C 4620 解説表1 に無い範囲のため手引きで補完。') +
      j.ratings[j.ratings.length - 1] + 'A 超は計算値。</p>';
    if (rc.iscRef) {
      const g = rc.iscRef;
      h += '<p class="sub-note">参考：' + esc(g.name) + '（' + g.circuit + '・' + g.kva + 'kVA）<br>' + tblLine(g) + '</p>';
    }
    return h;
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
    if (m === 'single') {
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
      tx(xv - 6, yt + 4, 'v2', 'end'); tx(xv - 6, (yt + yu) / 2 + 4, '02', 'end'); tx(xv - 6, yu + 4, 'u2', 'end');
      const xh0 = xv + 12, xh1 = xv + 76, yh = yu + 8;
      ln(xh0, yh, xh1, yh); dot(xh0, yh); dot((xh0 + xh1) / 2, yh); dot(xh1, yh);
      tx(xh0, yh + 14, 'v1'); tx((xh0 + xh1) / 2, yh + 14, '01'); tx(xh1, yh + 14, 'u1');
      ln(xh0, yu - 6, xh0 + 6, yu - 6); ln(xh0 + 6, yu - 6, xh0 + 6, yu); // 直角記号
      name = 'スコット結線（一次 T結線、二次 2回路は90°位相差。各座 単相3線、接地は u2・v2 または中点 01・02：カタログ・仕様書で確認）';
      outs = ['単相3線×2', v2 + '/' + (v2 / 2) + 'V'];
    } else if (m === 'todo') {
      const t = star(P, Y0, ['U', 'W', 'V']); dot(t.a[0], t.a[1]); dot(t.b[0], t.b[1]); dot(t.c[0], t.c[1]);
      const u = [S + 16, Y0 - R], v = [S + 16, Y0 + R], w = [S - 30, Y0], o = [S + 16, Y0];
      ln(w[0], w[1], u[0], u[1]); ln(u[0], u[1], v[0], v[1]); ln(v[0], v[1], w[0], w[1]);
      [u, v, w, o].forEach(function (q) { dot(q[0], q[1]); });
      tx(u[0] + 8, u[1] + 4, 'u', 'start'); tx(v[0] + 8, v[1] + 4, 'v', 'start'); tx(w[0] - 7, w[1] + 4, 'w', 'end'); tx(o[0] - 5, o[1] - 4, 'o', 'end');
      ln(o[0], o[1], o[0] + 28, o[1]); gnd(o[0] + 28, o[1]);
      name = 'Y-Δ 灯動共用（二次Δの一相中点 o を引出し・o 接地）';
      outs = ['三相 u-v-w', v2 + 'V', '単相 u-o-v', v2 + '-' + (v2 / 2) + 'V'];
    } else if (v2 > 300) {
      const t = delta(P, Y0, ['U', 'W', 'V']); dot(t.a[0], t.a[1]); dot(t.b[0], t.b[1]); dot(t.c[0], t.c[1]);
      const t2 = star(S, Y0, ['u', 'w', 'v']); dot(t2.a[0], t2.a[1]); dot(t2.b[0], t2.b[1]); dot(t2.c[0], t2.c[1]); dot(S, Y0);
      tx(S + 8, Y0 - 2, 'N', 'start');
      ln(S, Y0, S, Y0 + R + 10); ln(S, Y0 + R + 10, S + 30, Y0 + R + 10); gnd(S + 30, Y0 + R + 10);
      name = 'Δ-Y（Dyn11）中性点 N 接地';
      outs = inp.uiMode === 'three4w' ? ['三相4線', v2 + '/' + Math.round(v2 / Math.sqrt(3)) + 'V'] : ['三相 ' + v2 + 'V'];
    } else {
      const t = star(P, Y0, ['U', 'W', 'V']); dot(t.a[0], t.a[1]); dot(t.b[0], t.b[1]); dot(t.c[0], t.c[1]);
      const t2 = delta(S, Y0, ['u', 'w', 'v']); dot(t2.a[0], t2.a[1]); dot(t2.b[0], t2.b[1]); dot(t2.c[0], t2.c[1]);
      ln(t2.c[0], t2.c[1], t2.c[0] + 24, t2.c[1]); gnd(t2.c[0] + 24, t2.c[1]);
      name = 'Y-Δ（Yd1）二次一端接地 ※Δ-Δ（Dd0）の機種もあり';
      outs = ['三相3線 ' + v2 + 'V'];
    }
    tx(P, 14, '一次 ' + v1 + 'V');
    tx(S, 14, '二次');
    outs.forEach(function (o2, i) { tx(262, Y0 - 6 - (outs.length > 2 ? 16 : 0) + i * 16, o2, 'start'); });
    return '<svg class="wd" viewBox="0 0 340 168" role="img" aria-label="結線図">' + out.join('') + '</svg>' +
      '<p class="sub-note">' + esc(name) + '。結線は代表例（三菱 油入変圧器カタログ L-10034-H・日立 灯動共用 製品ページ）。実機は銘板・仕様書で確認。</p>';
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
    const kvaLbl = r.todo ? r.input.kva + 'kVA（配分 三相' + r.input.kva3 + '＋単相' + r.input.kva1 + 'kVA、' + r.input.freq + 'Hz）' : r.input.kva + 'kVA';
    t.push('【変圧器】' + MODE_LABEL[inp.uiMode] + ' ' + (r.input.trType === 'mold' ? 'モールド ' : '油入 ') + kvaLbl + ' ' + r.input.v1 + 'V/' + v2Lbl.split(' ')[0] + 'V');

    // 結線図
    html += card('結線図', wiring(r, inp));

    // 定格電流
    if (r.todo) {
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
        (inp.uiMode === 'three4w' ? '<p class="sub-note">三相4線式 ' + esc(v2Lbl) + 'V：電流は線間電圧 ' + r.input.v2 + 'V で計算</p>' : ''));
      t.push('一次電流: ' + fmt(r.i1, 2) + 'A / 二次電流' + (n > 1 ? '(各座)' : '') + ': ' + fmt(r.i2, 1) + 'A');
    }

    // 短絡電流
    secs.forEach(function (sc) {
      const rc = sc[0];
      const sx = sc[1];
      const tg = sc[2];
      let zNote = '変圧器 %Z = ' + fmt(rc.z.tr, 2) + '%' + (rc.z.trIsDefault ? '（未入力のため標準値）' : '');
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
      fb += '</table><p class="sub-note">三菱：' + esc(mi.note) + '<br>富士：' + esc(fu.note) + '</p>';
      f.warn.forEach(function (w) { fb += '<div class="warn">' + esc(w) + '</div>'; });
      html += card('LBS 限流ヒューズ（一次側）', fb, mi.verified === false || fu.verified === false);
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
        '<p class="sub-note">表2.13.1（' + e.voltClass + '）：' + (e.sq !== null ? e.sq + 'mm²' : '範囲外') + '</p>' + up +
        '<p class="sub-note">B種接地工事の接地線の太さ（' + e.voltClass + '・銅線）。一相分容量：三相=定格÷3、単相=定格、スコット=定格÷2、灯動共用=単相分＋三相分÷3。単相3線式は200V級を適用。<br>' + esc(D.eb.note) + '</p>';
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
    el.kva1Field.hidden = !(inp.mode === 'three' && inp.v1 > 600);
    if (el.kva1Field.hidden) { inp.kva1 = null; }
    $('freqField').hidden = !todo;
    $('todoMakerField').hidden = !todo;
    $('kvaLabel').textContent = todo ? '定格容量 [kVA]（灯動共用）' : '容量 [kVA]';
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
    el.z.placeholder = '標準 ' + (tr ? (inp.freq === 60 ? tr.z60 : tr.z50) : C.defaultZ(todo ? 'three' : inp.mode, inp.kva || 0, inp.v2)) + '%';
    try {
      const r = C.calculate(inp);
      el.err.textContent = '';
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
      z: el.z.value, isc: el.isc.value, kva1: el.kva1.value
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
      setRadio('mode', normUiMode(s.uiMode));
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
    }
    buildVolts(s ? s.v1 : null, s ? s.v2 : 210);
    buildKva(s && s.kva ? s.kva : 300);

    Array.prototype.forEach.call(document.querySelectorAll('input[name="mode"]'), function (r) {
      r.addEventListener('change', function () {
        // 新しいモードの候補にない値は引き継がず、そのモードの既定値にする
        const v2 = voltValue(el.v2, el.v2m);
        const kva = voltValue(el.kvaSel, el.kva);
        const m = uiMode();
        const kvaList = m === 'todo' ? D.todo.makers[radio('todoMaker') === 'mitsubishi' ? 'mitsubishi' : 'hitachi'].rows.map(function (x) { return x[0]; }) : D.capacities[calcMode(m)];
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
    Array.prototype.forEach.call(document.querySelectorAll('input[name="trType"], input[name="mainBrk"], input[name="freq"], input[name="todoSide"], input[name="iscBasis"]'), function (r) {
      r.addEventListener('change', update);
    });
    [el.kva, el.z, el.isc, el.kva1, el.v1m, el.v2m, el.todoLoad].forEach(function (i) { i.addEventListener('input', update); });
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
