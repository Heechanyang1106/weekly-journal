/* 한 주 저널 — 바탕화면 달력 (Lively Wallpaper용)
 * 주소: widget.html#k=<바탕화면 주소 키>  · 사이트 ⚙ 설정 → 바탕화면 달력에서 만들어요
 * 일정은 읽기만 해요. 고치는 건 사이트에서.
 */
(function () {
  'use strict';
  var FIREBASE_VERSION = '10.12.2';
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
  var DEFAULT_START = '09:00';

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseKey(k) { var p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function startOfWeek(d) { return addDays(d, -((d.getDay() + 6) % 7)); }
  function toMin(t) { if (!t) return null; var p = t.split(':').map(Number); return p[0] * 60 + p[1]; }
  function endMin(t) { var m = toMin(t); return m === 0 ? 1440 : m; }
  function fromMin(m) { if (m >= 1440) return '24:00'; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function mdDow(k) { var d = parseKey(k); return (d.getMonth() + 1) + '/' + d.getDate() + ' (' + DOW[d.getDay()] + ')'; }
  function todayKey() { return keyOf(new Date()); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function hexA(hex, a) {
    var h = (hex || '#888888').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
  }
  function holidayOf(k) { return (window.WJ_HOLIDAYS || {})[k] || ''; }
  function termOf(k) { return (window.WJ_TERMS || {})[k] || ''; }
  var FLAG = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M3.5 15V2M3.5 2.5h8.5l-2 3 2 3H3.5"/></svg>';

  /* ---------- 이 바탕화면만의 설정 (브라우저 저장소) ---------- */
  function load(k, d) { try { var v = localStorage.getItem('wjw-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem('wjw-' + k, JSON.stringify(v)); } catch (e) {} }
  var P = { alpha: load('alpha', 45), blur: load('blur', 14), scale: load('scale', 100), start: load('start', 'week'), monthAll: load('monthAll', false), padL: load('padL', 24), padB: load('padB', 60), bg: load('bg', 'night') };
  var BGS = ['night', 'dawn', 'forest', 'sunset', 'ocean', 'ink'];
  if (BGS.indexOf(P.bg) < 0) P.bg = 'night';
  var SYNC = { checked: null, refresh: null };

  var S = { view: P.start, week: startOfWeek(new Date()), month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), data: null };

  /* ---------- 데이터 ---------- */
  function cats() { return (S.data && S.data.cats && S.data.cats.length) ? S.data.cats : [{ id: 'x', name: '', color: '#8a9be0' }]; }
  function catOf(id) { var c = cats(); for (var i = 0; i < c.length; i++) if (c[i].id === id) return c[i]; return c[0]; }
  function events() { return (S.data && S.data.events) || []; }
  function habits() { return (S.data && S.data.habits) || []; }
  function isDl(ev) { return ev.kind === 'deadline'; }
  function occursOn(ev, k, dow) {
    if (ev.repeat === 'weekly') {
      if (!ev.days || ev.days.indexOf(dow) < 0) return false;
      if (ev.from && k < ev.from) return false;
      if (ev.until && k > ev.until) return false;
      if (ev.skip && ev.skip[k]) return false;
      return true;
    }
    return ev.date === k;
  }
  function occurrencesFor(keys) {
    var out = keys.map(function () { return []; });
    var dows = keys.map(function (k) { return parseKey(k).getDay(); });
    events().forEach(function (ev) {
      keys.forEach(function (k, i) { if (occursOn(ev, k, dows[i])) out[i].push({ ev: ev, date: k, done: !!(ev.done && ev.done[k]) }); });
    });
    out.forEach(function (l) { l.sort(function (a, b) { return toMin(a.ev.start || DEFAULT_START) - toMin(b.ev.start || DEFAULT_START); }); });
    return out;
  }
  function layoutDay(items) {
    items.sort(function (a, b) { return a.s - b.s || b.e - a.e; });
    var clusters = [], cur = null, curEnd = -1;
    items.forEach(function (it) {
      if (!cur || it.s >= curEnd) { cur = []; clusters.push(cur); curEnd = it.e; }
      cur.push(it); curEnd = Math.max(curEnd, it.e);
    });
    clusters.forEach(function (cl) {
      var lanes = [];
      cl.forEach(function (it) {
        for (var i = 0; i < lanes.length; i++) if (lanes[i] <= it.s) { lanes[i] = it.e; it.lane = i; return; }
        it.lane = lanes.length; lanes.push(it.e);
      });
      cl.forEach(function (it) { it.lanes = lanes.length; });
    });
    return items;
  }
  function weekKeys() { return [0, 1, 2, 3, 4, 5, 6].map(function (i) { return keyOf(addDays(S.week, i)); }); }

  /* ---------- 그리기 ---------- */
  function render() {
    if (!S.data) return;
    $('#wrap').hidden = false; $('#msg').hidden = true;
    var month = S.view === 'month';
    $('#vWeek').setAttribute('aria-checked', !month);
    $('#vMonth').setAttribute('aria-checked', month);
    $('#moFilter').hidden = !month;
    $('#moFilter').querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-checked', (b.dataset.mf === 'all') === !!P.monthAll); });
    if (month) renderMonth(); else renderWeek();
    renderSide();
    renderSync();
  }

  function renderWeek() {
    var keys = weekKeys(), tk = todayKey();
    var thu = addDays(S.week, 3);
    var tw = keyOf(startOfWeek(new Date())) === keys[0];
    $('#title').textContent = (thu.getMonth() + 1) + '월 ' + Math.ceil(thu.getDate() / 7) + '주차';
    var e = addDays(S.week, 6);
    $('#range').textContent = S.week.getFullYear() + '.' + pad(S.week.getMonth() + 1) + '.' + pad(S.week.getDate()) + ' — ' + pad(e.getMonth() + 1) + '.' + pad(e.getDate());
    $('#today').textContent = tw ? '이번 주' : '이번 주로';
    $('#prev').setAttribute('aria-label', '지난 주'); $('#next').setAttribute('aria-label', '다음 주');

    var occ = occurrencesFor(keys);
    var hs = Number(S.data.hourStart) || 8, he = Number(S.data.hourEnd) || 24;
    if (!(he > hs)) { hs = 8; he = 24; }
    occ.forEach(function (l) {
      l.forEach(function (o) {
        var s = toMin(o.ev.start || DEFAULT_START), en = isDl(o.ev) ? s + 1 : (o.ev.end && o.ev.start ? endMin(o.ev.end) : s + 60);
        hs = Math.min(hs, Math.floor(s / 60)); he = Math.max(he, Math.min(24, Math.ceil(en / 60)));
      });
    });
    var rows = he - hs;
    var board = $('#board');
    // 시간 칸 높이: 보드 높이에 맞춰서
    var headH = 58;
    var H = Math.max(16, Math.floor((board.clientHeight - headH - 2) / rows));
    document.documentElement.style.setProperty('--hour', H + 'px');

    var html = '<div class="wk-head"><div></div>' + keys.map(function (k) {
      var d = parseKey(k), dw = d.getDay(), hol = holidayOf(k), term = termOf(k);
      return '<div class="wk-day' + (k === tk ? ' is-today' : '') + '"><div class="d1"><span class="dow ' + (dw === 0 || hol ? 'sun' : dw === 6 ? 'sat' : '') + '">' + DOW[dw] + '</span>' +
        '<span class="date' + (hol ? ' sun' : '') + '">' + (d.getMonth() + 1) + '/' + d.getDate() + '</span></div>' +
        '<span class="lbl ' + (hol ? 'hol' : 'term') + '">' + esc(hol || term) + '</span></div>';
    }).join('') + '</div>';
    html += '<div class="wk-body" style="height:' + (rows * H) + 'px"><div class="wk-times">';
    for (var h = hs; h < he; h++) html += '<span style="top:' + ((h - hs) * H) + 'px">' + pad(h) + ':00</span>';
    html += '</div>';
    var now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
    keys.forEach(function (k, i) {
      var items = [], dls = [];
      occ[i].forEach(function (o) {
        var ev = o.ev;
        if (isDl(ev)) { dls.push({ o: o, s: clamp(toMin(ev.start || '23:59'), hs * 60, he * 60) }); return; }
        var s = toMin(ev.start || DEFAULT_START), en = ev.end && ev.start ? endMin(ev.end) : s + 60;
        items.push({ o: o, s: clamp(s, hs * 60, he * 60 - 15), e: Math.min(Math.max(en, s + 15), he * 60), rs: s, re: en });
      });
      html += '<div class="wk-col' + (k === tk ? ' is-today' : '') + '">';
      layoutDay(items).forEach(function (it) {
        var ev = it.o.ev, c = catOf(ev.cat).color;
        var top = (it.s - hs * 60) / 60 * H, height = (it.e - it.s) / 60 * H, w = 100 / it.lanes;
        var short = height < 36;
        var time = fromMin(it.rs) + '–' + fromMin(it.re);
        html += '<div class="ev' + (ev.star ? ' star' : '') + (it.o.done ? ' done' : '') + (short ? ' short' : '') + '" title="' + esc(ev.title + '\n' + time + (ev.place ? '\n' + ev.place : '')) + '"' +
          ' style="--c:' + esc(c) + ';--cbg:' + hexA(c, ev.star ? .8 : .45) + ';top:' + (top + 1) + 'px;height:' + Math.max(height - 2, 16) + 'px;left:calc(' + (it.lane * w) + '% + 3px);width:calc(' + w + '% - 6px)">' +
          (short ? '<span class="m">' + esc(ev.start || DEFAULT_START) + '</span>' : '') +
          '<span class="t">' + (ev.star ? '★ ' : '') + esc(ev.title) + '</span>' +
          (!short ? '<span class="m">' + time + '</span>' : '') +
          (ev.place && height >= 70 ? '<span class="m">' + esc(ev.place) + '</span>' : '') + '</div>';
      });
      dls.forEach(function (d) {
        var ev = d.o.ev, c = catOf(ev.cat).color, y = (d.s - hs * 60) / 60 * H;
        html += '<div class="dl' + (d.o.done ? ' done' : '') + '" style="--c:' + esc(c) + ';top:' + (y >= 22 ? y - 22 : y) + 'px">' + FLAG + '<span>' + esc((ev.start || '23:59') + ' ' + ev.title) + '</span></div>';
      });
      if (k === tk && nm >= hs * 60 && nm <= he * 60) html += '<div class="now" style="top:' + ((nm - hs * 60) / 60 * H) + 'px"></div>';
      html += '</div>';
    });
    html += '</div>';
    board.innerHTML = html;
  }

  function renderMonth() {
    var first = S.month, now = new Date();
    $('#title').textContent = first.getFullYear() + '년 ' + (first.getMonth() + 1) + '월';
    $('#range').textContent = '';
    $('#today').textContent = (first.getFullYear() === now.getFullYear() && first.getMonth() === now.getMonth()) ? '이번 달' : '이번 달로';
    $('#prev').setAttribute('aria-label', '지난 달'); $('#next').setAttribute('aria-label', '다음 달');
    var start = startOfWeek(first), last = new Date(first.getFullYear(), first.getMonth() + 1, 0), end = addDays(startOfWeek(last), 6);
    var keys = [];
    for (var d = start; d <= end; d = addDays(d, 1)) keys.push(keyOf(d));
    var occ = occurrencesFor(keys), tk = todayKey(), all = !!P.monthAll;
    var html = '<div class="mo-head">' + WEEK_ORDER.map(function (i) { return '<div class="' + (i === 0 ? 'sun' : i === 6 ? 'sat' : '') + '">' + DOW[i] + '</div>'; }).join('') + '</div>';
    html += '<div class="mo-grid" style="grid-template-rows:repeat(' + (keys.length / 7) + ',minmax(0,1fr))">';
    keys.forEach(function (k, i) {
      var dt = parseKey(k), hol = holidayOf(k), term = termOf(k), list = occ[i];
      var items = list.filter(function (o) { return all || o.ev.star || isDl(o.ev); })
        .sort(function (a, b) { return (isDl(b.ev) ? 1 : 0) - (isDl(a.ev) ? 1 : 0); });
      var hidden = list.length - items.length, shown = items.slice(0, 4);
      html += '<div class="mo-day' + (dt.getMonth() !== first.getMonth() ? ' other' : '') + (k === tk ? ' is-today' : '') + '">' +
        '<div class="mo-top"><span class="mo-num ' + (dt.getDay() === 0 || hol ? 'sun' : dt.getDay() === 6 ? 'sat' : '') + '">' + dt.getDate() + '</span>' +
        (hol || term ? '<span class="lbl ' + (hol ? 'hol' : 'term') + '">' + esc(hol || term) + '</span>' : '') + '</div>' +
        shown.map(function (o) {
          var ev = o.ev, c = catOf(ev.cat).color, dl = isDl(ev), plain = !dl && !ev.star;
          return '<div class="mi' + (dl ? ' dlm' : '') + (plain ? ' plain' : '') + (o.done ? ' done' : '') + '" style="--c:' + esc(c) + ';--cbg2:' + hexA(c, .7) + '">' +
            (dl ? '⚑ ' + esc(ev.start || '23:59') + ' ' : ev.star ? '★ ' : esc(ev.start || '') + ' ') + esc(ev.title) + '</div>';
        }).join('') +
        (items.length > shown.length ? '<span class="more">+' + (items.length - shown.length) + '개</span>' : (!all && hidden ? '<span class="more">+' + hidden + '</span>' : '')) +
        '</div>';
    });
    html += '</div>';
    $('#board').innerHTML = html;
  }

  function renderSide() {
    var tk = todayKey(), td = parseKey(tk);
    $('#hbDate').textContent = (td.getMonth() + 1) + '/' + td.getDate() + ' ' + DOW[td.getDay()];
    var list = habits().filter(function (h) { return !h.archived && (!h.from || tk >= h.from) && (h.days || [0, 1, 2, 3, 4, 5, 6]).indexOf(td.getDay()) >= 0; });
    $('#habits').innerHTML = list.length ? '<div class="hb-list">' + list.map(function (h) {
      var done = !!(h.checks || {})[tk];
      return '<div class="hb' + (done ? ' done' : '') + '" style="--h:' + esc(h.color) + '"><span class="dot"></span><span class="nm">' + esc(h.name) + '</span>' +
        '<span class="sr-only">' + (done ? ' 완료' : ' 할 일') + '</span></div>';
    }).join('') + '</div>' : '<p class="empty">오늘 체크할 습관이 없어요.</p>';

    var dls = [], base = parseKey(tk), seen = {};
    events().filter(isDl).forEach(function (ev) {
      for (var i = -7; i <= 30; i++) {
        var k = keyOf(addDays(base, i));
        if (!occursOn(ev, k, parseKey(k).getDay()) || (ev.done && ev.done[k])) continue;
        if (i >= 0) { if (seen[ev.id]) continue; seen[ev.id] = true; }
        dls.push({ ev: ev, k: k, diff: i });
      }
    });
    dls.sort(function (a, b) { return a.k < b.k ? -1 : a.k > b.k ? 1 : 0; });
    $('#dls').innerHTML = dls.length ? dls.slice(0, 4).map(function (d) {
      var dd = d.diff === 0 ? 'D-day' : d.diff > 0 ? 'D-' + d.diff : (-d.diff) + '일 지남';
      return '<div class="dl-row"><span class="dd' + (d.diff <= 2 ? ' soon' : '') + '">' + dd + '</span><span class="tx"><b>' + esc(d.ev.title) + '</b><span>' + mdDow(d.k) + ' ' + esc(d.ev.start || '23:59') + '</span></span></div>';
    }).join('') : '<p class="empty">다가오는 마감이 없어요.</p>';
    renderTasks();
  }

  /* ---------- 할 일 모음 (이번 주 + 이번 달, 남은 것과 일정으로 옮긴 것만) ---------- */
  function tasks() { return (S.data && S.data.tasks) || []; }
  function evById(id) { var e = events(); for (var i = 0; i < e.length; i++) if (e[i].id === id) return e[i]; return null; }
  function renderTasks() {
    var now = new Date(), wk = keyOf(startOfWeek(now)), legacy = keyOf(addDays(startOfWeek(now), -1));
    var mk = (function () { var t = addDays(startOfWeek(now), 3); return t.getFullYear() + '-' + pad(t.getMonth() + 1); })();
    var todo = [], moved = [];
    tasks().filter(function (t) {
      return t.scope === 'week' ? (t.period === wk || t.period === legacy) : t.period === mk;
    }).sort(function (a, b) { return (a.scope === b.scope ? 0 : a.scope === 'week' ? -1 : 1) || (a.created || 0) - (b.created || 0); })
      .forEach(function (t) {
        var ev = t.state === 'moved' && t.eventId ? evById(t.eventId) : null;
        if (t.state === 'moved' && ev) {
          var when, done = false;
          if (ev.repeat === 'weekly') when = '매주 ' + (ev.days || []).slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); }).map(function (d) { return DOW[d]; }).join('·') + (ev.start ? ' ' + ev.start : '');
          else { when = mdDow(ev.date) + (ev.start ? ' ' + ev.start : ''); done = !!(ev.done && ev.done[ev.date]); }
          if (!done) moved.push({ text: ev.title, sub: when + (isDl(ev) ? ' 마감' : '') });
        } else if (t.state === 'todo' || (t.state === 'moved' && t.eventId)) {
          todo.push({ text: t.text, month: t.scope === 'month' });
        } else if (t.state === 'moved') {
          moved.push({ text: t.text, sub: '' }); // 예전 버전에서 옮긴 것(연결 정보 없음)
        }
      });
    var html = '';
    if (todo.length) html += '<div class="tk-group"><h3>할 일<span>' + todo.length + '</span></h3><ul>' + todo.map(function (t) {
      return '<li class="tk"><span class="sig" aria-hidden="true">•</span><span class="tx">' + esc(t.text) + (t.month ? '<em>이번 달</em>' : '') + '</span></li>';
    }).join('') + '</ul></div>';
    if (moved.length) html += '<div class="tk-group"><h3>일정으로 옮김<span>' + moved.length + '</span></h3><ul>' + moved.map(function (t) {
      return '<li class="tk moved"><span class="sig" aria-hidden="true">&gt;</span><span class="tx">' + esc(t.text) + (t.sub ? '<small>' + esc(t.sub) + '</small>' : '') + '</span></li>';
    }).join('') + '</ul></div>';
    $('#tks').innerHTML = html || '<p class="empty">남은 할 일이 없어요.</p>';
    var el = $('#tks'); el.classList.remove('more');
    if (el.scrollHeight > el.clientHeight + 1) el.classList.add('more'); // 넘치면 아래를 흐리게
  }

  /* ---------- 새로고침 정보 ---------- */
  function stampOf(t) {
    if (!t) return '-';
    var d = new Date(t);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function renderSync() {
    $('#syncInfo').innerHTML = '마지막 새로고침 ' + stampOf(SYNC.checked) + '<br>사이트에서 마지막 저장 ' + stampOf(S.data && S.data.updated);
  }

  /* ---------- 설정 패널 ---------- */
  function applyLook() {
    var r = document.documentElement.style;
    r.setProperty('--a', (P.alpha / 100).toFixed(2));
    r.setProperty('--blur', P.blur + 'px');
    var z = P.scale / 100;
    document.body.style.zoom = z;
    // 여백은 화면 기준 크기라 전체 크기(zoom)와 상관없이 같게
    r.setProperty('--padL', (P.padL / z).toFixed(1) + 'px');
    r.setProperty('--padB', (P.padB / z).toFixed(1) + 'px');
    $('#sAlpha').value = P.alpha; $('#sAlphaV').textContent = P.alpha + '%';
    $('#sBlur').value = P.blur; $('#sBlurV').textContent = P.blur + 'px';
    $('#sScale').value = P.scale; $('#sScaleV').textContent = P.scale + '%';
    $('#sPadL').value = P.padL; $('#sPadLV').textContent = P.padL + 'px';
    $('#sPadB').value = P.padB; $('#sPadBV').textContent = P.padB + 'px';
    $('#sStart').textContent = '처음 보기: ' + (P.start === 'month' ? '한 달' : '이번 주');
    document.body.dataset.bg = P.bg;
    $('#sBg').querySelectorAll('[data-bg]').forEach(function (b) {
      b.setAttribute('aria-checked', !document.body.classList.contains('has-photo') && b.dataset.bg === P.bg);
    });
  }
  // 배경 사진은 용량이 커서 IndexedDB에 저장
  function photoDb(fn) {
    try {
      var req = indexedDB.open('wjw', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
      req.onsuccess = function () { fn(req.result); };
      req.onerror = function () {};
    } catch (e) {}
  }
  function loadPhoto() {
    photoDb(function (db) {
      try {
        var g = db.transaction('kv').objectStore('kv').get('photo');
        g.onsuccess = function () { setPhoto(g.result || null); };
      } catch (e) {}
    });
  }
  var photoUrl = null;
  function setPhoto(blob) {
    if (photoUrl) { URL.revokeObjectURL(photoUrl); photoUrl = null; }
    if (blob) {
      photoUrl = URL.createObjectURL(blob);
      document.body.style.setProperty('--photo', 'url("' + photoUrl + '")');
      document.body.classList.add('has-photo');
    } else document.body.classList.remove('has-photo');
    applyLook();
  }
  function savePhoto(blob) {
    photoDb(function (db) {
      try {
        var tx = db.transaction('kv', 'readwrite');
        if (blob) tx.objectStore('kv').put(blob, 'photo'); else tx.objectStore('kv').delete('photo');
      } catch (e) {}
    });
    setPhoto(blob);
  }

  function bind() {
    $('#vWeek').onclick = function () { S.view = 'week'; render(); };
    $('#vMonth').onclick = function () { S.view = 'month'; render(); };
    $('#moFilter').addEventListener('click', function (e) {
      var b = e.target.closest('[data-mf]'); if (!b) return;
      P.monthAll = b.dataset.mf === 'all'; save('monthAll', P.monthAll); render();
    });
    $('#prev').onclick = function () {
      if (S.view === 'month') S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1); else S.week = addDays(S.week, -7);
      render();
    };
    $('#next').onclick = function () {
      if (S.view === 'month') S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1); else S.week = addDays(S.week, 7);
      render();
    };
    $('#today').onclick = function () { goToday(); render(); };
    $('#gear').onclick = function () { $('#panel').hidden = !$('#panel').hidden; };
    $('#panelClose').onclick = function () { $('#panel').hidden = true; };
    $('#sAlpha').oninput = function (e) { P.alpha = Number(e.target.value); save('alpha', P.alpha); applyLook(); };
    $('#sBlur').oninput = function (e) { P.blur = Number(e.target.value); save('blur', P.blur); applyLook(); };
    $('#sScale').oninput = function (e) { P.scale = Number(e.target.value); save('scale', P.scale); applyLook(); render(); };
    $('#sPadL').oninput = function (e) { P.padL = Number(e.target.value); save('padL', P.padL); applyLook(); render(); };
    $('#sPadB').oninput = function (e) { P.padB = Number(e.target.value); save('padB', P.padB); applyLook(); render(); };
    $('#sStart').onclick = function () { P.start = P.start === 'month' ? 'week' : 'month'; save('start', P.start); applyLook(); };
    $('#sPhoto').onchange = function (e) { var f = e.target.files && e.target.files[0]; if (f) savePhoto(f); e.target.value = ''; };
    $('#sBg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-bg]'); if (!b) return;
      P.bg = b.dataset.bg; save('bg', P.bg);
      if (document.body.classList.contains('has-photo')) savePhoto(null); else applyLook();
    });
    $('#sSync').onclick = function () {
      var btn = $('#sSync');
      if (btn.classList.contains('busy')) return;
      if (!SYNC.refresh) { location.reload(); return; }
      btn.classList.add('busy');
      SYNC.refresh().then(function () { btn.classList.remove('busy'); }, function () { location.reload(); });
    };
    var rt;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(render, 150); });
    // 1분마다 현재 시각 선, 자정이 지나면 날짜도 갱신
    var lastDay = todayKey();
    setInterval(function () {
      if (todayKey() !== lastDay) { lastDay = todayKey(); goToday(); }
      render();
    }, 60000);
  }
  function goToday() {
    var now = new Date();
    S.week = startOfWeek(now);
    S.month = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  function showMsg(h, p) {
    $('#wrap').hidden = true; $('#msg').hidden = false;
    $('#msgH').textContent = h; $('#msgP').textContent = p;
  }

  /* ---------- 데이터 받아오기 ---------- */
  function readKey() {
    var m = (location.hash || '').match(/k=([A-Za-z0-9_-]{16,})/) || (location.search || '').match(/k=([A-Za-z0-9_-]{16,})/);
    return m ? m[1] : null;
  }
  function useData(d) {
    S.data = d;
    SYNC.checked = Date.now();
    try { localStorage.setItem('wjw-cache', JSON.stringify(d)); } catch (e) {}
    render();
  }
  function start() {
    bind(); applyLook(); loadPhoto();
    if (/demo/.test(location.hash)) { useData(demoData()); return; }
    var key = readKey();
    if (!key) { showMsg('바탕화면 주소가 필요해요', '사이트에서 ⚙ 설정 → 바탕화면 달력 → "바탕화면 주소 만들기"를 누르고, 나온 주소를 Lively Wallpaper에 넣어 주세요.'); return; }
    // 마지막으로 받은 일정을 먼저 보여주고 (오프라인일 때도), 새 일정이 오면 바꿔요
    try { var c = JSON.parse(localStorage.getItem('wjw-cache') || 'null'); if (c) { S.data = c; render(); } } catch (e) {}
    if (!S.data) showMsg('일정을 불러오는 중…', '인터넷에 연결되면 바로 나타나요.');
    var cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.apiKey) { showMsg('Firebase 설정이 없어요', 'firebase-config.js가 비어 있으면 바탕화면 달력을 쓸 수 없어요.'); return; }
    var base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/';
    Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-firestore.js')]).then(function (m) {
      var app = m[0].initializeApp(cfg, 'widget'), fs = m[1];
      var db = fs.getFirestore(app), ref = fs.doc(db, 'widgets', key);
      SYNC.refresh = function () {
        return fs.getDocFromServer(ref).then(function (snap) { if (snap.exists()) useData(snap.data()); });
      };
      fs.onSnapshot(ref, function (snap) {
        if (!snap.exists()) {
          showMsg('바탕화면 주소가 맞지 않아요', '주소가 바뀌었거나 꺼졌을 수 있어요. 사이트 ⚙ 설정 → 바탕화면 달력에서 주소를 다시 복사해 Lively에 넣어 주세요.');
          return;
        }
        useData(snap.data());
      }, function (err) {
        console.error(err);
        if (!S.data) showMsg('일정을 불러오지 못했어요', '인터넷 연결을 확인해 주세요. Firebase 보안 규칙에 바탕화면 규칙이 들어갔는지도 확인해 주세요. (' + (err.code || err.message) + ')');
      });
    }).catch(function (e) { if (!S.data) showMsg('일정을 불러오지 못했어요', '인터넷 연결을 확인해 주세요. (' + e.message + ')'); });
  }

  /* ---------- 미리보기용 예시 (#demo) ---------- */
  function demoData() {
    var w = startOfWeek(new Date()), k = function (i) { return keyOf(addDays(w, i)); }, past = keyOf(addDays(w, -56));
    var ev = function (i, t, s, e, cat, o) { return Object.assign({ id: t + i, kind: 'event', title: t, start: s, end: e, cat: cat, repeat: 'once', date: k(i), done: {} }, o || {}); };
    var wk = function (dow, t, s, e, cat) { return { id: t, kind: 'event', title: t, start: s, end: e, cat: cat, repeat: 'weekly', days: [dow], from: past, done: {} }; };
    var tk = todayKey(), hc = {};
    for (var j = 0; j < 5; j++) hc[keyOf(addDays(new Date(), -j))] = true;
    return {
      updated: Date.now(), hourStart: 8, hourEnd: 24,
      cats: [{ id: 'a', name: '학업', color: '#8a9be0' }, { id: 'b', name: '업무·프로젝트', color: '#d48b7a' }, { id: 'c', name: '약속·모임', color: '#d6b46a' }, { id: 'd', name: '교회·공동체', color: '#b48ae0' }, { id: 'e', name: '연습·창작', color: '#6fb3b8' }],
      events: [
        wk(1, '전공 수업 A', '13:00', '15:00', 'a'), wk(1, '실습', '17:00', '19:00', 'a'), wk(2, '교양 수업', '11:00', '13:00', 'a'),
        wk(4, '외국어 수업', '12:00', '15:00', 'a'), wk(4, '동아리', '15:00', '17:00', 'd'), wk(4, '악기 레슨', '18:00', '19:00', 'e'), wk(0, '주말 모임', '10:00', '13:00', 'd'),
        ev(2, '멘토링', '09:30', '12:30', 'b', { star: true }), ev(1, '프로젝트 작업', '19:00', '21:00', 'b'), ev(4, '저녁 약속', '19:00', '21:00', 'c', { star: true }),
        ev(2, '기획서 초안', '09:30', null, 'b', { kind: 'deadline' }), ev(6, '보고서 제출', '23:59', null, 'a', { kind: 'deadline' })
      ],
      tasks: [
        { id: 't1', text: '도서관 책 반납', state: 'todo', scope: 'week', period: keyOf(w), created: 1 },
        { id: 't2', text: '발표 자료 정리', state: 'todo', scope: 'week', period: keyOf(w), created: 2 },
        { id: 't3', text: '기획서 초안', state: 'moved', scope: 'week', period: keyOf(w), eventId: '기획서 초안2', created: 3 },
        { id: 't4', text: '저녁 약속', state: 'moved', scope: 'week', period: keyOf(w), eventId: '저녁 약속4', created: 4 },
        { id: 't5', text: '겨울 옷 정리', state: 'todo', scope: 'month', period: (function () { var t = addDays(w, 3); return t.getFullYear() + '-' + pad(t.getMonth() + 1); })(), created: 5 }
      ],
      habits: [
        { id: 'h1', name: '독서', color: '#2f7a55', days: [0, 1, 2, 3, 4, 5, 6], checks: hc },
        { id: 'h2', name: '운동', color: '#7a5cc0', days: [1, 3, 5], checks: {} }
      ]
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
