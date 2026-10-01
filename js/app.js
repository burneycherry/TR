/* 画面処理 */
(function () {
  'use strict';

  const C = window.TRCalc;
  const D = C.data;
  const STORE_KEY = 'tr-select-input-v1';

  const V2_OPTIONS = {
    3: [210, 200, 220, 400, 415, 420, 440],
    1: [210, 105, 200, 100]
  };
  const V2_LABEL = { 1: { 210: '210 (210/105)' } };

  const $ = function (id) { return document.getElementById(id); };
  const el = {
    kva: $('kva'), v1: $('v1'), v2: $('v2'), z: $('z'), isc: $('isc'),
    chips: $('kvaChips'), results: $('results'), err: $('inputErr'), toast: $('toast')
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
  function badge(verified) { return verified ? '' : ' <span class="badge">要確認</span>'; }

  function phase() {
    const r = document.querySelector('input[name="phase"]:checked');
    return r && r.value === '1' ? 1 : 3;
  }
  function setPhase(p) {
    const r = document.querySelector('input[name="phase"][value="' + p + '"]');
    if (r) { r.checked = true; }
  }

  function buildV2(keep) {
    const p = phase();
    const cur = keep || Number(el.v2.value);
    el.v2.innerHTML = '';
    V2_OPTIONS[p].forEach(function (v) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = (V2_LABEL[p] && V2_LABEL[p][v]) || String(v);
      el.v2.appendChild(o);
    });
    el.v2.value = V2_OPTIONS[p].indexOf(cur) >= 0 ? String(cur) : String(V2_OPTIONS[p][0]);
  }

  function buildChips() {
    const list = D.capacities[phase() === 1 ? 'single' : 'three'];
    el.chips.innerHTML = '';
    list.forEach(function (k) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(k);
      b.dataset.kva = String(k);
      b.addEventListener('click', function () { el.kva.value = String(k); update(); });
      el.chips.appendChild(b);
    });
  }
  function markChips() {
    const v = Number(el.kva.value);
    Array.prototype.forEach.call(el.chips.children, function (b) {
      b.classList.toggle('on', Number(b.dataset.kva) === v);
    });
  }

  function readInput() {
    return {
      phase: phase(),
      kva: Number(el.kva.value),
      v1: Number(el.v1.value),
      v2: Number(el.v2.value),
      z: el.z.value === '' ? null : Number(el.z.value),
      iscKa: el.isc.value === '' ? null : Number(el.isc.value)
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

  function card(title, body, verified) {
    return '<section class="card"><h2>' + title + (verified === false ? badge(false) : '') + '</h2>' + body + '</section>';
  }
  function kvItem(k, v, unit) {
    return '<div class="item"><div class="k">' + k + '</div><div class="v">' + v + (unit ? '<small>' + unit + '</small>' : '') + '</div></div>';
  }
  function row(th, td) { return '<tr><th>' + th + '</th><td>' + td + '</td></tr>'; }
  function anyUnverified(obj) {
    return Object.keys(obj).some(function (k) { return obj[k].verified === false; });
  }

  function render(r) {
    const ph = r.input.phase === 1 ? '単相' : '三相';
    const t = [];
    let html = '';

    t.push('【変圧器】' + ph + ' ' + r.input.kva + 'kVA ' + r.input.v1 + 'V/' + r.input.v2 + 'V');

    // 定格電流
    html += card('定格電流',
      '<div class="kv">' + kvItem('一次電流 I₁', fmt(r.i1, 2), 'A') + kvItem('二次電流 I₂', fmt(r.i2, 1), 'A') + '</div>');
    t.push('一次電流: ' + fmt(r.i1, 2) + 'A / 二次電流: ' + fmt(r.i2, 1) + 'A');

    // 短絡電流
    let zNote = '変圧器 %Z = ' + fmt(r.z.tr, 2) + '%' + (r.z.trIsDefault ? '（未入力のため標準値）' : '');
    if (r.z.src > 0) { zNote += '、電源側 %Z = ' + fmt(r.z.src, 3) + '%（変圧器容量基準）'; } else { zNote += '、電源側は無限大母線'; }
    html += card('二次側 短絡電流',
      '<div class="kv">' + kvItem('合成 %Z', fmt(r.z.total, 2), '%') + kvItem('短絡電流 Is', fmt(r.iscKa, 2), 'kA') + '</div>' +
      '<p class="sub-note">' + esc(zNote) + '</p>');
    t.push('二次短絡電流: ' + fmt(r.iscKa, 2) + 'kA（%Z ' + fmt(r.z.total, 2) + '%）');

    // LBS ヒューズ
    let fb = '<table class="res">';
    Object.keys(r.fuse.makers).forEach(function (k) {
      const m = r.fuse.makers[k];
      const val = m.rating ? '<strong>T' + m.rating + 'A</strong>' : '<strong>該当なし</strong>';
      fb += row(esc(m.name), val + '<br><span class="sub-note">' + esc(m.fuse) + '（必要 ≥ ' + fmt(m.need, 1) + 'A）</span>');
      t.push('LBSヒューズ(' + m.name + '): ' + (m.rating ? 'T' + m.rating + 'A' : '該当なし'));
    });
    fb += '</table><p class="sub-note">基準: ヒューズ定格 ≥ 一次定格電流 × ' + r.fuse.makers[Object.keys(r.fuse.makers)[0]].factor + '（励磁突入電流を考慮）</p>';
    r.fuse.warn.forEach(function (w) { fb += '<div class="warn">' + esc(w) + '</div>'; });
    html += card('LBS 限流ヒューズ（一次側）', fb, anyUnverified(r.fuse.makers) ? false : undefined);

    // CT
    const ctBody = '<div class="kv">' + kvItem('変流比', r.ct.ratio ? esc(r.ct.ratio) : '該当なし', '') +
      kvItem('定格時 CT二次', r.ct.primary ? fmt(r.i2 * r.ct.secondary / r.ct.primary, 2) : '-', 'A') + '</div>' +
      '<p class="sub-note">基準: CT一次 ≥ I₂ × ' + D.ct.factor + '（= ' + fmt(r.ct.need, 1) + 'A）。負担は計器・THR・配線の合計VA以上（' + D.ct.burdens.join('/') + 'VA から選定）。</p>';
    html += card('二次側 CT', ctBody);
    t.push('二次側CT: ' + (r.ct.ratio || '該当なし'));

    // THR
    if (r.thr) {
      let tb = '<p class="sub-note" style="margin-top:0">整定値（変圧器定格時のCT二次電流）: <strong>' + fmt(r.thr.setting, 2) + 'A</strong></p><table class="res">';
      t.push('THR整定: ' + fmt(r.thr.setting, 2) + 'A');
      Object.keys(r.thr.makers).forEach(function (k) {
        const m = r.thr.makers[k];
        const h = m.heater;
        const val = h ? '<strong>ヒータ ' + h.nominal + 'A</strong><br><span class="sub-note">' + esc(m.model) + '（調整範囲 ' + h.min + '〜' + h.max + 'A）</span>'
          : '<strong>該当なし</strong><br><span class="sub-note">CT比を見直してください</span>';
        tb += row(esc(m.name), val);
        t.push('THR(' + m.name + '): ' + (h ? m.model + ' ヒータ' + h.nominal + 'A(' + h.min + '-' + h.max + 'A)' : '該当なし'));
      });
      tb += '</table>';
      html += card('二次側 THR（サーマルリレー）', tb, anyUnverified(r.thr.makers) ? false : undefined);
    }

    // 主幹ブレーカー
    let bb = '<p class="sub-note" style="margin-top:0">条件: 定格 ≥ ' + fmt(r.breaker.need, 1) + 'A、' + r.breaker.voltClass + ' Icu ≥ ' + fmt(r.iscKa, 2) + 'kA</p><table class="res">';
    Object.keys(r.breaker.makers).forEach(function (k) {
      const m = r.breaker.makers[k];
      const p = m.pick;
      const val = p ? '<strong>' + esc(p.model) + ' ' + p.rating + 'AT</strong><br><span class="sub-note">' + esc(m.series) + '　' + p.af + 'AF　Icu ' + p.icu + 'kA（' + r.breaker.voltClass + '）</span>'
        : '<strong>該当なし</strong><br><span class="sub-note">上位機種・カスケード遮断等を個別検討</span>';
      bb += row(esc(m.name), val);
      t.push('主幹(' + m.name + '): ' + (p ? p.model + ' ' + p.rating + 'AT(' + p.af + 'AF) Icu' + p.icu + 'kA' : '該当なし'));
    });
    bb += '</table>';
    html += card('二次側 主幹ブレーカー', bb, anyUnverified(r.breaker.makers) ? false : undefined);

    // 電線・銅バー
    const cd = r.conductor;
    let cb = '<p class="sub-note" style="margin-top:0">設計電流 ' + fmt(cd.design, 0) + 'A（主幹ブレーカー定格以上）</p><table class="res">';
    const cab = cd.cable;
    const cabTxt = cab ? D.cable.name + ' ' + cab.sq + 'sq' + (cab.parallel > 1 ? ' × ' + cab.parallel + '条' : '') : '該当なし（銅バー推奨）';
    cb += row('電線', '<strong>' + esc(cabTxt) + '</strong>' + (cab ? '<br><span class="sub-note">許容 ' + cab.ampacity + 'A' + (cab.parallel > 1 ? ' × ' + cab.parallel + ' = ' + cab.total + 'A' : '') + '</span>' : ''));
    const bus = cd.busbar;
    cb += row('銅バー', '<strong>' + (bus ? esc(bus.size) : '該当なし（個別設計）') + '</strong>' + (bus ? '<br><span class="sub-note">許容 ' + bus.ampacity + 'A</span>' : ''));
    cb += '</table><p class="sub-note">' + esc(D.cable.note) + '<br>' + esc(D.busbar.note) + '</p>';
    html += card('二次側 電線・銅バー', cb, (D.cable.verified && D.busbar.verified) ? undefined : false);
    t.push('電線: ' + cabTxt + ' / 銅バー: ' + (bus ? bus.size : '該当なし'));

    el.results.innerHTML = html;
    t.push('※参考値。メーカーカタログで要確認');
    lastText = t.join('\n');
  }

  function update() {
    markChips();
    const inp = readInput();
    const zDef = C.defaultZ(inp.phase, inp.kva || 0);
    el.z.placeholder = '標準 ' + zDef + '%';
    try {
      const r = C.calculate(inp);
      el.err.textContent = '';
      render(r);
      save(inp);
    } catch (e) {
      el.err.textContent = e.message;
      el.results.innerHTML = '';
      lastText = '';
    }
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
    const saved = load();
    if (saved) {
      setPhase(saved.phase === 1 ? 1 : 3);
      if (saved.kva) { el.kva.value = String(saved.kva); }
      if (saved.v1) { el.v1.value = String(saved.v1); }
      if (saved.z !== null && saved.z !== undefined) { el.z.value = String(saved.z); }
      if (saved.iscKa !== null && saved.iscKa !== undefined) { el.isc.value = String(saved.iscKa); }
    }
    buildV2(saved ? saved.v2 : null);
    buildChips();

    Array.prototype.forEach.call(document.querySelectorAll('input[name="phase"]'), function (r) {
      r.addEventListener('change', function () { buildV2(); buildChips(); update(); });
    });
    [el.kva, el.z, el.isc].forEach(function (i) { i.addEventListener('input', update); });
    [el.v1, el.v2].forEach(function (s) { s.addEventListener('change', update); });

    $('copyBtn').addEventListener('click', function () {
      if (!lastText) { return; }
      copyText(lastText).then(function () { toast('コピーしました'); }, function () { toast('コピーできませんでした'); });
    });
    $('resetBtn').addEventListener('click', function () {
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* noop */ }
      setPhase(3); el.kva.value = '300'; el.v1.value = '6600'; el.z.value = ''; el.isc.value = '';
      buildV2(210); buildChips(); update();
    });

    update();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* オフライン非対応でも動作 */ });
      });
    }
  }

  init();
})();
