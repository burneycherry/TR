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
  const V1_OPTIONS = { three: HV1.concat(LV1), single: HV1.concat(LV1), 'scott-hv': HV1, 'scott-lv': [440, 420, 415, 400, 210, 200] };
  const V2_OPTIONS = {
    three: [210, 200, 220, 400, 415, 420, 440],
    single: [210, 105, 200, 100, 440, 420],
    'scott-hv': [210, 105, 200, 100],
    'scott-lv': [210, 105, 200, 100]
  };
  const V2_LABEL = { 210: '210 (210/105)' };
  const MODE_LABEL = { three: '三相', single: '単相', 'scott-hv': 'スコット(高圧/低圧)', 'scott-lv': 'スコット(低圧/低圧)' };

  const $ = function (id) { return document.getElementById(id); };
  const el = {
    kva: $('kva'), v1: $('v1'), v2: $('v2'), v1m: $('v1m'), v2m: $('v2m'), z: $('z'), isc: $('isc'),
    kva1: $('kva1'), kva1Field: $('kva1Field'),
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

  function radio(name) {
    const r = document.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : null;
  }
  function setRadio(name, v) {
    const r = document.querySelector('input[name="' + name + '"][value="' + v + '"]');
    if (r) { r.checked = true; }
  }
  function uiMode() { return radio('mode') || 'three'; }
  function calcMode(m) { return m.indexOf('scott') === 0 ? 'scott' : m; }

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
    buildVolt(el.v2, el.v2m, V2_OPTIONS[m], k2, V2_LABEL);
  }

  function buildChips() {
    const m = calcMode(uiMode());
    const list = D.capacities[m];
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
    const m = uiMode();
    return {
      uiMode: m,
      mode: calcMode(m),
      trType: radio('trType') || 'oil',
      kva: Number(el.kva.value),
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
      const val = p ? '<strong>' + esc(p.model) + ' ' + p.rating + 'AT</strong><br>' + note(esc(m.series) + '　' + p.af + 'AF　Icu ' + p.icu + 'kA（' + b.voltClass + '）')
        : '<strong>該当なし</strong><br>' + note('上位機種・カスケード遮断等を個別検討');
      h += row(esc(m.name), val);
      t.push(label + '(' + m.name + '): ' + (p ? p.model + ' ' + p.rating + 'AT(' + p.af + 'AF) Icu' + p.icu + 'kA' : '該当なし'));
    });
    return h;
  }

  function render(r, inp) {
    const n = r.circuits;
    const per = n > 1 ? '（各座・' + n + '回路）' : '';
    const t = [];
    let html = '';

    t.push('【変圧器】' + MODE_LABEL[inp.uiMode] + ' ' + (r.input.trType === 'mold' ? 'モールド ' : '油入 ') + r.input.kva + 'kVA ' + r.input.v1 + 'V/' + r.input.v2 + 'V');

    // 定格電流
    html += card('定格電流',
      '<div class="kv">' + kvItem('一次電流 I₁', fmt(r.i1, 2), 'A') + kvItem('二次電流 I₂' + (n > 1 ? '（各座）' : ''), fmt(r.i2, 1), 'A') + '</div>' +
      (n > 1 ? '<p class="sub-note">スコット二次：M座・T座 各 ' + fmt(r.input.kva / 2, 1) + 'kVA の単相回路</p>' : ''));
    t.push('一次電流: ' + fmt(r.i1, 2) + 'A / 二次電流' + (n > 1 ? '(各座)' : '') + ': ' + fmt(r.i2, 1) + 'A');

    // 短絡電流
    let zNote = '変圧器 %Z = ' + fmt(r.z.tr, 2) + '%' + (r.z.trIsDefault ? '（未入力のため標準値）' : '');
    zNote += r.z.src > 0 ? '、電源側 %Z = ' + fmt(r.z.src, 3) + '%（変圧器容量基準）' : '、電源側は無限大母線';
    html += card('二次側 短絡電流' + per,
      '<div class="kv">' + kvItem('合成 %Z', fmt(r.z.total, 2), '%') + kvItem('短絡電流 Is', fmt(r.iscKa, 2), 'kA') + '</div>' +
      '<p class="sub-note">' + esc(zNote) + '</p>');
    t.push('二次短絡電流: ' + fmt(r.iscKa, 2) + 'kA（%Z ' + fmt(r.z.total, 2) + '%）');

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
      let pbb = '<p class="sub-note" style="margin-top:0">条件: 定格 ≥ I₁×' + D.breaker.primaryFactor + ' = ' + fmt(pb.need, 1) + 'A' +
        (pb.iscGiven ? '、' + pb.voltClass + ' Icu ≥ ' + fmt(pb.iscKa, 2) + 'kA' : '') + '</p><table class="res">';
      pbb += breakerRows(pb, t, '一次側ブレーカー');
      pbb += '</table>';
      if (!pb.iscGiven) { pbb += '<div class="warn">一次側短絡電流が未入力のため遮断容量は未検討です。「一次側短絡電流 [kA]」を入力してください。</div>'; }
      pbb += '<p class="sub-note">低圧/低圧変圧器の一次側は励磁突入電流で不要動作しないよう、瞬時引外し特性（変圧器一次保護用など）をカタログで確認してください。</p>';
      html += card('一次側 ブレーカー', pbb, anyUnverified(pb.makers));
    }

    // CT
    const ctBody = '<div class="kv">' + kvItem('変流比', r.ct.ratio ? esc(r.ct.ratio) : '該当なし', '') +
      kvItem('定格時 CT二次', r.ct.primary ? fmt(r.i2 * r.ct.secondary / r.ct.primary, 2) : '-', 'A') + '</div>' +
      '<p class="sub-note">基準: CT一次 ≥ I₂ × ' + D.ct.factor + '（= ' + fmt(r.ct.need, 1) + 'A）。負担は計器・THR・配線の合計VA以上（' + D.ct.burdens.join('/') + 'VA から選定）。</p>';
    html += card('二次側 CT' + per, ctBody);
    t.push('二次側CT' + (n > 1 ? '(各座)' : '') + ': ' + (r.ct.ratio || '該当なし'));

    // THR
    if (r.thr) {
      let tb = '<p class="sub-note" style="margin-top:0">整定値（変圧器定格時のCT二次電流）: <strong>' + fmt(r.thr.setting, 2) + 'A</strong></p><table class="res">';
      t.push('THR整定: ' + fmt(r.thr.setting, 2) + 'A');
      Object.keys(r.thr.makers).forEach(function (k) {
        const m = r.thr.makers[k];
        const h = m.heater;
        const val = h ? '<strong>ヒータ ' + h.nominal + 'A</strong><br>' + note(esc(m.model) + '（調整範囲 ' + h.min + '〜' + h.max + 'A）')
          : '<strong>該当なし</strong><br>' + note('CT比を見直してください');
        tb += row(esc(m.name), val);
        t.push('THR(' + m.name + '): ' + (h ? m.model + ' ヒータ' + h.nominal + 'A(' + h.min + '-' + h.max + 'A)' : '該当なし'));
      });
      tb += '</table>';
      html += card('二次側 THR（サーマルリレー）' + per, tb, anyUnverified(r.thr.makers));
    }

    // 主幹ブレーカー
    let bb = '<p class="sub-note" style="margin-top:0">条件: 定格 ≥ ' + fmt(r.breaker.need, 1) + 'A、' + r.breaker.voltClass + ' Icu ≥ ' + fmt(r.iscKa, 2) + 'kA' + (r.input.mode === 'three' ? '' : '（2P）') + '</p><table class="res">';
    bb += breakerRows(r.breaker, t, '主幹');
    bb += '</table>';
    html += card('二次側 主幹ブレーカー' + per, bb, anyUnverified(r.breaker.makers));

    // 電線・銅バー
    const cd = r.conductor;
    let cb = '<p class="sub-note" style="margin-top:0">設計電流 ' + fmt(cd.design, 0) + 'A（主幹ブレーカー定格以上）</p><table class="res">';
    const cabTxts = [];
    cd.cable.forEach(function (c) {
      const txt = c.sq ? c.sq + 'sq' + (c.parallel > 1 ? ' × ' + c.parallel + '条' : '') : '該当なし（銅バー推奨）';
      const sub = c.sq ? c.name + '　' + c.basis + ' ' + c.limit + 'A以下' + (c.parallel > 1 ? ' × ' + c.parallel : '') : c.name;
      cb += row(esc(c.group) + '<br>' + esc(c.temp), '<strong>' + esc(txt) + '</strong><br>' + note(esc(sub)));
      cabTxts.push(c.group + c.temp + ' ' + txt);
    });
    const bus = cd.busbar;
    cb += row('銅バー', '<strong>' + (bus ? esc(bus.size) : '該当なし（個別設計）') + '</strong>' + (bus ? '<br>' + note('許容 ' + bus.ampacity + 'A') : ''));
    cb += '</table><p class="sub-note">' + esc(D.cable.note) + '<br>' + esc(D.busbar.note) + '</p>';
    html += card('二次側 電線・銅バー' + per, cb, !(D.cable.verified && D.busbar.verified));
    t.push('電線: ' + cabTxts.join(' / '));
    t.push('銅バー: ' + (bus ? bus.size : '該当なし'));

    // EB（B種接地線）
    if (r.eb) {
      const e = r.eb;
      const eb = '<div class="kv">' + kvItem('EB 接地線', e.sq ? e.sq : '個別検討', e.sq ? 'mm²' : '') +
        kvItem('一相分容量', fmt(e.phaseKva, 1), 'kVA') + '</div>' +
        '<p class="sub-note">B種接地工事の接地線の太さ（' + e.voltClass + '・銅線）。一相分容量：三相=定格÷3、単相=定格、スコット=定格÷2。単相3線式は200V級を適用。<br>' + esc(D.eb.note) + '</p>';
      html += card('EB（B種接地線）サイズ', eb, e.verified === false);
      t.push('EB: ' + (e.sq ? e.sq + 'mm²' : '個別検討'));
    } else {
      html += card('EB（B種接地線）サイズ', '<p class="sub-note" style="margin:0">低圧/低圧変圧器のため B種接地工事は対象外です（混触防止・二次側接地は別途検討）。</p>');
    }

    el.results.innerHTML = html;
    t.push('※LBSヒューズはカタログ選定表、その他は参考値（要カタログ確認）');
    lastText = t.join('\n');
  }

  function update() {
    markChips();
    const inp = readInput();
    el.kva1Field.hidden = !(inp.mode === 'three' && inp.v1 > 600);
    if (el.kva1Field.hidden) { inp.kva1 = null; }
    el.z.placeholder = '標準 ' + C.defaultZ(inp.mode, inp.kva || 0) + '%';
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
      uiMode: inp.uiMode, trType: inp.trType, kva: el.kva.value,
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
      setRadio('mode', V1_OPTIONS[s.uiMode] ? s.uiMode : 'three');
      setRadio('trType', s.trType === 'mold' ? 'mold' : 'oil');
      if (s.kva) { el.kva.value = s.kva; }
      el.z.value = s.z || '';
      el.isc.value = s.isc || '';
      el.kva1.value = s.kva1 || '';
    }
    buildVolts(s ? s.v1 : null, s ? s.v2 : 210);
    buildChips();

    Array.prototype.forEach.call(document.querySelectorAll('input[name="mode"]'), function (r) {
      r.addEventListener('change', function () { buildVolts(null, voltValue(el.v2, el.v2m)); buildChips(); update(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="trType"]'), function (r) {
      r.addEventListener('change', update);
    });
    [el.kva, el.z, el.isc, el.kva1, el.v1m, el.v2m].forEach(function (i) { i.addEventListener('input', update); });
    [[el.v1, el.v1m], [el.v2, el.v2m]].forEach(function (p) {
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
      setRadio('mode', 'three'); setRadio('trType', 'oil');
      el.kva.value = '300'; el.z.value = ''; el.isc.value = ''; el.kva1.value = '';
      el.v1m.value = ''; el.v2m.value = '';
      buildVolts(null, 210); buildChips(); update();
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
