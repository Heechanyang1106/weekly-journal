/* 한 주 저널 — 주간 시간표 + 불렛저널 할 일 모음
 * 저장: firebase-config.js가 비어 있으면 이 기기(브라우저)에만, 채워져 있으면 Google 로그인 + Firestore 동기화.
 */
(function () {
  'use strict';

  var FIREBASE_VERSION = '10.12.2';
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var DEFAULT_CATS = [
    { id: 'cls', name: '수업·약속', color: '#4a72b0' },
    { id: 'study', name: '공부', color: '#2f7a55' },
    { id: 'move', name: '이동·준비', color: '#7a8191' },
    { id: 'tbd', name: '미정·예정', color: '#c08a2e' }
  ];
  function defaultSettings() {
    return { cats: clone(DEFAULT_CATS), hourStart: 8, hourEnd: 24, goals: {}, memos: {} };
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
  function toMin(t) { if (!t) return null; var p = t.split(':').map(Number); return p[0] * 60 + p[1]; }
  function endMin(t) { var m = toMin(t); return m === 0 ? 1440 : m; } // 끝 시각 00:00 = 자정(24:00)
  function fromMin(m) { if (m >= 1440) return '24:00'; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function md(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }
  function mdDow(k) { var d = parseKey(k); return md(d) + ' (' + DOW[d.getDay()] + ')'; }
  function monthKeyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function tint(hex, amt) {
    var h = (hex || '#888888').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    var f = function (c) { return Math.round(c + (255 - c) * amt); };
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }

  var ICON = {
    repeat: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" role="img" aria-label="반복"><path d="M2 8a6 6 0 0 1 10.5-4M14 8a6 6 0 0 1-10.5 4"/><path d="M12.5 1v3h-3M3.5 15v-3h3"/></svg>',
    pin: '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8 15s5-4.6 5-8.5A5 5 0 0 0 3 6.5C3 10.4 8 15 8 15Z"/><circle cx="8" cy="6.5" r="1.8"/></svg>',
    check: '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2.2" aria-hidden="true"><path d="m2.5 6.2 2.3 2.3 4.7-5"/></svg>',
    cal: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/></svg>',
    later: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"/></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>'
  };

  /* ---------------- 상태 ---------------- */
  var S = {
    week: startOfWeek(new Date()),
    tab: 'week',
    events: new Map(),
    tasks: new Map(),
    settings: defaultSettings(),
    mode: 'local',
    user: null,
    ready: false,
    editingTask: null
  };
  var store = null;

  function cats() { return (S.settings.cats && S.settings.cats.length) ? S.settings.cats : DEFAULT_CATS; }
  function catOf(id) { var c = cats(); for (var i = 0; i < c.length; i++) if (c[i].id === id) return c[i]; return c[0]; }
  function weekKey() { return keyOf(S.week); }
  function monthOfWeek() { return addDays(S.week, 4); } // 그 주 목요일이 속한 달
  function monthKey() { return monthKeyOf(monthOfWeek()); }

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
        showScreen('app');
        render();
        unsubs.push(fs.onSnapshot(col('events'), function (snap) {
          S.events = new Map(snap.docs.map(function (d) { return [d.id, d.data()]; }));
          render();
        }, fail));
        unsubs.push(fs.onSnapshot(col('tasks'), function (snap) {
          S.tasks = new Map(snap.docs.map(function (d) { return [d.id, d.data()]; }));
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
  // 이번 주 7일 각각에 보이는 일정(반복 포함) 목록
  function occurrencesForWeek(keys) {
    var out = keys.map(function () { return []; });
    S.events.forEach(function (ev) {
      keys.forEach(function (k, i) {
        if (occursOn(ev, k, i)) out[i].push({ ev: ev, date: k, done: !!(ev.done && ev.done[k]) });
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

  /* ---------------- 화면 그리기 ---------------- */
  function render() {
    if (!S.ready) return;
    renderHeader();
    renderGrid();
    renderSide();
  }

  function renderHeader() {
    var end = addDays(S.week, 6);
    var jan1 = new Date(S.week.getFullYear(), 0, 1);
    var wn = Math.round((S.week - startOfWeek(jan1)) / (7 * 864e5)) + 1;
    $('#rangeLabel').textContent = S.week.getFullYear() + '.' + pad(S.week.getMonth() + 1) + '.' + pad(S.week.getDate()) +
      ' — ' + pad(end.getMonth() + 1) + '.' + pad(end.getDate()) + ' · ' + wn + '주차';
    var goal = $('#goalInput');
    if (document.activeElement !== goal) goal.value = (S.settings.goals || {})[weekKey()] || '';
    $('#legend').innerHTML = cats().map(function (c) {
      return '<span><i class="sw" style="background:' + tint(c.color, 0.82) + ';border-color:' + esc(c.color) + '"></i>' + esc(c.name) + '</span>';
    }).join('');
    $('#modeBadge').hidden = S.mode !== 'local';
    var thisWeek = keyOf(startOfWeek(new Date())) === weekKey();
    $('#thisWeek').textContent = thisWeek ? '이번 주' : '이번 주로';
    $('.title-row h1').textContent = thisWeek ? '시간으로 보는 이번 주' : '시간으로 보는 한 주';
  }

  function renderGrid() {
    var hs = Number(S.settings.hourStart), he = Number(S.settings.hourEnd);
    if (!(he > hs)) { hs = 8; he = 24; }
    var rows = he - hs, H = 48;
    var days = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return addDays(S.week, i); });
    var keys = days.map(keyOf);
    var occ = occurrencesForWeek(keys);
    var now = new Date(), todayKey = keyOf(now);
    var doneTotal = 0, allTotal = 0;

    var html = '<div class="tt-corner"></div>';
    days.forEach(function (d, i) {
      var list = occ[i], dn = list.filter(function (o) { return o.done; }).length;
      doneTotal += dn; allTotal += list.length;
      html += '<div class="tt-head' + (keys[i] === todayKey ? ' is-today' : '') + '">' +
        '<div class="d1"><span class="dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + DOW[i] + '</span>' +
        '<span class="date">' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '</span></div>' +
        '<span class="sum">' + (list.length ? list.length + '개 · ' + dn + ' 완료' : '일정 없음') + '</span></div>';
    });

    // 시간 미정 줄
    html += '<div class="tt-un-label">미정</div>';
    var timed = keys.map(function () { return []; });
    keys.forEach(function (k, i) {
      var chips = '';
      occ[i].forEach(function (o) {
        var ev = o.ev, s = toMin(ev.start), e = ev.end ? endMin(ev.end) : (s != null ? s + 60 : null);
        var outside = s != null && (e <= hs * 60 || s >= he * 60);
        if (ev.untimed || s == null || outside) {
          var c = catOf(ev.cat);
          var label = (outside ? ev.start + ' ' : '') + ev.title;
          chips += '<div class="chip-un' + (o.done ? ' is-done' : '') + '" data-ev="' + esc(ev.id) + '" data-date="' + k + '" style="--bar:' + esc(c.color) + ';--bg-c:' + tint(c.color, 0.84) + '" title="' + esc(ev.title + (ev.place ? ' · ' + ev.place : '')) + '">' +
            '<span class="t">' + esc(label) + '</span>' + (ev.repeat === 'weekly' ? ICON.repeat : '') +
            '<button type="button" class="ev-check" data-check aria-label="' + esc(ev.title) + (o.done ? ' 완료 취소' : ' 완료 표시') + '">' + (o.done ? ICON.check : '') + '</button></div>';
        } else {
          timed[i].push({ o: o, s: Math.max(s, hs * 60), e: Math.min(Math.max(e, s + 15), he * 60), rs: s, re: e });
        }
      });
      html += '<div class="tt-un" data-date="' + k + '">' + chips + '</div>';
    });

    // 시간 눈금
    html += '<div class="tt-times" style="--rows:' + rows + '">';
    for (var h = hs; h < he; h++) html += '<span style="top:' + ((h - hs) * H) + 'px">' + pad(h) + ':00</span>';
    html += '</div>';

    // 요일 칸
    keys.forEach(function (k, i) {
      var cls = 'tt-col' + (i === 0 || i === 6 ? ' weekend' : '') + (k === todayKey ? ' is-today' : '');
      html += '<div class="' + cls + '" data-date="' + k + '" style="--rows:' + rows + '">';
      layoutDay(timed[i]).forEach(function (it) {
        var ev = it.o.ev, c = catOf(ev.cat);
        var top = (it.s - hs * 60) / 60 * H, height = (it.e - it.s) / 60 * H;
        var short = height < 44;
        var w = 100 / it.lanes;
        var time = ev.start + (ev.openEnd ? '~' : (ev.end ? '–' + fromMin(endMin(ev.end)) : ''));
        html += '<div class="ev' + (it.o.done ? ' is-done' : '') + (short ? ' is-short' : '') + (ev.openEnd ? ' open-end' : '') + '"' +
          ' data-ev="' + esc(ev.id) + '" data-date="' + k + '" tabindex="0" role="button"' +
          ' aria-label="' + esc(ev.title + ', ' + time + (ev.place ? ', ' + ev.place : '')) + '"' +
          ' title="' + esc(ev.title + '\n' + time + (ev.openEnd ? ' (끝 미정)' : '') + (ev.place ? '\n' + ev.place : '') + (ev.memo ? '\n' + ev.memo : '')) + '"' +
          ' style="top:' + (top + 1) + 'px;height:' + Math.max(height - 2, 20) + 'px;left:calc(' + (it.lane * w) + '% + 3px);width:calc(' + w + '% - 6px);--bar:' + esc(c.color) + ';--bg-c:' + tint(c.color, 0.84) + '">' +
          '<div class="ev-body"><div class="ev-title">' + (short ? '<span class="ev-time-inline">' + esc(ev.start) + '</span>' : '') +
          '<span class="t">' + esc(ev.title) + '</span>' + (ev.repeat === 'weekly' ? ICON.repeat : '') + '</div>' +
          (!short ? '<div class="ev-meta"><span class="t">' + esc(time) + (ev.openEnd ? ' · 끝 미정' : '') + '</span></div>' : '') +
          (ev.place && height >= 76 ? '<div class="ev-meta">' + ICON.pin + '<span class="t">' + esc(ev.place) + '</span></div>' : '') +
          (ev.memo && height >= 110 ? '<div class="ev-meta"><span class="t">' + esc(ev.memo) + '</span></div>' : '') +
          '</div><button type="button" class="ev-check" data-check aria-label="' + esc(ev.title) + (it.o.done ? ' 완료 취소' : ' 완료 표시') + '">' + (it.o.done ? ICON.check : '') + '</button></div>';
      });
      if (k === todayKey) {
        var nm = now.getHours() * 60 + now.getMinutes();
        if (nm >= hs * 60 && nm <= he * 60) html += '<div class="now-line" style="top:' + ((nm - hs * 60) / 60 * H) + 'px"></div>';
      }
      html += '</div>';
    });

    $('#grid').innerHTML = html;
    // 폰처럼 화면이 좁으면 처음 열 때 오늘 칸이 보이도록 옆으로 스크롤
    if (!S.scrolledToday) {
      var board = $('.board'), todayCol = $('.tt-col.is-today');
      if (board && todayCol && board.scrollWidth > board.clientWidth) {
        board.scrollLeft = Math.max(0, todayCol.offsetLeft - 56 - 8);
        S.scrolledToday = true;
      }
    }
    $('#progress').innerHTML = allTotal ? '이번 주 완료 <b>' + doneTotal + ' / ' + allTotal + '</b>' : '';
  }

  function renderSide() {
    var mk = monthKey();
    var tabWeek = $('#tabWeek'), tabMonth = $('#tabMonth');
    tabMonth.textContent = (monthOfWeek().getMonth() + 1) + '월 전체';
    tabWeek.setAttribute('aria-selected', S.tab === 'week');
    tabMonth.setAttribute('aria-selected', S.tab === 'month');

    var memo = $('#memoInput');
    if (document.activeElement !== memo) memo.value = (S.settings.memos || {})[weekKey()] || '';

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
        acts += '<button type="button" data-act="schedule" aria-label="일정으로 만들기" title="일정으로 만들기">' + ICON.cal + '</button>' +
          '<button type="button" data-act="later" aria-label="' + (S.tab === 'week' ? '다음 주로' : '다음 달로') + ' 미루기" title="' + (S.tab === 'week' ? '다음 주로' : '다음 달로') + ' 미루기">' + ICON.later + '</button>';
      }
      acts += '<button type="button" data-act="del" aria-label="삭제" title="삭제">' + ICON.x + '</button>';
      return '<li class="task s-' + st + '" data-id="' + esc(t.id) + '"' + (st === 'todo' ? ' draggable="true"' : '') + '>' +
        '<button type="button" class="sig" data-act="cycle" aria-label="' + (st === 'done' ? '완료 취소' : '완료 표시') + '">' + SIG[st] + '</button>' +
        '<div class="task-main"><span class="task-text" data-act="edit">' + esc(t.text) + '</span>' + sub + '</div>' +
        '<div class="task-acts">' + acts + '</div></li>';
    }).join('');
    $('#taskList').innerHTML = html || '<li class="empty">아직 적어둔 할 일이 없어요.</li>';
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
      mode: ev ? (ev.repeat || 'once') : 'once',
      days: ev && ev.days ? ev.days.slice() : [parseKey(date).getDay()],
      cat: ev ? ev.cat : (opts.cat || cats()[0].id)
    };
    if (ev && !catOf(E.cat)) E.cat = cats()[0].id;
    var start = ev ? (ev.start || '') : (opts.start || '');
    var end = ev ? (ev.end || '') : (opts.end || (opts.start ? fromMin(Math.min(toMin(opts.start) + 60, 1439)) : ''));
    $('#evHeading').textContent = ev ? '일정 수정' : '일정 추가';
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
    renderEditor();
    $('#evDialog').showModal();
    if (!ev) $('#fTitle').focus();
  }
  function defaultDate() {
    var today = keyOf(new Date());
    return today >= weekKey() && today <= keyOf(addDays(S.week, 6)) ? today : weekKey();
  }
  function renderEditor() {
    var weekly = E.mode === 'weekly';
    $('#modeOnce').setAttribute('aria-checked', !weekly);
    $('#modeWeekly').setAttribute('aria-checked', weekly);
    $('#onceBox').hidden = weekly;
    $('#weeklyBox').hidden = !weekly;
    $('#rangeBox').hidden = !weekly;
    $('#dayChips').innerHTML = DOW.map(function (d, i) {
      return '<button type="button" data-day="' + i + '" class="' + (i === 0 ? 'sun' : i === 6 ? 'sat' : '') + '" aria-pressed="' + (E.days.indexOf(i) >= 0) + '">' + d + '</button>';
    }).join('');
    var untimed = $('#fUntimed').checked, openEnd = $('#fOpenEnd').checked;
    $('#fStart').disabled = untimed;
    $('#fEnd').disabled = untimed || openEnd;
    $('#fOpenEnd').disabled = untimed;
    $('#catChips').innerHTML = cats().map(function (c) {
      return '<button type="button" data-cat="' + esc(c.id) + '" aria-pressed="' + (c.id === E.cat) + '" style="--bar:' + esc(c.color) + ';--bg-c:' + tint(c.color, 0.84) + '">' + esc(c.name) + '</button>';
    }).join('') + '<button type="button" class="add-cat" data-cat-edit aria-label="카테고리 편집">+ 편집</button>';
    $('#evSummary').textContent = summaryText();
  }
  function summaryText() {
    var untimed = $('#fUntimed').checked, openEnd = $('#fOpenEnd').checked;
    var s = $('#fStart').value, e = $('#fEnd').value;
    var time = untimed ? '시간 미정' : (s ? s + (openEnd ? '~ (끝 미정)' : (e ? '–' + (e === '00:00' ? '24:00' : e) : '')) : '시간을 정해 주세요');
    if (E.mode === 'weekly') {
      var days = E.days.slice().sort().map(function (i) { return DOW[i]; });
      if (!days.length) return '반복할 요일을 골라 주세요';
      var from = $('#fFrom').value, until = $('#fUntil').value;
      var range = (from ? mdDow(from) + '부터' : '') + (until ? ' ' + mdDow(until) + '까지' : ' 계속');
      return '매주 ' + days.join('·') + ' ' + time + ' · ' + range + (E.id ? ' (반복 전체에 적용)' : '');
    }
    var d = $('#fDate').value;
    return (d ? mdDow(d) + ' ' : '') + time + ' · 한 번';
  }
  function saveEditor() {
    var err = function (m) { var el = $('#evError'); el.textContent = m; el.hidden = false; };
    var title = $('#fTitle').value.trim();
    if (!title) return err('일정 이름을 적어 주세요.');
    var untimed = $('#fUntimed').checked, openEnd = !untimed && $('#fOpenEnd').checked;
    var start = $('#fStart').value, end = $('#fEnd').value;
    if (!untimed) {
      if (!start) return err('시작 시간을 정하거나 "시간 미정"을 체크해 주세요.');
      if (!openEnd && end && endMin(end) <= toMin(start)) return err('끝 시간이 시작 시간보다 늦어야 해요.');
      if (!openEnd && !end) end = fromMin(Math.min(toMin(start) + 60, 1440)).replace('24:00', '00:00');
    }
    var old = E.id ? S.events.get(E.id) : null;
    var ev = {
      id: E.id || newId(),
      title: title,
      place: $('#fPlace').value.trim(),
      memo: $('#fMemo').value.trim(),
      cat: E.cat,
      repeat: E.mode,
      untimed: untimed,
      openEnd: openEnd,
      start: untimed ? null : start,
      end: untimed || openEnd ? null : end,
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
          note: (E.mode === 'weekly' ? '매주 일정으로 옮김' : mdDow(firstDate) + (ev.start ? ' ' + ev.start : '') + ' 일정으로 옮김')
        }));
      }
    }
    $('#evDialog').close();
    toast(old ? '일정을 고쳤어요' : '일정을 추가했어요');
    // 다른 주에 추가했으면 그 주로 이동
    if (E.mode === 'once') {
      var wk = startOfWeek(parseKey(ev.date));
      if (keyOf(wk) !== weekKey()) { S.week = wk; render(); }
    }
  }
  function askDelete() {
    var ev = S.events.get(E.id);
    if (!ev) return;
    var weekly = ev.repeat === 'weekly';
    $('#delText').textContent = weekly
      ? '"' + ev.title + '"은(는) 반복 일정이에요. ' + mdDow(E.occDate) + ' 하루만 지울까요, 반복 전체를 지울까요?'
      : '"' + ev.title + '"을(를) 지울까요?';
    $('#delOne').hidden = !weekly;
    $('#delOne').textContent = mdDow(E.occDate) + ' 하루만 삭제';
    $('#delAll').textContent = weekly ? '반복 전체 삭제' : '삭제';
    $('#delDialog').showModal();
  }

  function toggleDone(id, date) {
    var ev = S.events.get(id);
    if (!ev) return;
    var done = Object.assign({}, ev.done || {});
    if (done[date]) delete done[date]; else done[date] = true;
    store.putEvent(Object.assign({}, ev, { done: done }));
  }

  /* ---------------- 할 일 ---------------- */
  function addTask(text) {
    store.putTask({
      id: newId(), text: text, state: 'todo', scope: S.tab,
      period: S.tab === 'week' ? weekKey() : monthKey(), created: Date.now()
    });
  }
  function postpone(t) {
    var nextPeriod, label;
    if (t.scope === 'week') { nextPeriod = keyOf(addDays(parseKey(t.period), 7)); label = '다음 주로 미룸'; }
    else {
      var p = t.period.split('-').map(Number);
      nextPeriod = monthKeyOf(new Date(p[0], p[1], 1)); label = '다음 달로 미룸';
    }
    store.putTask(Object.assign({}, t, { state: 'later', note: label }));
    store.putTask({ id: newId(), text: t.text, state: 'todo', scope: t.scope, period: nextPeriod, created: Date.now(), from: t.id });
    toast(t.scope === 'week' ? '다음 주 할 일로 옮겼어요' : '다음 달 할 일로 옮겼어요');
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

  /* ---------------- 설정 창 ---------------- */
  var draftCats = [];
  function openSettings() {
    draftCats = clone(cats());
    renderCatRows();
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
    $('#setDialog').showModal();
  }
  function renderCatRows() {
    $('#catRows').innerHTML = draftCats.map(function (c, i) {
      return '<div class="cat-row" data-i="' + i + '">' +
        '<input type="color" value="' + esc(c.color) + '" aria-label="' + esc(c.name) + ' 색">' +
        '<input type="text" value="' + esc(c.name) + '" maxlength="20" aria-label="카테고리 이름">' +
        '<span class="preview" style="background:' + tint(c.color, 0.84) + ';border-color:' + esc(c.color) + '"></span>' +
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
    a.download = 'weekly-journal-backup-' + keyOf(new Date()) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function importData(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var data = JSON.parse(r.result);
        if (!data || !Array.isArray(data.events) || !Array.isArray(data.tasks)) throw new Error('형식이 달라요');
        if (!confirm('백업의 일정 ' + data.events.length + '개, 할 일 ' + data.tasks.length + '개를 불러올까요? 같은 항목은 백업 내용으로 덮어써요.')) return;
        data.events.forEach(function (e) { if (e && e.id) store.putEvent(e); });
        data.tasks.forEach(function (t) { if (t && t.id) store.putTask(t); });
        if (data.settings) store.putSettings(data.settings);
        $('#setDialog').close();
        toast('백업을 불러왔어요');
      } catch (e) { toast('백업 파일을 읽지 못했어요: ' + e.message); }
    };
    r.readAsText(file);
  }

  /* ---------------- 안내 메시지 ---------------- */
  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function showScreen(name) {
    $('#loading').hidden = name !== 'loading';
    $('#login').hidden = name !== 'login';
    $('#app').hidden = name !== 'app';
  }

  /* ---------------- 시간표 위치 → 시각 ---------------- */
  function minuteAt(col, clientY) {
    var hs = Number(S.settings.hourStart), he = Number(S.settings.hourEnd);
    var y = clientY - col.getBoundingClientRect().top;
    var m = hs * 60 + Math.floor(y / 48 * 2) * 30; // 30분 단위
    return Math.max(hs * 60, Math.min(m, he * 60 - 30));
  }

  /* ---------------- 이벤트 연결 ---------------- */
  function bind() {
    $('#prevWeek').onclick = function () { S.week = addDays(S.week, -7); render(); };
    $('#nextWeek').onclick = function () { S.week = addDays(S.week, 7); render(); };
    $('#thisWeek').onclick = function () { S.week = startOfWeek(new Date()); render(); };
    $('#addEventBtn').onclick = function () { openEditor({}); };
    $('#settingsBtn').onclick = openSettings;
    $('#editCatsLink').onclick = openSettings;
    $('#modeBadge').onclick = openSettings;

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
        dropLine.style.top = ((minuteAt(col, e.clientY) - Number(S.settings.hourStart) * 60) / 60 * 48) + 'px';
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
      else if (act === 'del') { store.delTask(t.id); toast('할 일을 지웠어요'); }
    });

    // 일정 창
    var dlg = $('#evDialog');
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
      // 시작을 바꿨는데 끝이 비었거나 앞서면 1시간 뒤로 맞춤
      var s = toMin($('#fStart').value), e = $('#fEnd').value;
      if (s != null && (!e || endMin(e) <= s)) { $('#fEnd').value = fromMin(Math.min(s + 60, 1440)).replace('24:00', '00:00'); renderEditor(); }
    });
    $('#evForm').addEventListener('submit', function (e) { e.preventDefault(); saveEditor(); });
    $('#evDelete').onclick = askDelete;
    $('#delOne').onclick = function () {
      var ev = S.events.get(E.id); if (!ev) return;
      var skip = Object.assign({}, ev.skip || {}); skip[E.occDate] = true;
      store.putEvent(Object.assign({}, ev, { skip: skip }));
      $('#delDialog').close(); dlg.close(); toast(mdDow(E.occDate) + ' 일정만 지웠어요');
    };
    $('#delAll').onclick = function () {
      store.delEvent(E.id);
      $('#delDialog').close(); dlg.close(); toast('일정을 지웠어요');
    };

    // 설정 창
    $('#catRows').addEventListener('input', function (e) {
      var row = e.target.closest('.cat-row'); if (!row) return;
      var c = draftCats[Number(row.dataset.i)];
      if (e.target.type === 'color') {
        c.color = e.target.value;
        var pv = row.querySelector('.preview'); pv.style.background = tint(c.color, 0.84); pv.style.borderColor = c.color;
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
      d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    });

    // 현재 시각 선 갱신
    setInterval(function () { if (S.ready && !document.hidden) renderGrid(); }, 60000);
  }

  /* ---------------- 미리보기용 예시 데이터 ---------------- */
  function seedDemo(raw) {
    var w = startOfWeek(new Date());
    function k(i) { return keyOf(addDays(w, i)); }
    var past = keyOf(new Date());
    function ev(day, title, start, end, cat, place, weekly) {
      var e = { id: newId(), title: title, start: start, end: end, cat: cat, place: place || '', memo: '', untimed: false, openEnd: false, done: {}, skip: {}, created: Date.now() };
      if (weekly) { e.repeat = 'weekly'; e.days = [day]; e.from = keyOf(addDays(w, -56)); e.until = null; }
      else { e.repeat = 'once'; e.date = k(day); }
      if (k(day) < past) e.done[k(day)] = true;
      return e;
    }
    raw.events = [
      ev(0, '교회', '08:00', '16:00', 'cls', '교회', true),
      ev(1, '자동제어 대면', '13:00', '15:00', 'cls', '학교', true),
      ev(1, '회로설계실습', '17:00', '19:00', 'cls', '학교', true),
      ev(2, '장한평 · 친구', '22:00', '00:00', 'cls', '장한평'),
      ev(3, '서현 이동', '08:00', '09:15', 'move'),
      ev(3, '모두의창업 멘토링', '09:30', '12:30', 'cls', '스파크플러스 분당2호점'),
      ev(3, '결과보고서', '16:00', '17:30', 'study'),
      ev(3, '자동제어 9주차 ①', '18:00', '19:00', 'study'),
      ev(4, '학교 이동', '10:45', '11:45', 'move'),
      ev(4, '러시아어', '12:00', '15:00', 'cls', '학교', true),
      ev(4, '드럼 개인 연습', '17:00', '18:00', 'tbd', '예약 예정'),
      ev(4, '드럼 레슨', '18:00', '19:00', 'cls', '당산', true),
      ev(5, '진료', '11:40', '12:10', 'cls'),
      ev(5, '메모어 만남', '16:00', '17:30', 'cls', '합정 작업실'),
      ev(6, '결과보고서 완성', '10:00', '11:30', 'study'),
      ev(6, '예비보고서', '13:00', '14:30', 'study'),
      ev(6, '자동제어 9주차 ②', '15:00', '16:00', 'study')
    ];
    var memo = raw.events[13]; memo.openEnd = true; memo.end = null;
    var charger = { id: newId(), title: '충전기 반납 (12–18시)', repeat: 'once', date: k(5), untimed: true, openEnd: false, start: null, end: null, cat: 'tbd', place: '', memo: '', done: {}, skip: {}, created: Date.now() };
    raw.events.push(charger);
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
