/* 한 주 저널 — 주간 시간표 + 불렛저널 할 일 모음
 * 저장: firebase-config.js가 비어 있으면 이 기기(브라우저)에만, 채워져 있으면 Google 로그인 + Firestore 동기화.
 */
(function () {
  'use strict';

  var FIREBASE_VERSION = '10.12.2';
  var HOUR = 48; // 시간표 1시간 높이(px) — style.css의 --hour와 같아야 함
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var DEFAULT_CATS = [
    { id: 'cls', name: '수업·약속', color: '#4a72b0' },
    { id: 'study', name: '공부', color: '#2f7a55' },
    { id: 'move', name: '이동·준비', color: '#7a8191' },
    { id: 'tbd', name: '미정·예정', color: '#c08a2e' }
  ];
  function defaultSettings() {
    return { cats: clone(DEFAULT_CATS), hourStart: 8, hourEnd: 24, goals: {}, memos: {}, reviews: {}, wrapped: {} };
  }

  /* ---------------- 작은 도구들 ---------------- */
  function $(s) { return document.querySelector(s); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseKey(k) { var p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function startOfWeek(d) { return addDays(d, -d.getDay()); }
  function dayDiff(a, b) { return Math.round((parseKey(b) - parseKey(a)) / 864e5); }
  function toMin(t) { if (!t) return null; var p = t.split(':').map(Number); return p[0] * 60 + p[1]; }
  function endMin(t) { var m = toMin(t); return m === 0 ? 1440 : m; } // 끝 시각 00:00 = 자정(24:00)
  function fromMin(m) { if (m >= 1440) return '24:00'; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function storeEnd(m) { return m >= 1440 ? '00:00' : fromMin(m); }
  function md(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }
  function mdDow(k) { var d = parseKey(k); return md(d) + ' (' + DOW[d.getDay()] + ')'; }
  function monthKeyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function todayKey() { return keyOf(new Date()); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function fmtDur(min) {
    min = Math.round(min);
    var h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + '분';
    return h + '시간' + (m ? ' ' + m + '분' : '');
  }
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }
  function isDeadline(ev) { return ev.kind === 'deadline'; }

  /* ---------------- 테마 ---------------- */
  function themePref() { try { return localStorage.getItem('wj-theme') || 'system'; } catch (e) { return 'system'; } }
  function applyTheme(p) {
    try { localStorage.setItem('wj-theme', p); } catch (e) {}
    if (p === 'dark' || p === 'light') document.documentElement.dataset.theme = p;
    else delete document.documentElement.dataset.theme;
  }
  var darkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function isDark() {
    var t = document.documentElement.dataset.theme;
    if (t) return t === 'dark';
    return !!(darkMQ && darkMQ.matches);
  }
  function mix(hex, base, amt) {
    var p = function (h) {
      h = (h || '#888888').replace('#', '');
      if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };
    var a = p(hex), b = p(base);
    return 'rgb(' + a.map(function (c, i) { return Math.round(c + (b[i] - c) * amt); }).join(',') + ')';
  }
  // 일정 블록 배경: 밝은 화면에선 연한 색, 어두운 화면에선 어두운 색
  function tint(hex) { return isDark() ? mix(hex, '#171d28', 0.7) : mix(hex, '#ffffff', 0.84); }
  function catVars(c) { return '--bar:' + esc(c.color) + ';--bg-c:' + tint(c.color); }

  var ICON = {
    repeat: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" role="img" aria-label="반복"><path d="M2 8a6 6 0 0 1 10.5-4M14 8a6 6 0 0 1-10.5 4"/><path d="M12.5 1v3h-3M3.5 15v-3h3"/></svg>',
    pin: '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8 15s5-4.6 5-8.5A5 5 0 0 0 3 6.5C3 10.4 8 15 8 15Z"/><circle cx="8" cy="6.5" r="1.8"/></svg>',
    flag: '<svg class="flag" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" role="img" aria-label="마감"><path d="M3.5 15V2M3.5 2.5h8.5l-2 3 2 3H3.5"/></svg>',
    check: '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2.2" aria-hidden="true"><path d="m2.5 6.2 2.3 2.3 4.7-5"/></svg>',
    cal: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/></svg>',
    later: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"/></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>'
  };

  /* ---------------- 상태 ---------------- */
  var savedView = 'week';
  try { savedView = localStorage.getItem('wj-view') === 'month' ? 'month' : 'week'; } catch (e) {}
  var S = {
    view: savedView,
    week: startOfWeek(new Date()),
    month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    tab: 'week',
    events: new Map(),
    tasks: new Map(),
    settings: defaultSettings(),
    mode: 'local',
    user: null,
    ready: false,
    loaded: false, // 저장된 일정을 한 번이라도 다 받아왔는지
    editingTask: null,
    scrolledToday: false
  };
  var pendingLink = null; // 링크(#add=...)로 받은 항목들
  var store = null;
  var drag = null;        // 끌어서 옮기는 중인 일정
  var suppressClick = false;

  function cats() { return (S.settings.cats && S.settings.cats.length) ? S.settings.cats : DEFAULT_CATS; }
  function catOf(id) { var c = cats(); for (var i = 0; i < c.length; i++) if (c[i].id === id) return c[i]; return c[0]; }
  function weekKey() { return keyOf(S.week); }
  function monthOfWeek() { return addDays(S.week, 4); } // 그 주 목요일이 속한 달
  function monthKey() { return monthKeyOf(monthOfWeek()); }
  function hours() {
    var hs = Number(S.settings.hourStart), he = Number(S.settings.hourEnd);
    if (!(he > hs)) { hs = 8; he = 24; }
    return { hs: hs, he: he };
  }

  /* ---------------- 저장소: 이 기기 ---------------- */
  function makeLocalStore() {
    var KEY = 'weekly-journal-v1';
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
    if (!raw) {
      raw = { events: [], tasks: [], settings: defaultSettings() };
      if (window.WJ_DEMO) seedDemo(raw);
    }
    function save() {
      try {
        localStorage.setItem(KEY, JSON.stringify({
          events: Array.from(S.events.values()),
          tasks: Array.from(S.tasks.values()),
          settings: S.settings
        }));
      } catch (e) { /* 저장 불가(사생활 보호 모드 등) — 화면에는 남음 */ }
    }
    return {
      start: function () {
        S.events = new Map(raw.events.map(function (e) { return [e.id, e]; }));
        S.tasks = new Map(raw.tasks.map(function (t) { return [t.id, t]; }));
        S.settings = Object.assign(defaultSettings(), raw.settings || {});
        S.ready = true;
        S.loaded = true;
        render();
      },
      putEvent: function (e) { S.events.set(e.id, e); save(); render(); },
      delEvent: function (id) { S.events.delete(id); save(); render(); },
      putTask: function (t) { S.tasks.set(t.id, t); save(); render(); },
      delTask: function (id) { S.tasks.delete(id); save(); render(); },
      putSettings: function (p) { Object.assign(S.settings, p); save(); render(); }
    };
  }

  /* ---------------- 저장소: Firebase (로그인 + 동기화) ---------------- */
  function makeCloudStore(cfg) {
    var base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/';
    return Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-auth.js'),
      import(base + 'firebase-firestore.js')
    ]).then(function (mods) {
      var appM = mods[0], authM = mods[1], fs = mods[2];
      var app = appM.initializeApp(cfg);
      var auth = authM.getAuth(app);
      var db;
      try {
        db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
      } catch (e) { db = fs.getFirestore(app); }
      var uid = null, unsubs = [];
      function col(name) { return fs.collection(db, 'users', uid, name); }
      function settingsRef() { return fs.doc(db, 'users', uid, 'meta', 'settings'); }
      function plain(o) { return JSON.parse(JSON.stringify(o)); }
      function fail(err) { console.error(err); toast('저장 중 문제가 생겼어요: ' + (err && err.code ? err.code : err)); }

      var api = {
        login: function () {
          var provider = new authM.GoogleAuthProvider();
          provider.setCustomParameters({ prompt: 'select_account' });
          return authM.signInWithPopup(auth, provider);
        },
        logout: function () { return authM.signOut(auth); },
        putEvent: function (e) { S.events.set(e.id, e); render(); fs.setDoc(fs.doc(col('events'), e.id), plain(e)).catch(fail); },
        delEvent: function (id) { S.events.delete(id); render(); fs.deleteDoc(fs.doc(col('events'), id)).catch(fail); },
        putTask: function (t) { S.tasks.set(t.id, t); render(); fs.setDoc(fs.doc(col('tasks'), t.id), plain(t)).catch(fail); },
        delTask: function (id) { S.tasks.delete(id); render(); fs.deleteDoc(fs.doc(col('tasks'), id)).catch(fail); },
        putSettings: function (p) {
          Object.assign(S.settings, p); render();
          fs.setDoc(settingsRef(), plain(p), { merge: true }).catch(fail);
        }
      };

      authM.onAuthStateChanged(auth, function (user) {
        unsubs.forEach(function (f) { f(); });
        unsubs = [];
        S.user = user;
        if (!user) { S.ready = false; showScreen('login'); return; }
        uid = user.uid;
        S.events = new Map(); S.tasks = new Map(); S.settings = defaultSettings();
        S.ready = true;
        S.loaded = false;
        var gotEvents = false, gotTasks = false;
        showScreen('app');
        render();
        unsubs.push(fs.onSnapshot(col('events'), function (snap) {
          S.events = new Map(snap.docs.map(function (d) { return [d.id, d.data()]; }));
          gotEvents = true; S.loaded = gotEvents && gotTasks;
          render();
        }, fail));
        unsubs.push(fs.onSnapshot(col('tasks'), function (snap) {
          S.tasks = new Map(snap.docs.map(function (d) { return [d.id, d.data()]; }));
          gotTasks = true; S.loaded = gotEvents && gotTasks;
          render();
        }, fail));
        unsubs.push(fs.onSnapshot(settingsRef(), function (d) {
          if (!d.exists()) { fs.setDoc(settingsRef(), defaultSettings()).catch(fail); return; }
          S.settings = Object.assign(defaultSettings(), d.data());
          render();
        }, fail));
      });
      return api;
    });
  }

  /* ---------------- 일정 계산 ---------------- */
  // 날짜 목록 각각에 보이는 일정(반복 포함)
  function occurrencesFor(keys) {
    var out = keys.map(function () { return []; });
    var dows = keys.map(function (k) { return parseKey(k).getDay(); });
    S.events.forEach(function (ev) {
      keys.forEach(function (k, i) {
        if (occursOn(ev, k, dows[i])) out[i].push({ ev: ev, date: k, done: !!(ev.done && ev.done[k]) });
      });
    });
    out.forEach(function (list) {
      list.sort(function (a, b) {
        var sa = a.ev.untimed || !a.ev.start ? -1 : toMin(a.ev.start), sb = b.ev.untimed || !b.ev.start ? -1 : toMin(b.ev.start);
        return sa - sb;
      });
    });
    return out;
  }
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
  function weekKeys() { return [0, 1, 2, 3, 4, 5, 6].map(function (i) { return keyOf(addDays(S.week, i)); }); }

  // 겹치는 일정은 나란히 배치
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
        var placed = false;
        for (var i = 0; i < lanes.length; i++) {
          if (lanes[i] <= it.s) { lanes[i] = it.e; it.lane = i; placed = true; break; }
        }
        if (!placed) { it.lane = lanes.length; lanes.push(it.e); }
      });
      cl.forEach(function (it) { it.lanes = lanes.length; });
    });
    return items;
  }

  // 카테고리별 시간 합계 (시간이 정해진 일정만, 마감 제외)
  function categoryStats(keys) {
    var occ = occurrencesFor(keys), by = {}, total = 0, doneTotal = 0;
    occ.forEach(function (list) {
      list.forEach(function (o) {
        var ev = o.ev;
        if (isDeadline(ev) || ev.untimed || !ev.start) return;
        var s = toMin(ev.start), e = ev.end ? endMin(ev.end) : s + 60;
        var m = Math.max(0, e - s);
        var c = catOf(ev.cat);
        if (!by[c.id]) by[c.id] = { cat: c, min: 0, done: 0 };
        by[c.id].min += m; total += m;
        if (o.done) { by[c.id].done += m; doneTotal += m; }
      });
    });
    var rows = cats().map(function (c) { return by[c.id]; }).filter(Boolean);
    return { rows: rows, total: total, done: doneTotal };
  }
  function statsHtml(st) {
    if (!st.total) return '<p class="empty">시간이 정해진 일정이 없어요.</p>';
    var bar = st.rows.map(function (r) {
      return '<span style="width:' + (r.min / st.total * 100).toFixed(2) + '%;background:' + esc(r.cat.color) + '" title="' + esc(r.cat.name + ' ' + fmtDur(r.min)) + '"></span>';
    }).join('');
    var rows = st.rows.map(function (r) {
      return '<li class="st-row"><i class="dot" style="background:' + esc(r.cat.color) + '"></i><span class="nm">' + esc(r.cat.name) + '</span>' +
        '<span class="hr">' + fmtDur(r.min) + (r.done ? ' <small>· 완료 ' + fmtDur(r.done) + '</small>' : '') + '</span>' +
        '<span class="st-done" aria-hidden="true"><i style="width:' + (r.done / r.min * 100).toFixed(1) + '%;background:' + esc(r.cat.color) + '"></i></span></li>';
    }).join('');
    return '<div class="st-bar" role="img" aria-label="카테고리별 시간 비율">' + bar + '</div><ul class="st-rows">' + rows + '</ul>' +
      '<p class="st-total">합계 ' + fmtDur(st.total) + ' · 완료 ' + fmtDur(st.done) + '</p>';
  }

  /* ---------------- 화면 그리기 ---------------- */
  function render() {
    if (!S.ready) return;
    renderHeader();
    if (S.view === 'month') renderMonth(); else renderGrid();
    renderSide();
    if (pendingLink && S.loaded) showLinkDialog();
  }

  function renderHeader() {
    var month = S.view === 'month';
    var tw = keyOf(startOfWeek(new Date())) === weekKey();
    var now = new Date();
    if (month) {
      $('#pageTitle').textContent = '한눈에 보는 한 달';
      $('#rangeLabel').textContent = S.month.getFullYear() + '년 ' + (S.month.getMonth() + 1) + '월';
      var tm = S.month.getFullYear() === now.getFullYear() && S.month.getMonth() === now.getMonth();
      $('#todayBtn').textContent = tm ? '이번 달' : '이번 달로';
      $('#prevBtn').setAttribute('aria-label', '지난 달');
      $('#nextBtn').setAttribute('aria-label', '다음 달');
    } else {
      var end = addDays(S.week, 6);
      var jan1 = new Date(S.week.getFullYear(), 0, 1);
      var wn = Math.round((S.week - startOfWeek(jan1)) / (7 * 864e5)) + 1;
      $('#pageTitle').textContent = tw ? '시간으로 보는 이번 주' : '시간으로 보는 한 주';
      $('#rangeLabel').textContent = S.week.getFullYear() + '.' + pad(S.week.getMonth() + 1) + '.' + pad(S.week.getDate()) +
        ' — ' + pad(end.getMonth() + 1) + '.' + pad(end.getDate()) + ' · ' + wn + '주차';
      $('#todayBtn').textContent = tw ? '이번 주' : '이번 주로';
      $('#prevBtn').setAttribute('aria-label', '지난 주');
      $('#nextBtn').setAttribute('aria-label', '다음 주');
      var goal = $('#goalInput');
      if (document.activeElement !== goal) goal.value = (S.settings.goals || {})[weekKey()] || '';
    }
    $('#goalRow').hidden = month;
    $('#viewWeek').setAttribute('aria-checked', !month);
    $('#viewMonth').setAttribute('aria-checked', month);
    $('#legend').innerHTML = cats().map(function (c) {
      return '<span><i class="sw" style="background:' + tint(c.color) + ';border-color:' + esc(c.color) + '"></i>' + esc(c.name) + '</span>';
    }).join('');
    $('#modeBadge').hidden = S.mode !== 'local';
    var wrapped = (S.settings.wrapped || {})[weekKey()];
    var wb = $('#wrapBtn');
    wb.hidden = month;
    wb.textContent = wrapped ? '✓ 마무리함' : '한 주 마무리';
    wb.classList.toggle('is-done', !!wrapped);
    $('#progress').hidden = month;
    var board = $('.board');
    board.classList.toggle('week', !month);
    $('#grid').hidden = month;
    $('#month').hidden = !month;
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    $('#boardHint').textContent = month
      ? '날짜를 누르면 그 주 시간표로 이동해요.'
      : (coarse ? '빈 칸을 누르면 그 시간에 일정이 추가돼요.'
        : '빈 칸을 누르면 일정이 추가돼요. 일정을 끌어서 옮기고, 아래 끝을 끌어서 길이를 바꿀 수 있어요. 오른쪽 할 일도 시간표로 끌어다 놓을 수 있어요.');
  }

  function evTimeText(ev) {
    if (isDeadline(ev)) return (ev.start || '23:59') + ' 마감';
    if (ev.untimed || !ev.start) return '시간 미정';
    return ev.start + (ev.openEnd ? '~' : (ev.end ? '–' + fromMin(endMin(ev.end)) : ''));
  }

  function renderGrid() {
    var h = hours(), hs = h.hs, he = h.he;
    var rows = he - hs, H = HOUR;
    var keys = weekKeys();
    var occ = occurrencesFor(keys);
    var now = new Date(), tk = keyOf(now);
    var doneTotal = 0, allTotal = 0;

    var html = '<div class="tt-corner"></div>';
    keys.forEach(function (k, i) {
      var d = parseKey(k);
      var list = occ[i], dn = list.filter(function (o) { return o.done; }).length;
      doneTotal += dn; allTotal += list.length;
      html += '<div class="tt-head' + (k === tk ? ' is-today' : '') + '">' +
        '<div class="d1"><span class="dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + DOW[i] + '</span>' +
        '<span class="date">' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '</span></div>' +
        '<span class="sum">' + (list.length ? list.length + '개 · ' + dn + ' 완료' : '일정 없음') + '</span></div>';
    });

    // 시간 미정 줄
    html += '<div class="tt-un-label">미정</div>';
    var timed = keys.map(function () { return []; });
    var dls = keys.map(function () { return []; });
    keys.forEach(function (k, i) {
      var chips = '';
      occ[i].forEach(function (o) {
        var ev = o.ev, c = catOf(ev.cat);
        var s = toMin(ev.start);
        if (isDeadline(ev)) {
          if (s == null) s = 1439;
          if (s >= hs * 60 && s <= he * 60) { dls[i].push({ o: o, s: s }); return; }
          chips += chipHtml(o, k, c, (ev.start || '23:59') + ' ' + ev.title, true);
          return;
        }
        var e = ev.end ? endMin(ev.end) : (s != null ? s + 60 : null);
        var outside = s != null && (e <= hs * 60 || s >= he * 60);
        if (ev.untimed || s == null || outside) {
          chips += chipHtml(o, k, c, (outside ? ev.start + ' ' : '') + ev.title, false);
        } else {
          timed[i].push({ o: o, s: Math.max(s, hs * 60), e: Math.min(Math.max(e, s + 15), he * 60), rs: s, re: e });
        }
      });
      html += '<div class="tt-un" data-date="' + k + '">' + chips + '</div>';
    });

    // 시간 눈금
    html += '<div class="tt-times" style="--rows:' + rows + '">';
    for (var hh = hs; hh < he; hh++) html += '<span style="top:' + ((hh - hs) * H) + 'px">' + pad(hh) + ':00</span>';
    html += '</div>';

    // 요일 칸
    keys.forEach(function (k, i) {
      var cls = 'tt-col' + (i === 0 || i === 6 ? ' weekend' : '') + (k === tk ? ' is-today' : '');
      html += '<div class="' + cls + '" data-date="' + k + '" style="--rows:' + rows + '">';
      layoutDay(timed[i]).forEach(function (it) {
        var ev = it.o.ev, c = catOf(ev.cat);
        var top = (it.s - hs * 60) / 60 * H, height = (it.e - it.s) / 60 * H;
        var short = height < 44;
        var w = 100 / it.lanes;
        var time = evTimeText(ev);
        var canResize = !ev.openEnd && it.re <= he * 60;
        html += '<div class="ev' + (it.o.done ? ' is-done' : '') + (short ? ' is-short' : '') + (ev.openEnd ? ' open-end' : '') + '"' +
          ' data-ev="' + esc(ev.id) + '" data-date="' + k + '" tabindex="0" role="button"' +
          ' aria-label="' + esc(ev.title + ', ' + time + (ev.place ? ', ' + ev.place : '')) + '"' +
          ' title="' + esc(ev.title + '\n' + time + (ev.openEnd ? ' (끝 미정)' : '') + (ev.place ? '\n' + ev.place : '') + (ev.memo ? '\n' + ev.memo : '')) + '"' +
          ' style="top:' + (top + 1) + 'px;height:' + Math.max(height - 2, 20) + 'px;left:calc(' + (it.lane * w) + '% + 3px);width:calc(' + w + '% - 6px);' + catVars(c) + '">' +
          '<div class="ev-body"><div class="ev-title">' + (short ? '<span class="ev-time-inline">' + esc(ev.start) + '</span>' : '') +
          '<span class="t">' + esc(ev.title) + '</span>' + (ev.repeat === 'weekly' ? ICON.repeat : '') + '</div>' +
          (!short ? '<div class="ev-meta"><span class="t ev-time">' + esc(time) + (ev.openEnd ? ' · 끝 미정' : '') + '</span></div>' : '') +
          (ev.place && height >= 76 ? '<div class="ev-meta">' + ICON.pin + '<span class="t">' + esc(ev.place) + '</span></div>' : '') +
          (ev.memo && height >= 110 ? '<div class="ev-meta"><span class="t">' + esc(ev.memo) + '</span></div>' : '') +
          '</div><button type="button" class="ev-check" data-check aria-label="' + esc(ev.title) + (it.o.done ? ' 완료 취소' : ' 완료 표시') + '">' + (it.o.done ? ICON.check : '') + '</button>' +
          (canResize ? '<span class="rs" aria-hidden="true"></span>' : '') + '</div>';
      });
      dls[i].forEach(function (d) {
        var ev = d.o.ev, c = catOf(ev.cat);
        var y = (d.s - hs * 60) / 60 * H;
        html += '<div class="dl-line" style="top:' + y + 'px;--bar:' + esc(c.color) + '"></div>' +
          '<div class="ev dl' + (d.o.done ? ' is-done' : '') + '" data-ev="' + esc(ev.id) + '" data-date="' + k + '" tabindex="0" role="button"' +
          ' aria-label="' + esc('마감: ' + ev.title + ', ' + (ev.start || '23:59')) + '" title="' + esc(ev.title + '\n' + (ev.start || '23:59') + ' 마감' + (ev.memo ? '\n' + ev.memo : '')) + '"' +
          ' style="top:' + dlTop(y) + 'px;left:3px;width:calc(100% - 6px);' + catVars(c) + '">' +
          '<div class="ev-body"><div class="ev-title">' + ICON.flag + '<span class="ev-time-inline">' + esc(ev.start || '23:59') + '</span><span class="t">' + esc(ev.title) + '</span>' +
          (ev.repeat === 'weekly' ? ICON.repeat : '') + '</div></div>' +
          '<button type="button" class="ev-check" data-check aria-label="' + esc(ev.title) + (d.o.done ? ' 완료 취소' : ' 완료 표시') + '">' + (d.o.done ? ICON.check : '') + '</button></div>';
      });
      if (k === tk) {
        var nm = now.getHours() * 60 + now.getMinutes();
        if (nm >= hs * 60 && nm <= he * 60) html += '<div class="now-line" style="top:' + ((nm - hs * 60) / 60 * H) + 'px"></div>';
      }
      html += '</div>';
    });

    $('#grid').innerHTML = html;
    $('#progress').innerHTML = allTotal ? '이번 주 완료 <b>' + doneTotal + ' / ' + allTotal + '</b>' : '';
    // 폰처럼 화면이 좁으면 처음 열 때 오늘 칸이 보이도록 옆으로 스크롤
    if (!S.scrolledToday) {
      var board = $('.board'), todayCol = $('.tt-col.is-today');
      if (board && todayCol && board.scrollWidth > board.clientWidth) {
        board.scrollLeft = Math.max(0, todayCol.offsetLeft - 56 - 8);
        S.scrolledToday = true;
      }
    }
  }
  function dlTop(y) { return y >= 24 ? y - 24 : y; }
  function chipHtml(o, k, c, label, dl) {
    var ev = o.ev;
    return '<div class="chip-un' + (o.done ? ' is-done' : '') + (dl ? ' is-dl' : '') + '" data-ev="' + esc(ev.id) + '" data-date="' + k + '" style="' + catVars(c) + '" title="' + esc(ev.title + (ev.place ? ' · ' + ev.place : '')) + '">' +
      (dl ? ICON.flag : '') + '<span class="t">' + esc(label) + '</span>' + (ev.repeat === 'weekly' ? ICON.repeat : '') +
      '<button type="button" class="ev-check" data-check aria-label="' + esc(ev.title) + (o.done ? ' 완료 취소' : ' 완료 표시') + '">' + (o.done ? ICON.check : '') + '</button></div>';
  }

  function renderMonth() {
    var first = S.month;
    var start = startOfWeek(first);
    var last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    var end = addDays(startOfWeek(last), 6);
    var keys = [];
    for (var d = start; d <= end; d = addDays(d, 1)) keys.push(keyOf(d));
    var occ = occurrencesFor(keys), tk = todayKey(), m = first.getMonth();
    var html = '<div class="mo-head">' + DOW.map(function (n, i) { return '<div class="' + (i === 0 ? 'sun' : i === 6 ? 'sat' : '') + '">' + n + '</div>'; }).join('') + '</div>';
    for (var w = 0; w < keys.length; w += 7) {
      html += '<div class="mo-week">';
      for (var i = w; i < w + 7; i++) {
        var k = keys[i], dt = parseKey(k), list = occ[i];
        var cls = 'mo-day' + (dt.getMonth() !== m ? ' other' : '') + (k === tk ? ' is-today' : '') + (dt.getDay() === 0 ? ' sun' : dt.getDay() === 6 ? ' sat' : '');
        var items = list.slice().sort(function (a, b) { return (isDeadline(b.ev) ? 1 : 0) - (isDeadline(a.ev) ? 1 : 0); });
        var shown = items.slice(0, 4);
        var label = mdDow(k) + (list.length ? ', 일정 ' + list.length + '개' : '');
        html += '<button type="button" class="' + cls + '" data-date="' + k + '" aria-label="' + esc(label) + ' — 이 주 보기">' +
          '<span class="mo-num">' + dt.getDate() + '</span><span class="m-items">' +
          shown.map(function (o) {
            var ev = o.ev, c = catOf(ev.cat), dl = isDeadline(ev);
            return '<span class="m-item' + (dl ? ' is-dl' : '') + (o.done ? ' is-done' : '') + '" style="' + catVars(c) + '" title="' + esc(evTimeText(ev) + ' ' + ev.title) + '">' +
              (dl ? ICON.flag : '') + (!dl && ev.start && !ev.untimed ? '<span class="tm">' + esc(ev.start) + '</span>' : '') + '<span class="t">' + esc(ev.title) + '</span></span>';
          }).join('') +
          (items.length > shown.length ? '<span class="m-more">+' + (items.length - shown.length) + '개</span>' : '') +
          '</span></button>';
      }
      html += '</div>';
    }
    $('#month').innerHTML = html;
  }

  function renderSide() {
    renderDeadlines();
    var mk = monthKey();
    var tabWeek = $('#tabWeek'), tabMonth = $('#tabMonth');
    tabMonth.textContent = (monthOfWeek().getMonth() + 1) + '월 전체';
    tabWeek.setAttribute('aria-selected', S.tab === 'week');
    tabMonth.setAttribute('aria-selected', S.tab === 'month');

    var memo = $('#memoInput');
    memo.closest('.side-sec').hidden = S.view === 'month';
    if (document.activeElement !== memo) memo.value = (S.settings.memos || {})[weekKey()] || '';

    // 시간 통계
    var keys;
    if (S.view === 'month') {
      keys = [];
      for (var d = new Date(S.month); d.getMonth() === S.month.getMonth(); d = addDays(d, 1)) keys.push(keyOf(d));
      $('#statsHead').textContent = (S.month.getMonth() + 1) + '월 시간';
    } else {
      keys = weekKeys();
      $('#statsHead').textContent = keyOf(startOfWeek(new Date())) === weekKey() ? '이번 주 시간' : '이 주의 시간';
    }
    $('#stats').innerHTML = statsHtml(categoryStats(keys));

    if (S.editingTask) return; // 수정 중에는 목록을 다시 그리지 않음
    var period = S.tab === 'week' ? weekKey() : mk;
    var list = Array.from(S.tasks.values())
      .filter(function (t) { return t.scope === S.tab && t.period === period; })
      .sort(function (a, b) { return (a.created || 0) - (b.created || 0); });
    var SIG = { todo: '•', done: '×', moved: '&gt;', later: '&lt;' };
    var html = list.map(function (t) {
      var st = t.state || 'todo';
      var sub = t.note ? '<span class="task-sub">' + esc(t.note) + '</span>' : '';
      var acts = '';
      if (st === 'todo') {
        var nl = S.tab === 'week' ? '다음 주로' : '다음 달로';
        acts += '<button type="button" data-act="schedule" aria-label="일정으로 만들기" title="일정으로 만들기">' + ICON.cal + '</button>' +
          '<button type="button" data-act="later" aria-label="' + nl + ' 미루기" title="' + nl + ' 미루기">' + ICON.later + '</button>';
      }
      acts += '<button type="button" data-act="del" aria-label="삭제" title="삭제">' + ICON.x + '</button>';
      return '<li class="task s-' + st + '" data-id="' + esc(t.id) + '"' + (st === 'todo' ? ' draggable="true"' : '') + '>' +
        '<button type="button" class="sig" data-act="cycle" aria-label="' + (st === 'done' ? '완료 취소' : '완료 표시') + '">' + SIG[st] + '</button>' +
        '<div class="task-main"><span class="task-text" data-act="edit">' + esc(t.text) + '</span>' + sub + '</div>' +
        '<div class="task-acts">' + acts + '</div></li>';
    }).join('');
    $('#taskList').innerHTML = html || '<li class="empty">아직 적어둔 할 일이 없어요.</li>';
  }

  // 다가오는 마감 (지난 7일 중 못 끝낸 것 ~ 앞으로 30일)
  function upcomingDeadlines() {
    var dlEvents = Array.from(S.events.values()).filter(isDeadline);
    if (!dlEvents.length) return [];
    var tk = todayKey(), base = parseKey(tk), out = [], seenNext = {};
    for (var i = -7; i <= 30; i++) {
      var k = keyOf(addDays(base, i)), dow = parseKey(k).getDay();
      dlEvents.forEach(function (ev) {
        if (!occursOn(ev, k, dow)) return;
        var done = !!(ev.done && ev.done[k]);
        if (done) return;
        // 반복 마감은 지난 것(못 끝낸 것) + 가장 가까운 다음 한 번만
        if (i >= 0) { if (seenNext[ev.id]) return; seenNext[ev.id] = true; }
        out.push({ ev: ev, date: k, diff: i });
      });
    }
    out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : toMin(a.ev.start || '23:59') - toMin(b.ev.start || '23:59'); });
    return out;
  }
  function renderDeadlines() {
    var list = upcomingDeadlines();
    $('#dlBox').hidden = !list.length;
    if (!list.length) return;
    var shown = list.slice(0, 6);
    $('#dlList').innerHTML = shown.map(function (d) {
      var c = catOf(d.ev.cat);
      var dd = d.diff === 0 ? 'D-day' : d.diff > 0 ? 'D-' + d.diff : (-d.diff) + '일 지남';
      var ink = isDark() ? mix(c.color, '#ffffff', 0.45) : c.color;
      return '<li class="dl-item' + (d.diff < 0 ? ' is-late' : d.diff === 0 ? ' is-today' : '') + '" style="' + catVars(c) + ';--bar-ink:' + ink + '" data-ev="' + esc(d.ev.id) + '" data-date="' + d.date + '">' +
        '<span class="dday">' + dd + '</span>' +
        '<button type="button" class="dl-main" data-go><span class="t">' + esc(d.ev.title) + '</span><span class="w">' + mdDow(d.date) + ' ' + esc(d.ev.start || '23:59') + '</span></button>' +
        '<button type="button" class="ev-check" data-check aria-label="' + esc(d.ev.title) + ' 완료 표시"></button></li>';
    }).join('') + (list.length > shown.length ? '<li class="empty">+' + (list.length - shown.length) + '개 더</li>' : '');
  }

  /* ---------------- 일정 추가/수정 창 ---------------- */
  var E = null; // 편집 중인 상태
  function openEditor(opts) {
    opts = opts || {};
    var ev = opts.id ? S.events.get(opts.id) : null;
    var date = opts.date || defaultDate();
    E = {
      id: ev ? ev.id : null,
      occDate: date,
      taskId: opts.taskId || null,
      kind: ev ? (ev.kind || 'event') : (opts.kind || 'event'),
      mode: ev ? (ev.repeat || 'once') : 'once',
      days: ev && ev.days ? ev.days.slice() : [parseKey(date).getDay()],
      cat: ev ? ev.cat : (opts.cat || cats()[0].id)
    };
    if (ev && !catOf(E.cat)) E.cat = cats()[0].id;
    var start = ev ? (ev.start || '') : (opts.start || '');
    var end = ev ? (ev.end || '') : (opts.end || (opts.start ? fromMin(Math.min(toMin(opts.start) + 60, 1439)) : ''));
    $('#fTitle').value = ev ? ev.title : (opts.title || '');
    $('#fDate').value = ev && ev.date ? ev.date : date;
    $('#fFrom').value = ev && ev.from ? ev.from : date;
    $('#fUntil').value = ev && ev.until ? ev.until : '';
    $('#fStart').value = start;
    $('#fEnd').value = end === '24:00' ? '00:00' : end;
    $('#fUntimed').checked = ev ? !!ev.untimed : !!opts.untimed;
    $('#fOpenEnd').checked = ev ? !!ev.openEnd : false;
    $('#fPlace').value = ev ? (ev.place || '') : '';
    $('#fMemo').value = ev ? (ev.memo || '') : '';
    $('#evDelete').hidden = !ev;
    $('#evError').hidden = true;
    if (E.kind === 'deadline' && !$('#fStart').value) $('#fStart').value = '23:59';
    renderEditor();
    $('#evDialog').showModal();
    if (!ev) $('#fTitle').focus();
  }
  function defaultDate() {
    var today = todayKey();
    return today >= weekKey() && today <= keyOf(addDays(S.week, 6)) ? today : weekKey();
  }
  function renderEditor() {
    var weekly = E.mode === 'weekly', dl = E.kind === 'deadline';
    var editing = !!E.id;
    $('#evHeading').textContent = (dl ? '마감' : '일정') + (editing ? ' 수정' : ' 추가');
    $('#kindEvent').setAttribute('aria-checked', !dl);
    $('#kindDeadline').setAttribute('aria-checked', dl);
    $('#fTitleLabel').textContent = dl ? '마감 이름' : '일정';
    $('#fTitle').placeholder = dl ? '예: 자동제어 과제 제출' : '예: 드럼 레슨';
    $('#fStartLabel').textContent = dl ? '마감 시각' : '시작';
    $('#endField').hidden = dl;
    $('#timeRow').classList.toggle('one', dl);
    $('#checksRow').hidden = dl;
    $('#placeField').hidden = dl;
    $('#modeOnce').setAttribute('aria-checked', !weekly);
    $('#modeWeekly').setAttribute('aria-checked', weekly);
    $('#onceBox').hidden = weekly;
    $('#weeklyBox').hidden = !weekly;
    $('#rangeBox').hidden = !weekly;
    $('#dayChips').innerHTML = DOW.map(function (d, i) {
      return '<button type="button" data-day="' + i + '" class="' + (i === 0 ? 'sun' : i === 6 ? 'sat' : '') + '" aria-pressed="' + (E.days.indexOf(i) >= 0) + '">' + d + '</button>';
    }).join('');
    var untimed = !dl && $('#fUntimed').checked, openEnd = $('#fOpenEnd').checked;
    $('#fStart').disabled = untimed;
    $('#fEnd').disabled = untimed || openEnd;
    $('#fOpenEnd').disabled = untimed;
    $('#catChips').innerHTML = cats().map(function (c) {
      return '<button type="button" data-cat="' + esc(c.id) + '" aria-pressed="' + (c.id === E.cat) + '" style="' + catVars(c) + '">' + esc(c.name) + '</button>';
    }).join('') + '<button type="button" class="add-cat" data-cat-edit aria-label="카테고리 편집">+ 편집</button>';
    $('#evSummary').textContent = summaryText();
  }
  function summaryText() {
    var dl = E.kind === 'deadline';
    var untimed = !dl && $('#fUntimed').checked, openEnd = $('#fOpenEnd').checked;
    var s = $('#fStart').value, e = $('#fEnd').value;
    var time = dl ? (s || '23:59') + ' 마감'
      : untimed ? '시간 미정' : (s ? s + (openEnd ? '~ (끝 미정)' : (e ? '–' + (e === '00:00' ? '24:00' : e) : '')) : '시간을 정해 주세요');
    if (E.mode === 'weekly') {
      var days = E.days.slice().sort().map(function (i) { return DOW[i]; });
      if (!days.length) return '반복할 요일을 골라 주세요';
      var from = $('#fFrom').value, until = $('#fUntil').value;
      var range = (from ? mdDow(from) + '부터' : '') + (until ? ' ' + mdDow(until) + '까지' : ' 계속');
      return '매주 ' + days.join('·') + ' ' + time + ' · ' + range + (E.id ? ' (반복 전체에 적용)' : '');
    }
    var d = $('#fDate').value;
    var dday = '';
    if (dl && d) { var n = dayDiff(todayKey(), d); dday = ' · ' + (n === 0 ? 'D-day' : n > 0 ? 'D-' + n : (-n) + '일 지남'); }
    return (d ? mdDow(d) + ' ' : '') + time + (dl ? dday : ' · 한 번');
  }
  function saveEditor() {
    var err = function (m) { var el = $('#evError'); el.textContent = m; el.hidden = false; };
    var dl = E.kind === 'deadline';
    var title = $('#fTitle').value.trim();
    if (!title) return err(dl ? '마감 이름을 적어 주세요.' : '일정 이름을 적어 주세요.');
    var untimed = !dl && $('#fUntimed').checked, openEnd = !dl && !untimed && $('#fOpenEnd').checked;
    var start = $('#fStart').value, end = $('#fEnd').value;
    if (dl) { if (!start) start = '23:59'; end = null; }
    else if (!untimed) {
      if (!start) return err('시작 시간을 정하거나 "시간 미정"을 체크해 주세요.');
      if (!openEnd && end && endMin(end) <= toMin(start)) return err('끝 시간이 시작 시간보다 늦어야 해요.');
      if (!openEnd && !end) end = storeEnd(Math.min(toMin(start) + 60, 1440));
    }
    var old = E.id ? S.events.get(E.id) : null;
    var ev = {
      id: E.id || newId(),
      kind: dl ? 'deadline' : 'event',
      title: title,
      place: dl ? '' : $('#fPlace').value.trim(),
      memo: $('#fMemo').value.trim(),
      cat: E.cat,
      repeat: E.mode,
      untimed: untimed,
      openEnd: openEnd,
      start: untimed ? null : start,
      end: untimed || openEnd || dl ? null : end,
      done: old && old.done ? old.done : {},
      skip: old && old.skip ? old.skip : {},
      created: old && old.created ? old.created : Date.now(),
      updated: Date.now()
    };
    var firstDate;
    if (E.mode === 'weekly') {
      if (!E.days.length) return err('반복할 요일을 하나 이상 골라 주세요.');
      var from = $('#fFrom').value, until = $('#fUntil').value;
      if (!from) return err('반복 시작일을 정해 주세요.');
      if (until && until < from) return err('반복 종료일이 시작일보다 늦어야 해요.');
      ev.days = E.days.slice().sort();
      ev.from = from;
      ev.until = until || null;
      firstDate = from;
    } else {
      var date = $('#fDate').value;
      if (!date) return err('날짜를 정해 주세요.');
      ev.date = date;
      firstDate = date;
    }
    store.putEvent(ev);
    if (E.taskId) {
      var t = S.tasks.get(E.taskId);
      if (t) {
        store.putTask(Object.assign({}, t, {
          state: 'moved',
          note: (E.mode === 'weekly' ? '매주 일정으로 옮김' : mdDow(firstDate) + (ev.start ? ' ' + ev.start : '') + (dl ? ' 마감으로 옮김' : ' 일정으로 옮김'))
        }));
      }
    }
    $('#evDialog').close();
    toast(old ? (dl ? '마감을 고쳤어요' : '일정을 고쳤어요') : (dl ? '마감을 추가했어요' : '일정을 추가했어요'));
    // 다른 주에 추가했으면 그 주로 이동
    if (E.mode === 'once' && S.view === 'week') {
      var wk = startOfWeek(parseKey(ev.date));
      if (keyOf(wk) !== weekKey()) { S.week = wk; render(); }
    }
  }

  /* ---------------- 선택 창 (삭제 / 반복 일정 옮기기) ---------------- */
  var choiceCb = null;
  function choose(o, cb) {
    $('#choiceHeading').textContent = o.title;
    $('#choiceText').textContent = o.text;
    $('#choiceA').hidden = !o.a;
    $('#choiceA').textContent = o.a || '';
    $('#choiceB').textContent = o.b;
    $('#choiceB').className = 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary');
    choiceCb = cb;
    $('#choiceDialog').showModal();
  }
  function finishChoice(r) {
    var cb = choiceCb; choiceCb = null;
    if ($('#choiceDialog').open) $('#choiceDialog').close();
    if (cb) cb(r);
  }

  function askDelete() {
    var ev = S.events.get(E.id);
    if (!ev) return;
    var weekly = ev.repeat === 'weekly';
    var what = isDeadline(ev) ? '마감' : '일정';
    var prev = clone(ev);
    choose({
      title: what + ' 삭제',
      text: weekly
        ? '"' + ev.title + '"은(는) 반복 ' + what + '이에요. ' + mdDow(E.occDate) + ' 하루만 지울까요, 반복 전체를 지울까요?'
        : '"' + ev.title + '"을(를) 지울까요?',
      a: weekly ? mdDow(E.occDate) + ' 하루만 삭제' : null,
      b: weekly ? '반복 전체 삭제' : '삭제',
      danger: true
    }, function (r) {
      if (!r) return;
      if (r === 'a') {
        var skip = Object.assign({}, ev.skip || {}); skip[E.occDate] = true;
        store.putEvent(Object.assign({}, ev, { skip: skip }));
        $('#evDialog').close(); undoToast(mdDow(E.occDate) + ' ' + what + '만 지웠어요', [prev], []);
      } else {
        store.delEvent(ev.id);
        $('#evDialog').close(); undoToast(what + '을 지웠어요', [prev], []);
      }
    });
  }

  function toggleDone(id, date) {
    var ev = S.events.get(id);
    if (!ev) return;
    var done = Object.assign({}, ev.done || {});
    if (done[date]) delete done[date]; else done[date] = true;
    store.putEvent(Object.assign({}, ev, { done: done }));
  }

  /* ---------------- 끌어서 옮기기 / 길이 바꾸기 ---------------- */
  function onDragStart(e) {
    if (e.button !== 0 || e.pointerType === 'touch' || S.view !== 'week') return;
    var el = e.target.closest('.ev');
    if (!el || e.target.closest('[data-check]')) return;
    var ev = S.events.get(el.dataset.ev);
    if (!ev || !ev.start) return;
    var resize = !!e.target.closest('.rs');
    var s = toMin(ev.start);
    drag = {
      id: ev.id, date: el.dataset.date, el: el, x0: e.clientX, y0: e.clientY,
      mode: resize ? 'resize' : 'move', started: false, dl: isDeadline(ev),
      s: s, e: isDeadline(ev) ? s : (ev.end ? endMin(ev.end) : s + 60),
      ns: s, ne: null, nd: el.dataset.date, ghost: null
    };
    drag.ne = drag.e;
  }
  function onDragMove(e) {
    if (!drag) return;
    var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.started) {
      if (Math.abs(dx) + Math.abs(dy) < 5) return;
      drag.started = true;
      document.body.classList.add(drag.mode === 'resize' ? 'is-resizing' : 'is-dragging');
    }
    e.preventDefault();
    var h = hours(), hs = h.hs * 60, he = h.he * 60;
    var step = Math.round(dy / HOUR * 60 / 15) * 15; // 15분 단위
    var grid = $('#grid');
    var src = grid.querySelector('.ev[data-ev="' + drag.id + '"][data-date="' + drag.date + '"]');
    if (src) src.classList.add('dragging-src');
    var target = null;
    if (drag.mode === 'move') {
      grid.querySelectorAll('.tt-col').forEach(function (c) {
        var r = c.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX < r.right) target = c;
      });
      if (target) drag.nd = target.dataset.date;
      target = grid.querySelector('.tt-col[data-date="' + drag.nd + '"]');
      var dur = drag.e - drag.s;
      drag.ns = drag.dl ? clamp(drag.s + step, hs, Math.min(he, 1440) - 1) : clamp(drag.s + step, hs, he - dur);
      drag.ne = drag.dl ? drag.ns : drag.ns + dur;
    } else {
      target = grid.querySelector('.tt-col[data-date="' + drag.date + '"]');
      drag.ne = clamp(drag.e + step, drag.s + 15, he);
    }
    if (!target) return;
    if (!drag.ghost || !drag.ghost.isConnected) {
      if (drag.ghost) drag.ghost.remove();
      var base = src || drag.el;
      drag.ghost = base.cloneNode(true);
      drag.ghost.classList.remove('dragging-src', 'is-done');
      drag.ghost.classList.add('ghost');
      drag.ghost.removeAttribute('tabindex');
    }
    if (drag.ghost.parentNode !== target) target.appendChild(drag.ghost);
    var y = (drag.ns - hs) / 60 * HOUR;
    if (drag.dl) {
      drag.ghost.style.top = dlTop(y) + 'px';
    } else {
      drag.ghost.style.top = (y + 1) + 'px';
      drag.ghost.style.height = Math.max((drag.ne - drag.ns) / 60 * HOUR - 2, 20) + 'px';
    }
    drag.ghost.style.left = '3px';
    drag.ghost.style.width = 'calc(100% - 6px)';
    var label = drag.dl ? fromMin(drag.ns) : fromMin(drag.ns) + '–' + fromMin(drag.ne);
    var tEl = drag.ghost.querySelector('.ev-time') || drag.ghost.querySelector('.ev-time-inline');
    if (tEl) tEl.textContent = label;
  }
  function onDragEnd(e) {
    if (!drag) return;
    var d = drag; drag = null;
    document.body.classList.remove('is-dragging', 'is-resizing');
    if (d.ghost) d.ghost.remove();
    var src = document.querySelector('.ev.dragging-src');
    if (src) src.classList.remove('dragging-src');
    if (!d.started) return;
    suppressClick = true;
    setTimeout(function () { suppressClick = false; }, 0);
    if (e && e.type === 'pointercancel') return;
    commitDrag(d);
  }
  function commitDrag(d) {
    var ev = S.events.get(d.id);
    if (!ev) return;
    var moved = d.mode === 'move';
    var newDate = moved ? d.nd : d.date;
    var start = fromMin(d.ns);
    var end = isDeadline(ev) ? null : (moved ? (ev.end ? storeEnd(d.ne) : null) : storeEnd(d.ne));
    var changes = { start: start, end: end };
    if (!moved) changes.openEnd = false;
    if (newDate === d.date && start === ev.start && end === ev.end) return;
    var prev = clone(ev);
    var msg = moved ? (isDeadline(ev) ? '마감을 옮겼어요' : '일정을 옮겼어요') : '시간을 바꿨어요';
    if (ev.repeat !== 'weekly') {
      var done = Object.assign({}, ev.done || {});
      if (done[d.date] && newDate !== d.date) { delete done[d.date]; done[newDate] = true; }
      store.putEvent(Object.assign({}, ev, changes, { date: newDate, done: done, updated: Date.now() }));
      undoToast(msg, [prev], []);
      return;
    }
    var newDow = parseKey(newDate).getDay(), oldDow = parseKey(d.date).getDay();
    choose({
      title: '반복 일정 ' + (moved ? '옮기기' : '시간 바꾸기'),
      text: '"' + ev.title + '"은(는) 매주 반복돼요. ' + mdDow(d.date) + ' 하루만 바꿀까요, 반복 전체를 바꿀까요?' +
        (moved && newDow !== oldDow ? ' (반복 전체를 고르면 ' + DOW[oldDow] + '요일 → ' + DOW[newDow] + '요일로 바뀌어요)' : ''),
      a: mdDow(d.date) + ' 하루만',
      b: '반복 전체'
    }, function (r) {
      if (!r) { render(); return; }
      if (r === 'a') {
        var skip = Object.assign({}, ev.skip || {}); skip[d.date] = true;
        var copy = Object.assign({}, clone(ev), changes, {
          id: newId(), repeat: 'once', date: newDate, skip: {}, origin: ev.id,
          done: ev.done && ev.done[d.date] ? (function () { var o = {}; o[newDate] = true; return o; })() : {},
          created: Date.now(), updated: Date.now()
        });
        delete copy.days; delete copy.from; delete copy.until;
        store.putEvent(Object.assign({}, ev, { skip: skip }));
        store.putEvent(copy);
        undoToast(mdDow(d.date) + ' 하루만 바꿨어요', [prev], [copy.id]);
      } else {
        var days = ev.days.slice();
        if (moved && newDow !== oldDow) {
          days = days.filter(function (x) { return x !== oldDow; });
          if (days.indexOf(newDow) < 0) days.push(newDow);
          days.sort();
        }
        store.putEvent(Object.assign({}, ev, changes, { days: days, updated: Date.now() }));
        undoToast('반복 전체를 바꿨어요', [prev], []);
      }
    });
  }

  /* ---------------- 할 일 ---------------- */
  function addTask(text) {
    store.putTask({
      id: newId(), text: text, state: 'todo', scope: S.tab,
      period: S.tab === 'week' ? weekKey() : monthKey(), created: Date.now()
    });
  }
  function nextPeriodOf(t) {
    if (t.scope === 'week') return keyOf(addDays(parseKey(t.period), 7));
    var p = t.period.split('-').map(Number);
    return monthKeyOf(new Date(p[0], p[1], 1));
  }
  function postpone(t, quiet) {
    var label = t.scope === 'week' ? '다음 주로 미룸' : '다음 달로 미룸';
    store.putTask(Object.assign({}, t, { state: 'later', note: label }));
    store.putTask({ id: newId(), text: t.text, state: 'todo', scope: t.scope, period: nextPeriodOf(t), created: Date.now(), from: t.id });
    if (!quiet) toast(t.scope === 'week' ? '다음 주 할 일로 옮겼어요' : '다음 달 할 일로 옮겼어요');
  }
  function startTaskEdit(li, t) {
    S.editingTask = t.id;
    var span = li.querySelector('.task-text');
    var input = document.createElement('input');
    input.className = 'task-edit'; input.value = t.text; input.maxLength = 200;
    input.setAttribute('aria-label', '할 일 고치기');
    span.replaceWith(input);
    input.focus(); input.select();
    var finished = false;
    function finish(save) {
      if (finished) return; finished = true;
      S.editingTask = null;
      var v = input.value.trim();
      if (save && v && v !== t.text) store.putTask(Object.assign({}, t, { text: v }));
      else renderSide();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', function () { finish(true); });
  }

  /* ---------------- 한 주 마무리 ---------------- */
  var wrapItems = [];
  function openWrap() {
    var keys = weekKeys(), tk = todayKey();
    var occ = occurrencesFor(keys);
    var evAll = 0, evDone = 0, dlAll = 0, dlDone = 0;
    var missed = [];
    occ.forEach(function (list) {
      list.forEach(function (o) {
        if (isDeadline(o.ev)) { dlAll++; if (o.done) dlDone++; }
        else { evAll++; if (o.done) evDone++; }
        if (!o.done && o.date <= tk && o.ev.repeat !== 'weekly') missed.push(o);
      });
    });
    var tasks = Array.from(S.tasks.values()).filter(function (t) { return t.scope === 'week' && t.period === weekKey(); });
    var tDone = tasks.filter(function (t) { return t.state === 'done' || t.state === 'moved'; }).length;
    var tLeft = tasks.filter(function (t) { return (t.state || 'todo') === 'todo'; });
    var num = function (b, a, l) { return '<div class="wrap-num"><b>' + b + ' / ' + a + '</b><span>' + l + '</span></div>'; };
    $('#wrapHeading').textContent = mdDow(keys[0]) + ' – ' + mdDow(keys[6]) + ' 마무리';
    $('#wrapNums').innerHTML = num(evDone, evAll, '일정 완료') + num(dlDone, dlAll, '마감 완료') + num(tDone, tasks.length, '할 일 완료');
    $('#wrapStats').innerHTML = statsHtml(categoryStats(keys));
    wrapItems = tLeft.map(function (t) { return { type: 'task', t: t, checked: true, label: t.text, src: '할 일' }; })
      .concat(missed.map(function (o) { return { type: 'event', o: o, checked: false, label: o.ev.title, src: (isDeadline(o.ev) ? '놓친 마감 · ' : '놓친 일정 · ') + mdDow(o.date) }; }));
    $('#wrapCarry').innerHTML = wrapItems.length ? wrapItems.map(function (it, i) {
      return '<li><label><input type="checkbox" data-i="' + i + '"' + (it.checked ? ' checked' : '') + '><span>' + esc(it.label) + '</span><span class="src">' + esc(it.src) + '</span></label></li>';
    }).join('') : '<li class="empty">옮길 것이 없어요. 이번 주 할 일을 모두 정리했어요.</li>';
    $('#wrapReview').value = (S.settings.reviews || {})[weekKey()] || '';
    var wrapped = (S.settings.wrapped || {})[weekKey()];
    $('#wrapDo').textContent = wrapped ? '다시 저장' : '마무리하기';
    $('#wrapDialog').showModal();
  }
  function doWrap() {
    var wk = weekKey(), nextWk = keyOf(addDays(S.week, 7));
    var n = 0;
    $('#wrapCarry').querySelectorAll('input[type=checkbox]').forEach(function (cb) {
      if (!cb.checked) return;
      var it = wrapItems[Number(cb.dataset.i)];
      if (it.type === 'task') { postpone(it.t, true); n++; }
      else {
        store.putTask({ id: newId(), text: it.o.ev.title, state: 'todo', scope: 'week', period: nextWk, created: Date.now(), note: (isDeadline(it.o.ev) ? '놓친 마감 · ' : '놓친 일정 · ') + mdDow(it.o.date) });
        n++;
      }
    });
    var reviews = Object.assign({}, S.settings.reviews || {}); reviews[wk] = $('#wrapReview').value;
    var wrapped = Object.assign({}, S.settings.wrapped || {}); wrapped[wk] = true;
    store.putSettings({ reviews: reviews, wrapped: wrapped });
    $('#wrapDialog').close();
    toast('한 주를 마무리했어요' + (n ? ' · ' + n + '개를 다음 주로 옮겼어요' : ''), {
      label: '다음 주 보기', fn: function () { S.week = addDays(S.week, 7); S.tab = 'week'; render(); }
    });
  }

  /* ---------------- 설정 창 ---------------- */
  var draftCats = [];
  function openSettings() {
    draftCats = clone(cats());
    renderCatRows();
    renderThemeToggle();
    var hs = $('#hourStart'), he = $('#hourEnd'), o1 = '', o2 = '';
    for (var h = 0; h <= 23; h++) o1 += '<option value="' + h + '">' + pad(h) + ':00</option>';
    for (var h2 = 1; h2 <= 24; h2++) o2 += '<option value="' + h2 + '">' + pad(h2) + ':00</option>';
    hs.innerHTML = o1; he.innerHTML = o2;
    hs.value = String(S.settings.hourStart); he.value = String(S.settings.hourEnd);
    if (S.mode === 'cloud' && S.user) {
      $('#accountText').textContent = (S.user.displayName ? S.user.displayName + ' · ' : '') + (S.user.email || '') + ' 계정으로 로그인했어요. 로그인한 모든 기기에서 같은 일정이 보여요.';
      $('#logoutBtn').hidden = false;
    } else {
      $('#accountText').textContent = '로컬 모드: 이 기기의 이 브라우저에만 저장돼요. firebase-config.js를 채우면 로그인과 동기화가 켜져요.';
      $('#logoutBtn').hidden = true;
    }
    if (!$('#setDialog').open) $('#setDialog').showModal();
  }
  function renderThemeToggle() {
    var p = themePref();
    $('#themeToggle').querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-checked', b.dataset.themePick === p); });
  }
  function renderCatRows() {
    $('#catRows').innerHTML = draftCats.map(function (c, i) {
      return '<div class="cat-row" data-i="' + i + '">' +
        '<input type="color" value="' + esc(c.color) + '" aria-label="' + esc(c.name) + ' 색">' +
        '<input type="text" value="' + esc(c.name) + '" maxlength="20" aria-label="카테고리 이름">' +
        '<span class="preview" style="background:' + tint(c.color) + ';border-color:' + esc(c.color) + '"></span>' +
        '<button type="button" class="icon-btn" data-del-cat aria-label="' + esc(c.name) + ' 삭제"' + (draftCats.length <= 1 ? ' disabled' : '') + '>' + ICON.x + '</button></div>';
    }).join('');
  }
  function exportData() {
    var data = {
      app: 'weekly-journal', version: 1, exportedAt: new Date().toISOString(),
      events: Array.from(S.events.values()), tasks: Array.from(S.tasks.values()), settings: S.settings
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'weekly-journal-backup-' + todayKey() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function importData(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var data = JSON.parse(r.result);
        if (!data || !Array.isArray(data.events) || !Array.isArray(data.tasks)) throw new Error('형식이 달라요');
        $('#setDialog').close();
        choose({
          title: '백업 불러오기',
          text: '백업의 일정 ' + data.events.length + '개, 할 일 ' + data.tasks.length + '개를 불러올까요? 같은 항목은 백업 내용으로 덮어써요.',
          b: '불러오기'
        }, function (res) {
          if (!res) return;
          data.events.forEach(function (e) { if (e && e.id) store.putEvent(e); });
          data.tasks.forEach(function (t) { if (t && t.id) store.putTask(t); });
          if (data.settings) store.putSettings(data.settings);
          toast('백업을 불러왔어요');
        });
      } catch (e) { toast('백업 파일을 읽지 못했어요: ' + e.message); }
    };
    r.readAsText(file);
  }

  /* ---------------- 링크로 일정 추가·수정·삭제 (#add=...) ----------------
   * 주소 뒤에 #add=<JSON> 을 붙이면 확인 후 적용해요. JSON은 항목 하나 {…} 또는 여러 개 […].
   * 추가:  t 제목, d 날짜(YYYY-MM-DD), s 시작, e 끝, p 장소, m 메모, c 카테고리, u 시간 미정, o 끝 미정,
   *        w 매주 반복 요일 [0=일 … 6=토], f 반복 시작일, l 반복 종료일, dl:true 마감(s = 마감 시각, 기본 23:59)
   *        할 일: {"todo":"내용"} (+ d 그 주 목록, month:true 그 달 목록)
   * 수정:  {"op":"edit","find":"자동제어","set":{"m":"동영상강의"}}  (+ d: 그 날짜에 있는 것만. 반복 일정이면 그날만, all:true면 전체)
   * 삭제:  {"op":"del","find":"링크 테스트","d":"2026-10-30"}       (반복 일정 + d 이면 그날만, all:true면 전체)
   */
  function readLinkPayload() {
    var m = (location.hash || '').match(/^#add=([\s\S]+)$/);
    if (!m) return null;
    var raw = m[1], data = null;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    try { data = JSON.parse(decodeURIComponent(raw)); }
    catch (e) {
      try { data = JSON.parse(raw); }
      catch (e2) {
        try { data = JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))))); }
        catch (e3) { return { bad: true }; }
      }
    }
    if (data && !Array.isArray(data) && Array.isArray(data.items)) data = data.items;
    if (!Array.isArray(data)) data = [data];
    return { items: data };
  }
  function hashStr(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function normTime(t) {
    if (t == null || t === '') return null;
    var mm = String(t).trim().match(/^(\d{1,2}):?(\d{2})$/);
    if (!mm) return undefined;
    var h = Number(mm[1]), mi = Number(mm[2]);
    if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return undefined;
    return h === 24 ? '00:00' : pad(h) + ':' + pad(mi);
  }
  function isDateKey(d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(parseKey(d)); }
  function findCat(c) {
    if (!c) return cats()[0];
    var s = String(c).trim();
    var list = cats();
    for (var i = 0; i < list.length; i++) if (list[i].id === s || list[i].name === s) return list[i];
    for (var j = 0; j < list.length; j++) if (list[j].name.indexOf(s) >= 0 || s.indexOf(list[j].name.split('·')[0]) >= 0) return list[j];
    return list[0];
  }
  function normTitle(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }
  function matchEvents(find, d) {
    var n = normTitle(find);
    if (!n) return [];
    var all = Array.from(S.events.values());
    var list = all.filter(function (ev) { return normTitle(ev.title) === n; });
    if (!list.length) list = all.filter(function (ev) { return normTitle(ev.title).indexOf(n) >= 0; });
    if (isDateKey(d)) list = list.filter(function (ev) { return occursOn(ev, d, parseKey(d).getDay()); });
    return list;
  }
  function whenText(ev) {
    var w = ev.repeat === 'weekly'
      ? '매주 ' + (ev.days || []).map(function (i) { return DOW[i]; }).join('·')
      : (ev.date ? mdDow(ev.date) : '');
    return w + ' · ' + evTimeText(ev) + (ev.place ? ' · ' + ev.place : '');
  }
  // set의 내용을 일정에 적용 → { ev, changes[] } 또는 { bad }
  function applySet(ev, set) {
    var n = clone(ev), ch = [];
    var put = function (key, val, label, shown) {
      if (JSON.stringify(n[key]) === JSON.stringify(val)) return;
      n[key] = val; ch.push(label + ' → ' + (shown != null ? shown : (val === '' || val == null ? '(비움)' : val)));
    };
    if (set.t != null) put('title', String(set.t).slice(0, 100), '이름');
    if (set.p != null) put('place', String(set.p).slice(0, 100), '장소');
    if (set.m != null) put('memo', String(set.m).slice(0, 1000), '메모');
    if (set.c != null) { var c = findCat(set.c); put('cat', c.id, '카테고리', c.name); }
    if (set.u === true) { put('untimed', true, '시간', '미정'); n.start = null; n.end = null; n.openEnd = false; }
    if (set.s != null || set.e != null || set.o != null) {
      var s = set.s != null ? normTime(set.s) : n.start, e = set.e != null ? normTime(set.e) : n.end;
      if (s === undefined || e === undefined) return { bad: '시간을 읽을 수 없어요' };
      var oe = set.o != null ? !!set.o : (set.e != null ? false : !!n.openEnd);
      if (isDeadline(n)) { e = null; oe = false; }
      if (s && e && !oe && endMin(e) <= toMin(s)) return { bad: '끝 시간이 시작보다 빨라요' };
      if (s !== n.start || e !== n.end || oe !== !!n.openEnd) {
        n.start = s; n.end = oe ? null : e; n.openEnd = oe; n.untimed = !s;
        ch.push('시간 → ' + evTimeText(n));
      }
    }
    if (set.d != null && n.repeat !== 'weekly') {
      if (!isDateKey(set.d)) return { bad: '날짜를 읽을 수 없어요' };
      put('date', set.d, '날짜', mdDow(set.d));
    }
    if (n.repeat === 'weekly') {
      if (Array.isArray(set.w)) {
        var days = set.w.map(Number).filter(function (x) { return x >= 0 && x <= 6; }).sort();
        if (!days.length) return { bad: '반복 요일을 읽을 수 없어요' };
        put('days', days, '요일', days.map(function (i) { return DOW[i]; }).join('·'));
      }
      if (set.f != null) { if (!isDateKey(set.f)) return { bad: '반복 시작일을 읽을 수 없어요' }; put('from', set.f, '반복 시작일', mdDow(set.f)); }
      if (set.l !== undefined) {
        if (set.l && !isDateKey(set.l)) return { bad: '반복 종료일을 읽을 수 없어요' };
        put('until', set.l || null, '반복 종료일', set.l ? mdDow(set.l) : '없음');
      }
    }
    n.updated = Date.now();
    return { ev: n, changes: ch };
  }
  function normalizeLinkItem(x) {
    if (!x || typeof x !== 'object') return [{ bad: '읽을 수 없는 항목' }];
    if (x.op === 'edit' || x.op === 'del') return normalizeOp(x);
    var id = 'lnk-' + hashStr(JSON.stringify(x));
    if (x.todo) {
      var month = !!x.month;
      var base = isDateKey(x.d) ? parseKey(x.d) : new Date();
      var period = month ? monthKeyOf(addDays(startOfWeek(base), 4)) : keyOf(startOfWeek(base));
      var task = { id: id, text: String(x.todo).slice(0, 200), state: 'todo', scope: month ? 'month' : 'week', period: period, created: Date.now() };
      return [{
        kind: 'task', obj: task, exists: S.tasks.has(id),
        title: '할 일 · ' + task.text,
        meta: month ? (Number(period.slice(5)) + '월 할 일 목록') : (mdDow(period) + ' 주의 할 일 목록')
      }];
    }
    var title = String(x.t || x.title || '').trim().slice(0, 100);
    if (!title) return [{ bad: '제목이 없는 항목' }];
    var dl = !!x.dl;
    var days = Array.isArray(x.w) ? x.w : (Array.isArray(x.days) ? x.days : null);
    var weekly = !!(days && days.length);
    var s = normTime(x.s), e = normTime(x.e);
    if (s === undefined || e === undefined) return [{ bad: title + ': 시간을 읽을 수 없어요' }];
    if (dl && !s) s = '23:59';
    var untimed = !dl && (!!x.u || !s);
    var openEnd = !dl && !untimed && !!x.o;
    if (!dl && !untimed && !openEnd && !e) e = storeEnd(Math.min(toMin(s) + 60, 1440));
    if (!dl && !untimed && !openEnd && endMin(e) <= toMin(s)) return [{ bad: title + ': 끝 시간이 시작보다 빨라요' }];
    var c = findCat(x.c);
    var ev = {
      id: id, kind: dl ? 'deadline' : 'event', title: title, place: dl ? '' : String(x.p || x.place || '').slice(0, 100), memo: String(x.m || x.memo || '').slice(0, 1000),
      cat: c.id, repeat: weekly ? 'weekly' : 'once', untimed: untimed, openEnd: openEnd,
      start: untimed ? null : s, end: untimed || openEnd || dl ? null : e,
      done: {}, skip: {}, created: Date.now(), updated: Date.now(), via: 'link'
    };
    var when;
    if (weekly) {
      ev.days = days.map(Number).filter(function (n) { return n >= 0 && n <= 6; }).sort();
      if (!ev.days.length) return [{ bad: title + ': 반복 요일을 읽을 수 없어요' }];
      ev.from = isDateKey(x.f) ? x.f : (isDateKey(x.d) ? x.d : todayKey());
      ev.until = isDateKey(x.l) ? x.l : null;
      when = '매주 ' + ev.days.map(function (i) { return DOW[i]; }).join('·') + ' · ' + mdDow(ev.from) + '부터' + (ev.until ? ' ' + mdDow(ev.until) + '까지' : '');
    } else {
      if (!isDateKey(x.d)) return [{ bad: title + ': 날짜가 없어요' }];
      ev.date = x.d;
      when = mdDow(x.d);
    }
    return [{
      kind: 'event', obj: ev, exists: S.events.has(id), cat: c,
      title: (dl ? '마감 · ' : '') + title, meta: when + ' · ' + evTimeText(ev) + (ev.place ? ' · ' + ev.place : '') + ' · ' + c.name
    }];
  }
  function normalizeOp(x) {
    var find = x.find || x.t || x.title;
    var d = isDateKey(x.d) ? x.d : null;
    var list = matchEvents(find, d);
    if (!list.length) return [{ bad: '"' + (find || '') + '"' + (d ? ' (' + mdDow(d) + ')' : '') + ' 일정을 찾지 못했어요' }];
    return list.map(function (ev) {
      var c = catOf(ev.cat);
      var oneDay = ev.repeat === 'weekly' && d && !x.all;
      var base = { cat: c, title: ev.title, meta: whenText(ev), target: ev };
      if (x.op === 'del') {
        return Object.assign(base, { kind: 'del', oneDay: oneDay ? d : null, flag: oneDay ? mdDow(d) + ' 하루만 삭제' : (ev.repeat === 'weekly' ? '반복 전체 삭제' : '삭제') });
      }
      var set = x.set || {};
      var r = applySet(ev, set);
      if (r.bad) return { bad: ev.title + ': ' + r.bad };
      if (!r.changes.length) return Object.assign(base, { kind: 'edit', exists: true, flag: '이미 반영됨', changes: [] });
      if (oneDay) {
        var copy = Object.assign({}, r.ev, { id: 'lnk-' + hashStr(ev.id + d + JSON.stringify(set)), repeat: 'once', date: set.d && isDateKey(set.d) ? set.d : d, skip: {}, origin: ev.id,
          done: ev.done && ev.done[d] ? (function () { var o = {}; o[d] = true; return o; })() : {}, created: Date.now() });
        delete copy.days; delete copy.from; delete copy.until;
        return Object.assign(base, { kind: 'edit', oneDay: d, copy: copy, flag: mdDow(d) + ' 하루만 수정', changes: r.changes });
      }
      return Object.assign(base, { kind: 'edit', next: r.ev, flag: ev.repeat === 'weekly' ? '수정 (반복 전체)' : '수정', changes: r.changes });
    });
  }
  var linkItems = [];
  function showLinkDialog() {
    var p = pendingLink; pendingLink = null;
    if (p.bad) { toast('링크 내용을 읽지 못했어요. 링크가 잘렸는지 확인해 주세요.'); return; }
    linkItems = [];
    p.items.forEach(function (x) { linkItems = linkItems.concat(normalizeLinkItem(x)); });
    var ok = linkItems.filter(function (it) { return !it.bad && !it.exists; });
    var hasOps = ok.some(function (it) { return it.kind === 'edit' || it.kind === 'del'; });
    $('#linkHeading').textContent = hasOps ? '링크로 받은 변경' : '링크로 받은 일정';
    $('#linkList').innerHTML = linkItems.map(function (it) {
      if (it.bad) return '<li class="link-item is-skip is-bad"><span class="li-flag">적용할 수 없어요</span><span class="li-meta">' + esc(it.bad) + '</span></li>';
      var style = it.cat ? ' style="' + catVars(it.cat) + '"' : '';
      var flag = it.exists ? '<span class="li-flag">' + (it.flag || '이미 추가됨') + '</span>'
        : it.flag ? '<span class="li-flag ' + it.kind + '">' + esc(it.flag) + '</span>' : '';
      var changes = (it.changes || []).map(function (c) { return '<span class="li-change">' + esc(c) + '</span>'; }).join('');
      return '<li class="link-item' + (it.exists ? ' is-skip' : '') + '"' + style + '>' + flag +
        '<span class="li-title">' + esc(it.title) + '</span><span class="li-meta">' + esc(it.meta) + '</span>' + changes + '</li>';
    }).join('');
    $('#linkIntro').textContent = ok.length
      ? (hasOps ? '아래 ' + ok.length + '개를 적용할까요? 내용이 맞는지 확인해 주세요.' : '아래 ' + ok.length + '개를 추가할까요? 날짜와 시간이 맞는지 확인해 주세요.')
      : '새로 적용할 항목이 없어요.';
    $('#linkAdd').hidden = !ok.length;
    $('#linkAdd').textContent = ok.length + '개 ' + (hasOps ? '적용' : '추가');
    var d = $('#linkDialog');
    if (!d.open) d.showModal();
  }
  function addLinkItems() {
    var n = 0, firstDate = null, prevs = [], created = [];
    var touched = {};
    linkItems.forEach(function (it) {
      if (it.bad || it.exists) return;
      if (it.kind === 'task') { store.putTask(it.obj); n++; return; }
      if (it.kind === 'event') {
        store.putEvent(it.obj); created.push(it.obj.id);
        var d = it.obj.date || it.obj.from;
        if (!firstDate || d < firstDate) firstDate = d;
        n++; return;
      }
      var cur = S.events.get(it.target.id);
      if (!cur) return;
      if (!touched[cur.id]) { prevs.push(clone(cur)); touched[cur.id] = true; }
      if (it.kind === 'del') {
        if (it.oneDay) { var sk = Object.assign({}, cur.skip || {}); sk[it.oneDay] = true; store.putEvent(Object.assign({}, cur, { skip: sk })); }
        else store.delEvent(cur.id);
      } else if (it.oneDay) {
        var sk2 = Object.assign({}, cur.skip || {}); sk2[it.oneDay] = true;
        store.putEvent(Object.assign({}, cur, { skip: sk2 }));
        store.putEvent(it.copy); created.push(it.copy.id);
      } else {
        store.putEvent(it.next);
      }
      n++;
    });
    $('#linkDialog').close();
    if (firstDate && S.view === 'week') { S.week = startOfWeek(parseKey(firstDate)); render(); }
    if (prevs.length) undoToast(n + '개 적용했어요', prevs, created);
    else toast(n + '개 추가했어요');
  }

  /* ---------------- 안내 메시지 ---------------- */
  var toastTimer;
  function toast(msg, action) {
    var t = $('#toast'), b = $('#toastAct');
    $('#toastText').textContent = msg;
    b.hidden = !action;
    b.onclick = null;
    if (action) {
      b.textContent = action.label;
      b.onclick = function () { t.hidden = true; action.fn(); };
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, action ? 6500 : 2600);
  }
  function undoToast(msg, prevs, createdIds) {
    toast(msg, {
      label: '되돌리기', fn: function () {
        createdIds.forEach(function (id) { if (S.events.has(id)) store.delEvent(id); });
        prevs.forEach(function (p) { store.putEvent(p); });
        toast('되돌렸어요');
      }
    });
  }
  function showScreen(name) {
    $('#loading').hidden = name !== 'loading';
    $('#login').hidden = name !== 'login';
    $('#app').hidden = name !== 'app';
  }

  /* ---------------- 시간표 위치 → 시각 ---------------- */
  function minuteAt(col, clientY) {
    var h = hours();
    var y = clientY - col.getBoundingClientRect().top;
    var m = h.hs * 60 + Math.floor(y / HOUR * 2) * 30; // 30분 단위
    return Math.max(h.hs * 60, Math.min(m, h.he * 60 - 30));
  }

  function setView(v) {
    S.view = v;
    try { localStorage.setItem('wj-view', v); } catch (e) {}
    if (v === 'month') { var m = monthOfWeek(); S.month = new Date(m.getFullYear(), m.getMonth(), 1); }
    render();
  }

  /* ---------------- 이벤트 연결 ---------------- */
  function bind() {
    $('#viewWeek').onclick = function () { setView('week'); };
    $('#viewMonth').onclick = function () { setView('month'); };
    $('#prevBtn').onclick = function () {
      if (S.view === 'month') S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1);
      else S.week = addDays(S.week, -7);
      render();
    };
    $('#nextBtn').onclick = function () {
      if (S.view === 'month') S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1);
      else S.week = addDays(S.week, 7);
      render();
    };
    $('#todayBtn').onclick = function () {
      var now = new Date();
      if (S.view === 'month') S.month = new Date(now.getFullYear(), now.getMonth(), 1);
      else S.week = startOfWeek(now);
      render();
    };
    $('#addEventBtn').onclick = function () { openEditor({}); };
    $('#settingsBtn').onclick = openSettings;
    $('#editCatsLink').onclick = openSettings;
    $('#modeBadge').onclick = openSettings;
    $('#wrapBtn').onclick = openWrap;

    var saveGoal = debounce(function (wk, v) {
      var g = Object.assign({}, S.settings.goals || {}); g[wk] = v; store.putSettings({ goals: g });
    }, 600);
    $('#goalInput').addEventListener('input', function (e) { saveGoal(weekKey(), e.target.value); });
    var saveMemo = debounce(function (wk, v) {
      var m = Object.assign({}, S.settings.memos || {}); m[wk] = v; store.putSettings({ memos: m });
    }, 700);
    $('#memoInput').addEventListener('input', function (e) { saveMemo(weekKey(), e.target.value); });

    // 시간표 클릭
    var grid = $('#grid');
    grid.addEventListener('click', function (e) {
      if (suppressClick) return;
      var item = e.target.closest('[data-ev]');
      if (item) {
        if (e.target.closest('[data-check]')) toggleDone(item.dataset.ev, item.dataset.date);
        else openEditor({ id: item.dataset.ev, date: item.dataset.date });
        return;
      }
      var col = e.target.closest('.tt-col');
      if (col) { openEditor({ date: col.dataset.date, start: fromMin(minuteAt(col, e.clientY)) }); return; }
      var un = e.target.closest('.tt-un');
      if (un) openEditor({ date: un.dataset.date, untimed: true });
    });
    grid.addEventListener('keydown', function (e) {
      var item = e.target.closest('.ev');
      if (item && e.target === item && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault(); openEditor({ id: item.dataset.ev, date: item.dataset.date });
      }
    });

    // 끌어서 옮기기 / 길이 바꾸기 (마우스)
    grid.addEventListener('pointerdown', onDragStart);
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drag) { drag.started && (suppressClick = true); var d = drag; drag = null; document.body.classList.remove('is-dragging', 'is-resizing'); if (d.ghost) d.ghost.remove(); render(); setTimeout(function () { suppressClick = false; }, 0); }
    });

    // 한 달 보기: 날짜 → 그 주
    $('#month').addEventListener('click', function (e) {
      var day = e.target.closest('.mo-day'); if (!day) return;
      S.week = startOfWeek(parseKey(day.dataset.date));
      setView('week');
    });

    // 다가오는 마감
    $('#dlList').addEventListener('click', function (e) {
      var li = e.target.closest('.dl-item'); if (!li) return;
      if (e.target.closest('[data-check]')) { toggleDone(li.dataset.ev, li.dataset.date); toast('마감을 완료로 표시했어요', { label: '되돌리기', fn: function () { toggleDone(li.dataset.ev, li.dataset.date); } }); return; }
      if (e.target.closest('[data-go]')) {
        S.week = startOfWeek(parseKey(li.dataset.date));
        if (S.view !== 'week') setView('week'); else render();
      }
    });

    // 할 일 → 시간표 끌어다 놓기
    var dragId = null, dropLine = null;
    $('#taskList').addEventListener('dragstart', function (e) {
      var li = e.target.closest('.task[draggable="true"]');
      if (!li) return;
      dragId = li.dataset.id; li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', S.tasks.get(dragId).text); } catch (er) {}
    });
    $('#taskList').addEventListener('dragend', function (e) {
      var li = e.target.closest('.task'); if (li) li.classList.remove('dragging');
      dragId = null; clearDrop();
    });
    function clearDrop() {
      grid.querySelectorAll('.drop').forEach(function (el) { el.classList.remove('drop'); });
      if (dropLine) { dropLine.remove(); dropLine = null; }
    }
    grid.addEventListener('dragover', function (e) {
      if (!dragId) return;
      var col = e.target.closest('.tt-col'), un = e.target.closest('.tt-un');
      if (!col && !un) return;
      e.preventDefault();
      clearDrop();
      (col || un).classList.add('drop');
      if (col) {
        dropLine = document.createElement('div');
        dropLine.className = 'drop-line';
        dropLine.style.top = ((minuteAt(col, e.clientY) - hours().hs * 60) / 60 * HOUR) + 'px';
        col.appendChild(dropLine);
      }
    });
    grid.addEventListener('dragleave', function (e) { if (!grid.contains(e.relatedTarget)) clearDrop(); });
    grid.addEventListener('drop', function (e) {
      if (!dragId) return;
      e.preventDefault();
      var t = S.tasks.get(dragId), col = e.target.closest('.tt-col'), un = e.target.closest('.tt-un');
      clearDrop();
      if (!t) return;
      if (col) openEditor({ date: col.dataset.date, start: fromMin(minuteAt(col, e.clientY)), title: t.text, taskId: t.id });
      else if (un) openEditor({ date: un.dataset.date, untimed: true, title: t.text, taskId: t.id });
      dragId = null;
    });

    // 할 일 목록
    $('#tabWeek').onclick = function () { S.tab = 'week'; renderSide(); };
    $('#tabMonth').onclick = function () { S.tab = 'month'; renderSide(); };
    $('#taskForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('#taskInput').value.trim();
      if (!v) return;
      addTask(v);
      $('#taskInput').value = '';
    });
    $('#taskList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]'); if (!btn) return;
      var li = btn.closest('.task'), t = li && S.tasks.get(li.dataset.id); if (!t) return;
      var act = btn.dataset.act;
      if (act === 'cycle') {
        var st = t.state || 'todo';
        if (st === 'todo') store.putTask(Object.assign({}, t, { state: 'done' }));
        else if (st === 'done') store.putTask(Object.assign({}, t, { state: 'todo' }));
        else store.putTask(Object.assign({}, t, { state: 'todo', note: '' }));
      } else if (act === 'edit') startTaskEdit(li, t);
      else if (act === 'schedule') openEditor({ title: t.text, taskId: t.id });
      else if (act === 'later') postpone(t);
      else if (act === 'del') {
        var prev = clone(t);
        store.delTask(t.id);
        toast('할 일을 지웠어요', { label: '되돌리기', fn: function () { store.putTask(prev); } });
      }
    });

    // 일정 창
    var dlg = $('#evDialog');
    $('#kindEvent').onclick = function () { E.kind = 'event'; renderEditor(); };
    $('#kindDeadline').onclick = function () {
      E.kind = 'deadline';
      if (!$('#fStart').value || $('#fUntimed').checked) { $('#fStart').value = '23:59'; $('#fUntimed').checked = false; }
      renderEditor();
    };
    $('#modeOnce').onclick = function () { E.mode = 'once'; renderEditor(); };
    $('#modeWeekly').onclick = function () { E.mode = 'weekly'; renderEditor(); };
    $('#dayChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-day]'); if (!b) return;
      var d = Number(b.dataset.day), i = E.days.indexOf(d);
      if (i >= 0) E.days.splice(i, 1); else E.days.push(d);
      renderEditor();
    });
    $('#catChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cat]');
      if (b) { E.cat = b.dataset.cat; renderEditor(); return; }
      if (e.target.closest('[data-cat-edit]')) openSettings();
    });
    ['#fStart', '#fEnd', '#fDate', '#fFrom', '#fUntil', '#fUntimed', '#fOpenEnd'].forEach(function (s) {
      $(s).addEventListener('input', renderEditor);
      $(s).addEventListener('change', renderEditor);
    });
    $('#fStart').addEventListener('change', function () {
      if (E.kind === 'deadline') return;
      // 시작을 바꿨는데 끝이 비었거나 앞서면 1시간 뒤로 맞춤
      var s = toMin($('#fStart').value), e = $('#fEnd').value;
      if (s != null && (!e || endMin(e) <= s)) { $('#fEnd').value = storeEnd(Math.min(s + 60, 1440)); renderEditor(); }
    });
    $('#evForm').addEventListener('submit', function (e) { e.preventDefault(); saveEditor(); });
    $('#evDelete').onclick = askDelete;

    // 선택 창
    $('#choiceA').onclick = function () { finishChoice('a'); };
    $('#choiceB').onclick = function () { finishChoice('b'); };
    $('#choiceCancel').onclick = function () { finishChoice(null); };
    $('#choiceDialog').addEventListener('cancel', function (e) { e.preventDefault(); finishChoice(null); });

    // 한 주 마무리
    $('#wrapDo').onclick = doWrap;
    var saveReview = debounce(function (wk, v) {
      var r = Object.assign({}, S.settings.reviews || {}); r[wk] = v; store.putSettings({ reviews: r });
    }, 800);
    $('#wrapReview').addEventListener('input', function (e) { saveReview(weekKey(), e.target.value); });

    // 설정 창
    $('#themeToggle').addEventListener('click', function (e) {
      var b = e.target.closest('[data-theme-pick]'); if (!b) return;
      applyTheme(b.dataset.themePick);
      renderThemeToggle(); renderCatRows(); render();
    });
    if (darkMQ) {
      var onScheme = function () { if (themePref() === 'system') render(); };
      if (darkMQ.addEventListener) darkMQ.addEventListener('change', onScheme); else if (darkMQ.addListener) darkMQ.addListener(onScheme);
    }
    $('#catRows').addEventListener('input', function (e) {
      var row = e.target.closest('.cat-row'); if (!row) return;
      var c = draftCats[Number(row.dataset.i)];
      if (e.target.type === 'color') {
        c.color = e.target.value;
        var pv = row.querySelector('.preview'); pv.style.background = tint(c.color); pv.style.borderColor = c.color;
      } else c.name = e.target.value;
    });
    $('#catRows').addEventListener('click', function (e) {
      var b = e.target.closest('[data-del-cat]'); if (!b || draftCats.length <= 1) return;
      draftCats.splice(Number(b.closest('.cat-row').dataset.i), 1); renderCatRows();
    });
    $('#addCat').onclick = function () {
      var palette = ['#8a4fb0', '#b0485f', '#2f8a8a', '#5b6bbf', '#9a7a2e'];
      draftCats.push({ id: 'c' + newId().slice(0, 8), name: '새 카테고리', color: palette[draftCats.length % palette.length] });
      renderCatRows();
    };
    $('#setSave').onclick = function () {
      var hs = Number($('#hourStart').value), he = Number($('#hourEnd').value);
      if (he <= hs) { toast('끝 시각이 시작 시각보다 늦어야 해요'); return; }
      draftCats.forEach(function (c) { c.name = (c.name || '').trim() || '이름 없음'; });
      store.putSettings({ cats: draftCats, hourStart: hs, hourEnd: he });
      $('#setDialog').close();
      if ($('#evDialog').open) renderEditor();
      toast('설정을 저장했어요');
    };
    $('#exportBtn').onclick = exportData;
    $('#importInput').addEventListener('change', function (e) {
      if (e.target.files[0]) importData(e.target.files[0]);
      e.target.value = '';
    });
    $('#logoutBtn').onclick = function () { $('#setDialog').close(); store.logout(); };

    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { b.closest('dialog').close(); });
    });
    // 바깥(어두운 곳) 클릭으로 닫기
    document.querySelectorAll('dialog').forEach(function (d) {
      d.addEventListener('click', function (e) {
        if (e.target !== d) return;
        if (d.id === 'choiceDialog') finishChoice(null); else d.close();
      });
    });

    // 링크로 받은 일정
    $('#linkAdd').onclick = addLinkItems;
    window.addEventListener('hashchange', function () {
      var p = readLinkPayload();
      if (p) { pendingLink = p; render(); }
    });

    // 현재 시각 선 갱신
    setInterval(function () { if (S.ready && !document.hidden && !drag && S.view === 'week') renderGrid(); }, 60000);
  }

  /* ---------------- 미리보기용 예시 데이터 ---------------- */
  function seedDemo(raw) {
    var w = startOfWeek(new Date());
    function k(i) { return keyOf(addDays(w, i)); }
    var past = todayKey();
    function ev(day, title, start, end, cat, place, weekly) {
      var e = { id: newId(), kind: 'event', title: title, start: start, end: end, cat: cat, place: place || '', memo: '', untimed: false, openEnd: false, done: {}, skip: {}, created: Date.now() };
      if (weekly) { e.repeat = 'weekly'; e.days = [day]; e.from = keyOf(addDays(w, -56)); e.until = null; }
      else { e.repeat = 'once'; e.date = k(day); }
      if (k(day) < past) e.done[k(day)] = true;
      return e;
    }
    raw.events = [
      ev(0, '교회', '08:00', '16:00', 'cls', '동성교회', true),
      ev(1, '자동제어', '13:00', '15:00', 'cls', '학교 207관 234호', true),
      ev(1, '아날로그및디지털설계실습', '17:00', '19:00', 'cls', '학교', true),
      ev(2, '통신공학', '11:00', '13:00', 'cls', '학교 310관 727호', true),
      ev(2, '장한평 · 친구', '22:00', '00:00', 'cls', '장한평'),
      ev(3, '에너지변환공학', '11:00', '13:00', 'cls', '학교 310관 619호', true),
      ev(3, '결과보고서', '16:00', '17:30', 'study'),
      ev(3, '자동제어 9주차 ①', '18:00', '19:00', 'study'),
      ev(4, '러시아어', '12:00', '15:00', 'cls', '310관 B210호', true),
      ev(4, '순모임', '15:00', '17:00', 'cls', '학교', true),
      ev(4, '드럼 레슨', '18:00', '19:00', 'cls', '마노아스튜디오', true),
      ev(5, '병원 진료', '11:40', '12:10', 'cls', '건대하늘정신건강의학과'),
      ev(5, 'memoir 회의', '16:00', '20:00', 'cls', '작업실'),
      ev(6, '결과보고서 완성', '10:00', '11:30', 'study'),
      ev(6, '예비보고서', '13:00', '14:30', 'study'),
      ev(6, '자동제어 9주차 ②', '15:00', '16:00', 'study')
    ];
    var d1 = ev(6, '결과보고서 제출', '23:59', null, 'study'); d1.kind = 'deadline';
    var d2 = ev(1, '자동제어 영상 수강', '23:59', null, 'study', '', true); d2.kind = 'deadline'; d2.done = {};
    raw.events.push(d1, d2);
    raw.events.push({ id: newId(), kind: 'event', title: '충전기 반납 (12–18시)', repeat: 'once', date: k(5), untimed: true, openEnd: false, start: null, end: null, cat: 'tbd', place: '', memo: '', done: {}, skip: {}, created: Date.now() });
    var wk = keyOf(w);
    raw.tasks = [
      { text: '충전기 반납 장소 확인', state: 'todo' },
      { text: '드럼 연습실 예약', state: 'todo' },
      { text: '방세 이체', state: 'todo' },
      { text: '회로설계 예비보고서 양식 받기', state: 'todo' },
      { text: '결과보고서 자료 수집', state: 'done' }
    ].map(function (t, i) { return Object.assign({ id: newId(), scope: 'week', period: wk, created: Date.now() + i }, t); });
    raw.settings = defaultSettings();
    raw.settings.goals[wk] = '보고서 2개 완성 + 자동제어 9주차 수강';
  }

  /* ---------------- 시작 ---------------- */
  function boot() {
    pendingLink = readLinkPayload();
    bind();
    var cfg = window.FIREBASE_CONFIG;
    if (cfg && cfg.apiKey) {
      S.mode = 'cloud';
      showScreen('loading');
      makeCloudStore(cfg).then(function (s) {
        store = s;
        $('#loginBtn').onclick = function () {
          $('#loginError').hidden = true;
          store.login().catch(function (e) {
            var m = e && e.code === 'auth/unauthorized-domain'
              ? '이 주소가 Firebase에 등록되지 않았어요. 안내서의 "승인된 도메인" 단계를 확인해 주세요.'
              : (e && e.code === 'auth/popup-closed-by-user' ? '로그인 창이 닫혔어요. 다시 눌러 주세요.' : '로그인하지 못했어요: ' + (e && (e.code || e.message)));
            $('#loginError').textContent = m; $('#loginError').hidden = false;
          });
        };
      }).catch(function (e) {
        console.error(e);
        showScreen('login');
        $('#loginBtn').hidden = true;
        $('#loginError').textContent = 'Firebase를 불러오지 못했어요. 인터넷 연결과 firebase-config.js 내용을 확인해 주세요. (' + (e && e.message) + ')';
        $('#loginError').hidden = false;
      });
    } else {
      S.mode = 'local';
      store = makeLocalStore();
      showScreen('app');
      store.start();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
