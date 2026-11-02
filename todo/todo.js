/*
 * Todo (jagemyr) – gränssnittet. All logik för text, datum och upprepning finns i core.js.
 *
 * - Avbockade uppgifter stryks över och flyttas till "Klara" längst ner.
 * - Återkommande uppgifter står överstrukna tills nästa datum och kommer då tillbaka oavbockade.
 * - Allt sparas som vanlig text i anteckningen, en uppgift per rad.
 */
(function () {
  'use strict';

  var VERSION = '1.7.0';
  var C = window.TodoCore;
  var COMPLETE_ANIMATION_MS = 350;
  var CONFIRM_MS = 3000;
  var NOT_CONNECTED_HINT_MS = 2500;

  var el = {
    form: document.getElementById('add-form'),
    input: document.getElementById('new-task'),
    addBtn: document.getElementById('add-btn'),
    openList: document.getElementById('open-list'),
    doneList: document.getElementById('done-list'),
    doneSection: document.getElementById('done-section'),
    doneTitle: document.getElementById('done-title'),
    clearDone: document.getElementById('clear-done'),
    empty: document.getElementById('empty'),
    counts: document.getElementById('counts'),
    saveState: document.getElementById('save-state'),
    notice: document.getElementById('notice'),
    lockedBanner: document.getElementById('locked-banner'),
    template: document.getElementById('task-template'),
    subTemplate: document.getElementById('subtask-template'),
    filters: document.getElementById('filters'),
    editPeople: document.getElementById('edit-people'),
    peoplePanel: document.getElementById('people-panel'),
    peopleList: document.getElementById('people-list'),
    peopleDone: document.getElementById('people-done'),
    addPersonForm: document.getElementById('add-person'),
    newPerson: document.getElementById('new-person'),
    einkToggle: document.getElementById('eink-toggle'),
    lists: document.querySelector('.lists'),
    dropLine: document.getElementById('drop-line')
  };

  // Filtret sparas per enhet, så att t.ex. dotterns telefon kan visa bara hennes uppgifter.
  var FILTER_KEY = 'se.jagemyr.todo.filter';

  // ---------- Inställningar per enhet (som i Te och NWO) ----------
  //
  // Filter och e-ink-läge sparas per enhet. I Standard Notes på telefonen kan pluginets
  // localStorage tömmas varje gång anteckningen öppnas, så valen sparas också i pluginets
  // data i Standard Notes, under en nyckel för just den här enheten. Ett val på telefonen
  // påverkar då inte datorn, och tvärtom.

  var PREFS_KEY = 'devicePrefs';
  var DEVICE = deviceKey();

  /** "Linux; Android 14; Kompakt; wv 480x800": modell och skärm, utan versionsnummer. */
  function deviceKey() {
    var ua = navigator.userAgent || '';
    var m = /\(([^)]*)\)/.exec(ua);
    var model = (m ? m[1] : ua.slice(0, 80))
      .replace(/Build\/[^;)]*/g, '')
      .replace(/\d+(?:[._]\d+)+/g, '')
      .replace(/\s*;\s*/g, '; ')
      .replace(/\s+/g, ' ')
      .trim();
    var w = 0, h = 0;
    try { w = Math.min(screen.width, screen.height); h = Math.max(screen.width, screen.height); } catch (e) { /* okänt */ }
    return model + ' ' + w + 'x' + h;
  }

  /** Den här enhetens inställningar i pluginets data i Standard Notes (före anslutning: inga). */
  function devicePrefs() {
    try {
      var all = relay && relay.getComponentDataValueForKey(PREFS_KEY);
      return (all && all[DEVICE]) || {};
    } catch (e) {
      return {};
    }
  }

  function loadPref(key) {
    var local = null;
    try { local = window.localStorage.getItem(key); } catch (e) { /* ingen lagring */ }
    if (local !== null) return local;
    var saved = devicePrefs()[key];
    return saved === undefined ? null : saved;
  }

  function storePref(key, value) {
    try {
      if (value) window.localStorage.setItem(key, value); else window.localStorage.removeItem(key);
    } catch (e) {
      // Ingen lagring här; Standard Notes sparar nedan.
    }
    try {
      if (!relay || !state.connected) return;
      var all = {};
      var current = relay.getComponentDataValueForKey(PREFS_KEY) || {};
      Object.keys(current).forEach(function (k) { all[k] = current[k]; });
      var mine = {};
      Object.keys(all[DEVICE] || {}).forEach(function (k) { mine[k] = all[DEVICE][k]; });
      if (value) mine[key] = value; else delete mine[key];
      all[DEVICE] = mine;
      relay.setComponentDataValueForKey(PREFS_KEY, all);
    } catch (e) {
      // Kan inte spara i Standard Notes; valet gäller tills editorn stängs.
    }
  }

  var state = {
    tasks: [],
    nextId: 1,
    expandedId: null,
    note: null,
    locked: false,
    lastSentText: null,
    today: C.today(),
    connected: false,
    filter: loadFilter(),
    people: C.DEFAULT_PEOPLE.slice(),
    editingPeople: false,
    // Uppgifterna i Att göra i visningsordning, och om de går att flytta (se Dra och släpp).
    openOrder: [],
    sortable: false,
    // Pågående drag eller null.
    drag: null
  };

  function loadFilter() {
    return loadPref(FILTER_KEY) || null;
  }

  function storeFilter(v) {
    storePref(FILTER_KEY, v);
  }

  function personClass(name) {
    if (name === C.EVERYONE) return 'p-all';
    var i = state.people.indexOf(name);
    return i >= 0 ? 'p' + (i % 6) : '';
  }

  function doc() {
    return { people: state.people, tasks: state.tasks };
  }

  // Uppgifter märkta Alla hör till var och en.
  function belongsToFilter(who) {
    return who === state.filter || who === C.EVERYONE;
  }

  function ownsTask(task) {
    return !state.filter || belongsToFilter(task.who);
  }

  /** Deluppgifter som syns: alla, eller bara filtrets persons om huvuduppgiften är någon annans. */
  function visibleSubs(task) {
    var subs = task.subtasks || [];
    if (ownsTask(task)) return subs;
    return subs.filter(function (s) { return belongsToFilter(s.who); });
  }

  function isVisible(task) {
    return ownsTask(task) || visibleSubs(task).length > 0;
  }

  /** Klar i den här vyn: själva uppgiften, eller alla ens egna deluppgifter i någon annans uppgift. */
  function isDoneInView(task) {
    if (task.done || ownsTask(task)) return task.done;
    var subs = visibleSubs(task);
    return subs.length > 0 && subs.every(function (s) { return s.done; });
  }

  // ---------- Diagnos (visas bara om Standard Notes inte svarar) ----------

  var diagInfo = { errors: [], messages: 0, lastMessage: '' };
  window.addEventListener('error', function (e) {
    diagInfo.errors.push(String(e.message || e).slice(0, 120));
  });
  window.addEventListener('unhandledrejection', function (e) {
    diagInfo.errors.push('promise: ' + String(e.reason).slice(0, 100));
  });
  window.addEventListener('message', function (e) {
    diagInfo.messages++;
    var d = e.data, kind = typeof d;
    if (kind === 'string') { try { d = JSON.parse(d); kind = 'json-sträng'; } catch (x) { /* ren sträng */ } }
    diagInfo.lastMessage = 'origin=' + e.origin + ' typ=' + kind + (d && d.action ? ' action=' + d.action : '');
  }, true);

  function diagText() {
    var m = /Chrome\/([\d.]+)/.exec(navigator.userAgent);
    var ref = '';
    try { ref = document.referrer ? new URL(document.referrer).origin : '(tom)'; } catch (e) { ref = '(ogiltig)'; }
    return [
      'Version: ' + VERSION,
      'WebView: ' + (m ? 'Chrome ' + m[1] : navigator.userAgent.slice(0, 80)),
      'I iframe: ' + (window.parent !== window),
      'Referrer: ' + ref,
      'Meddelanden mottagna: ' + diagInfo.messages + (diagInfo.lastMessage ? ' (senast ' + diagInfo.lastMessage + ')' : ''),
      'replaceChildren: ' + (typeof Element.prototype.replaceChildren),
      'Fel: ' + (diagInfo.errors.length ? diagInfo.errors.join(' | ') : 'inga')
    ].join('\n');
  }

  // Versionen längst ner till höger, så att man ser vilken version varje enhet kör.
  document.getElementById('version').textContent = 'v' + VERSION;

  // ---------- E-ink-läge ----------
  //
  // Svart och vitt, ramar i stället för färger och tonade bakgrunder, inga animationer.
  // Personfärgerna försvinner (namnen står ändå i text), försenat stryks under och den
  // valda personen står inverterad. Väljs per enhet med knappen i statusraden; utan val slås
  // det på av sig självt på svartvita skärmar och Mudita-telefoner.

  var EINK_KEY = 'se.jagemyr.todo.eink';

  function applyEink(on) {
    document.documentElement.classList.toggle('eink', on);
    el.einkToggle.setAttribute('aria-pressed', String(on));
  }

  /** Sparat val, annars på för svartvita skärmar och Mudita-telefoner. */
  function initEink() {
    var stored = loadPref(EINK_KEY);
    var auto = /Mudita|Kompakt/i.test(navigator.userAgent || '');
    try { auto = auto || window.matchMedia('(monochrome)').matches; } catch (e) { /* okänt */ }
    applyEink(stored === '1' || (stored === null && auto));
  }

  initEink();

  el.einkToggle.addEventListener('click', function () {
    var on = !document.documentElement.classList.contains('eink');
    storePref(EINK_KEY, on ? '1' : '0');
    applyEink(on);
  });

  var relay = new ComponentRelay({
    targetWindow: window,
    options: { coallesedSaving: true, coallesedSavingDelay: 250 },
    onReady: function () {
      state.connected = true;
      el.notice.hidden = true;
      setSaveState('', '');
      // Pluginets data kan saknas första gången; då börjar den tom.
      try { if (!relay.component.data) relay.component.data = {}; } catch (e) { /* okänt */ }
      // Nu finns pluginets data: läs e-ink-valet och filtret därifrån om localStorage var tomt.
      initEink();
      var filter = loadFilter();
      if (filter !== state.filter) {
        state.filter = filter;
        render();
      }
    }
  });

  setTimeout(function () {
    if (!state.connected) {
      el.notice.hidden = false;
      document.getElementById('diag').textContent = diagText();
      setSaveState('Ej ansluten', 'error');
    }
  }, NOT_CONNECTED_HINT_MS);

  // ---------- Från Standard Notes ----------

  relay.streamContextItem(function (note) {
    var isNewNote = !state.note || state.note.uuid !== note.uuid;
    var wasLocked = state.locked;
    state.note = note;
    state.locked = isLocked(note);

    if (isNewNote) {
      state.lastSentText = null;
      state.expandedId = null;
    }

    var textChanged = false;
    if (!note.isMetadataUpdate) {
      var incoming = (note.content && note.content.text) || '';
      var ours = C.serializeDocument(doc());
      // Vår egen sparning som kommer tillbaka ska inte rita om listan (då tappar man fokus).
      var isEcho = !isNewNote && (incoming === state.lastSentText || incoming === ours);
      if (!isEcho) {
        textChanged = true;
        loadTasks(incoming);
        state.today = C.today();
        if (C.rollover(state.tasks, state.today)) {
          save();
        }
      }
    }

    if (isNewNote || textChanged || wasLocked !== state.locked) {
      render();
    }
  });

  function loadTasks(text) {
    var expandedTask = findTask(state.expandedId);
    var parsed = C.parseDocument(text);
    state.people = parsed.people;
    state.tasks = parsed.tasks.map(function (t) {
      t.id = state.nextId++;
      t.subtasks.forEach(function (s) { s.id = state.nextId++; });
      return t;
    });
    // Behåll öppen detaljruta om samma uppgift finns kvar.
    state.expandedId = null;
    if (expandedTask) {
      var same = state.tasks.filter(function (t) { return t.title === expandedTask.title; })[0];
      if (same) state.expandedId = same.id;
    }
  }

  function isLocked(note) {
    var appData = note.content && note.content.appData;
    var sn = appData && appData['org.standardnotes.sn'];
    return Boolean(sn && sn.locked);
  }

  // ---------- Till Standard Notes ----------

  function save() {
    if (!state.note || state.locked) return;
    var note = state.note;
    var text = C.serializeDocument(doc());
    var preview = C.preview(state.tasks);
    setSaveState('Sparar…', '');
    relay.saveItemWithPresave(note, function () {
      note.content.text = text;
      note.content.preview_plain = preview;
      note.content.preview_html = null;
      state.lastSentText = text;
    }, function () {
      if (state.note && state.note.uuid === note.uuid) {
        setSaveState('Sparat', 'saved');
      }
    });
  }

  // ---------- Händelser ----------

  // Inga <form>-element: en sandboxad iframe utan allow-forms blockerar annars Enter och knappen.
  function onEnter(input, fn) {
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        fn();
      }
    });
  }

  onEnter(el.input, addTask);
  el.addBtn.addEventListener('click', addTask);

  function addTask() {
    var title = el.input.value.replace(/\s+/g, ' ').trim();
    if (!title || state.locked) return;
    // Med ett filter valt får den nya uppgiften den personen.
    state.tasks.unshift({ id: state.nextId++, title: title, done: false, who: state.filter, recur: null, due: null, doneDate: null, note: null, subtasks: [] });
    el.input.value = '';
    render();
    save();
    el.input.focus();
  }

  [el.openList, el.doneList].forEach(function (list) {
    list.addEventListener('change', onListChange);
    list.addEventListener('click', onListClick);
    list.addEventListener('input', onListInput);
    list.addEventListener('keydown', onListKeydown);
  });

  function taskFromEvent(event) {
    var li = event.target.closest('.task');
    return li ? findTask(Number(li.dataset.id)) : null;
  }

  function onListChange(event) {
    var task = taskFromEvent(event);
    if (!task || state.locked) return;
    var t = event.target;

    if (t.classList.contains('check')) {
      onCheck(task, t.checked, t.closest('.task'));
      return;
    }

    if (t.classList.contains('d-who')) {
      task.who = t.value || null;
      // Om uppgiften byter till någon annan än filtret försvinner den ur vyn; stäng då detaljerna.
      var top = findParent(task.id) || task;
      if (!isVisible(top) || (top !== task && visibleSubs(top).indexOf(task) < 0)) state.expandedId = null;
      save();
      render();
    } else if (t.classList.contains('d-recur')) {
      task.recur = t.value || null;
      save();
      render();
    } else if (t.classList.contains('d-due')) {
      task.due = t.value || null;
      save();
      render();
    }
  }

  function onCheck(task, checked, li) {
    var today = C.today();
    var parent = findParent(task.id);
    var top = parent || task;
    var wasDone = isDoneInView(top);

    if (parent) {
      if (checked) C.complete(task, today);
      else C.uncomplete(task);
      C.syncParent(parent, today);
    } else if (ownsTask(task)) {
      // Hela uppgiften med alla deluppgifter.
      if (checked) C.completeTree(task, today);
      else C.uncompleteTree(task);
    } else {
      // Någon annans uppgift i filtrerad vy: bara de egna deluppgifterna påverkas.
      visibleSubs(task).forEach(function (s) {
        if (checked) C.complete(s, today);
        else C.uncomplete(s);
      });
      C.syncParent(task, today);
    }
    save();

    var nowDone = isDoneInView(top);
    if (!wasDone && nowDone) {
      if (state.expandedId === top.id) state.expandedId = null;
      var topLi = parent ? li.parentElement.closest('.task') : li;
      if (parent) li.classList.add('is-done');
      topLi.classList.add('completing');
      setTimeout(render, COMPLETE_ANIMATION_MS);
    } else if (parent && checked) {
      // Visa överstrykningen en kort stund innan deluppgiften glider ner.
      li.classList.add('is-done');
      setTimeout(render, COMPLETE_ANIMATION_MS);
    } else {
      render();
    }
  }

  function addSubtask(parent, input) {
    var title = input.value.replace(/\s+/g, ' ').trim();
    if (!title || state.locked) return;
    // Med ett filter valt får deluppgiften den personen, om inte hela huvuduppgiften redan är personens.
    var who = state.filter && !belongsToFilter(parent.who) ? state.filter : null;
    parent.subtasks.push({ id: state.nextId++, title: title, done: false, who: who, recur: null, due: null, doneDate: null, note: null });
    input.value = '';
    C.syncParent(parent, C.today());
    save();
    render();
    var again = el.openList.querySelector('.task[data-id="' + parent.id + '"] .d-new-sub');
    if (again) again.focus({ preventScroll: true });
  }

  function showNote(li, task) {
    var p = li.querySelector('.note-text');
    p.textContent = task.note || '';
    // Visas under raden, men inte medan uppgiften redigeras (där finns textrutan).
    p.hidden = !task.note || state.expandedId === task.id;
  }

  function onListInput(event) {
    var task = taskFromEvent(event);
    if (task && !state.locked && event.target.classList.contains('d-note')) {
      task.note = event.target.value.replace(/\s+$/, '') || null;
      save();
      return;
    }
    if (!task || state.locked || !event.target.classList.contains('d-title')) return;
    var title = event.target.value.replace(/\s+/g, ' ');
    if (!title.trim()) return;
    task.title = title.trim();
    var li = event.target.closest('.task');
    li.querySelector('.title').textContent = task.title;
    save();
  }

  function onListKeydown(event) {
    if (event.key === 'Enter' && event.target.classList.contains('d-new-sub')) {
      event.preventDefault();
      var parent = taskFromEvent(event);
      if (parent) addSubtask(parent, event.target);
      return;
    }
    if (event.key === 'Enter' && event.target.classList.contains('d-title')) {
      event.preventDefault();
      state.expandedId = null;
      render();
    }
  }

  function onListClick(event) {
    var task = taskFromEvent(event);
    if (!task) return;
    var t = event.target;

    if (t.closest('.body')) {
      if (state.locked || task.done) return;
      state.expandedId = state.expandedId === task.id ? null : task.id;
      render();
      if (state.expandedId) {
        var input = el.openList.querySelector('.task[data-id="' + task.id + '"] .d-title');
        if (input) input.focus({ preventScroll: true });
      }
      return;
    }

    if (t.closest('.d-add-sub')) {
      addSubtask(task, t.closest('.details').querySelector('.d-new-sub'));
    } else if (t.closest('.d-clear-date')) {
      task.due = null;
      save();
      render();
    } else if (t.closest('.d-delete')) {
      var parent = findParent(task.id);
      if (parent) {
        parent.subtasks = parent.subtasks.filter(function (x) { return x !== task; });
        C.syncParent(parent, C.today());
      } else {
        state.tasks = state.tasks.filter(function (x) { return x !== task; });
      }
      state.expandedId = null;
      save();
      render();
    }
  }

  // "Rensa" kräver två tryck så att man inte råkar tömma listan.
  var confirmTimer = null;
  el.clearDone.addEventListener('click', function () {
    if (state.locked) return;
    if (!el.clearDone.classList.contains('confirm')) {
      el.clearDone.classList.add('confirm');
      el.clearDone.textContent = 'Tryck igen för att rensa';
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(resetClearButton, CONFIRM_MS);
      return;
    }
    resetClearButton();
    // Återkommande uppgifter ligger kvar, de kommer ju tillbaka.
    // Med ett filter valt rensas bara de uppgifter som syns.
    state.tasks = state.tasks.filter(function (t) { return !t.done || t.recur || !ownsTask(t); });
    save();
    render();
  });

  function resetClearButton() {
    clearTimeout(confirmTimer);
    el.clearDone.classList.remove('confirm');
    el.clearDone.textContent = 'Rensa';
  }

  // Ny dag (t.ex. över midnatt eller när appen öppnas igen): öppna återkommande uppgifter.
  function checkNewDay() {
    var now = C.today();
    if (now === state.today) return;
    state.today = now;
    if (C.rollover(state.tasks, now)) save();
    render();
  }
  setInterval(checkNewDay, 60000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) checkNewDay();
  });

  // ---------- Dra och släpp ----------
  //
  // Dra i greppet (⋮⋮) längst till höger på raden. Pointer events i stället för HTML5
  // drag-and-drop, som inte fungerar med fingret i iOS (som i NWO).
  //
  // Var uppgiften hamnar avgörs av var fingret är:
  // - övre eller nedre delen av en uppgift: före eller efter den,
  // - mitten av en uppgift: som deluppgift sist i den (nedre delen, när uppgiften redan har
  //   deluppgifter: först bland dem),
  // - bland en uppgifts deluppgifter: före eller efter deluppgiften fingret är över.
  // En deluppgift som dras ut bland uppgifterna blir en egen uppgift. Bara en nivå: en
  // uppgift som själv har deluppgifter kan flyttas men inte bli deluppgift.
  //
  // Med tangentbordet, när greppet har fokus: pil upp och ner flyttar ett steg, pil höger gör
  // uppgiften till deluppgift i uppgiften ovanför och pil vänster lyfter ut en deluppgift.

  var DRAG_THRESHOLD = 5;
  var AUTOSCROLL_EDGE = 56;
  var AUTOSCROLL_SPEED = 14;
  var suppressClickUntil = 0;

  el.openList.addEventListener('pointerdown', function (event) {
    var handle = event.target.closest('.drag-handle');
    if (!handle || state.drag || state.locked || !state.note) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    var li = handle.closest('.task');
    var item = findTask(Number(li.dataset.id));
    if (!item) return;
    event.preventDefault();
    state.drag = {
      pointerId: event.pointerId,
      handle: handle,
      li: li,
      item: item,
      // En uppgift med egna deluppgifter kan inte bli deluppgift (bara en nivå).
      canNest: !(item.subtasks && item.subtasks.length),
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
      started: false,
      target: null,
      intoLi: null,
      ghost: null,
      raf: 0
    };
    try { handle.setPointerCapture(event.pointerId); } catch (e) { /* äldre webbläsare */ }
  });

  document.addEventListener('pointermove', function (event) {
    var d = state.drag;
    if (!d || event.pointerId !== d.pointerId) return;
    event.preventDefault();
    d.lastY = event.clientY;
    if (!d.started) {
      if (Math.abs(event.clientY - d.startY) < DRAG_THRESHOLD && Math.abs(event.clientX - d.startX) < DRAG_THRESHOLD) return;
      startDrag();
    }
    updateDrag();
  });

  document.addEventListener('pointerup', function (event) { finishDrag(event, false); });
  document.addEventListener('pointercancel', function (event) { finishDrag(event, true); });

  // Efter ett drag ska klicket som följer inte fälla ut uppgiften under fingret.
  document.addEventListener('click', function (event) {
    if (Date.now() < suppressClickUntil) {
      event.stopPropagation();
      event.preventDefault();
    }
  }, true);

  function startDrag() {
    var d = state.drag;
    d.started = true;
    resetClearButton();
    // En utfälld uppgift fälls ihop, så att listan blir kort och lätt att dra i. Bara
    // gömd här; listan ritas om när draget är klart.
    if (state.expandedId !== null) {
      if (document.activeElement && el.openList.contains(document.activeElement)) document.activeElement.blur();
      el.openList.querySelectorAll('.details:not([hidden])').forEach(function (x) { x.hidden = true; });
      state.expandedId = null;
    }
    document.body.classList.add('is-dragging');
    d.li.classList.add('drag-source');
    var ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = d.item.title;
    document.body.appendChild(ghost);
    d.ghost = ghost;
    d.raf = requestAnimationFrame(autoScroll);
  }

  /** Räknar ut var uppgiften skulle hamna och visar det. */
  function updateDrag() {
    var d = state.drag;
    var lists = el.lists.getBoundingClientRect();
    if (d.ghost) {
      // Ovanför fingret, så att uppgiften man släpper på syns.
      d.ghost.style.left = (lists.left + 12) + 'px';
      d.ghost.style.width = Math.max(120, lists.width - 84) + 'px';
      d.ghost.style.top = (d.lastY - d.ghost.offsetHeight - 18) + 'px';
    }
    d.target = dropTarget(d.lastY);
    showDropTarget(d.target);
  }

  function liFor(task) {
    return el.openList.querySelector('.task[data-id="' + task.id + '"]');
  }

  function shownSubLis(li) {
    var ul = li.querySelector('.subtasks');
    return ul && !ul.hidden ? Array.prototype.slice.call(ul.children) : [];
  }

  /**
   * Målet för ett släpp vid y (fönsterkoordinat):
   *   { type: 'before' | 'after', task }               bland uppgifterna
   *   { type: 'sub-before' | 'sub-after', parent, sub } bland en uppgifts deluppgifter
   *   { type: 'nest-start' | 'nest-end', parent }       som deluppgift först eller sist
   * eller null när uppgiften skulle stanna där den är.
   */
  function dropTarget(y) {
    var d = state.drag;
    var item = d.item;
    var lis = Array.prototype.slice.call(el.openList.children);
    if (!lis.length) return null;

    for (var i = 0; i < lis.length; i++) {
      var li = lis[i];
      var task = findTask(Number(li.dataset.id));
      var r = li.getBoundingClientRect();
      if (y < r.top) {
        // Ovanför första uppgiften (eller i en glipa): före den här.
        return task === item ? null : { type: 'before', task: task };
      }
      if (y >= r.bottom) continue;

      var subLis = shownSubLis(li);
      var zoneBottom = subLis.length ? subLis[0].getBoundingClientRect().top : r.bottom;
      if (y < zoneBottom) {
        // Över själva uppgiften.
        if (task === item) return null;
        var f = (y - r.top) / Math.max(1, zoneBottom - r.top);
        if (d.canNest) {
          if (f < 0.3) return { type: 'before', task: task };
          if (f > 0.7) return subLis.length ? { type: 'nest-start', parent: task } : { type: 'after', task: task };
          return { type: 'nest-end', parent: task };
        }
        return { type: f < 0.5 ? 'before' : 'after', task: task };
      }

      // Bland uppgiftens deluppgifter.
      if (task === item) return null;
      if (!d.canNest) return { type: 'after', task: task };
      for (var j = 0; j < subLis.length; j++) {
        var sr = subLis[j].getBoundingClientRect();
        if (y >= sr.bottom) continue;
        var sub = findTask(Number(subLis[j].dataset.id));
        if (sub === item) return null;
        // Klara deluppgifter står alltid sist; en ny hamnar före dem.
        if (sub.done) return { type: 'nest-end', parent: task };
        return { type: y < (sr.top + sr.bottom) / 2 ? 'sub-before' : 'sub-after', parent: task, sub: sub };
      }
      return { type: 'nest-end', parent: task };
    }
    // Nedanför sista uppgiften.
    var lastTask = findTask(Number(lis[lis.length - 1].dataset.id));
    return lastTask === item ? null : { type: 'after', task: lastTask };
  }

  /** Strecket där uppgiften hamnar, och ram runt uppgiften den blir deluppgift i. */
  function showDropTarget(target) {
    var d = state.drag;
    var line = el.dropLine;
    var into = target && (target.type === 'nest-start' || target.type === 'nest-end' ||
      target.type === 'sub-before' || target.type === 'sub-after') ? liFor(target.parent) : null;
    if (d.intoLi !== into) {
      if (d.intoLi) d.intoLi.classList.remove('drop-into');
      if (into) into.classList.add('drop-into');
      d.intoLi = into;
    }
    if (!target) {
      line.hidden = true;
      return;
    }
    var y, left;
    var lists = el.lists.getBoundingClientRect();
    if (target.type === 'before' || target.type === 'after') {
      var r = liFor(target.task).getBoundingClientRect();
      y = target.type === 'before' ? r.top : r.bottom;
      left = lists.left + 8;
    } else {
      var pli = liFor(target.parent);
      var pr = pli.getBoundingClientRect();
      var ul = pli.querySelector('.subtasks');
      left = pr.left + (parseFloat(getComputedStyle(ul).paddingLeft) || 40);
      var subLis = shownSubLis(pli).filter(function (x) { return x !== d.li; });
      if (target.type === 'sub-before' || target.type === 'sub-after') {
        var sr = liFor(target.sub).getBoundingClientRect();
        y = target.type === 'sub-before' ? sr.top : sr.bottom;
      } else if (target.type === 'nest-start') {
        y = subLis.length ? subLis[0].getBoundingClientRect().top : pr.bottom;
      } else {
        // Efter sista ej klara deluppgiften, före de klara.
        var open = subLis.filter(function (x) { return !x.classList.contains('is-done'); });
        var firstDone = subLis.filter(function (x) { return x.classList.contains('is-done'); })[0];
        if (open.length) y = open[open.length - 1].getBoundingClientRect().bottom;
        else if (firstDone) y = firstDone.getBoundingClientRect().top;
        else y = pr.bottom - 8;
      }
    }
    line.hidden = false;
    line.classList.toggle('nest', Boolean(into));
    // Inte ovanför listans överkant, där strecket skulle kapas.
    line.style.top = Math.max(4, y - lists.top + el.lists.scrollTop - 1.5) + 'px';
    line.style.left = (left - lists.left) + 'px';
  }

  /** Skrollar listan när man drar nära över- eller underkanten. */
  function autoScroll() {
    var d = state.drag;
    if (!d || !d.started) return;
    var rect = el.lists.getBoundingClientRect();
    var speed = 0;
    if (d.lastY < rect.top + AUTOSCROLL_EDGE) {
      speed = -AUTOSCROLL_SPEED * Math.min(1, (rect.top + AUTOSCROLL_EDGE - d.lastY) / AUTOSCROLL_EDGE);
    } else if (d.lastY > rect.bottom - AUTOSCROLL_EDGE) {
      speed = AUTOSCROLL_SPEED * Math.min(1, (d.lastY - rect.bottom + AUTOSCROLL_EDGE) / AUTOSCROLL_EDGE);
    }
    if (speed) {
      var before = el.lists.scrollTop;
      el.lists.scrollTop = before + speed;
      if (el.lists.scrollTop !== before) updateDrag();
    }
    d.raf = requestAnimationFrame(autoScroll);
  }

  function finishDrag(event, cancelled) {
    var d = state.drag;
    if (!d || (event && event.pointerId !== d.pointerId)) return;
    var started = d.started;
    var target = d.target;
    cleanupDrag();
    if (!started) return;
    suppressClickUntil = Date.now() + 400;
    if (!cancelled && target) moveTask(d.item, target);
    else render();
  }

  /** Tar bort allt som hör till draget (utan att rita om). */
  function cleanupDrag() {
    var d = state.drag;
    if (!d) return;
    state.drag = null;
    cancelAnimationFrame(d.raf);
    try { d.handle.releasePointerCapture(d.pointerId); } catch (e) { /* redan släppt */ }
    document.body.classList.remove('is-dragging');
    d.li.classList.remove('drag-source');
    if (d.intoLi) d.intoLi.classList.remove('drop-into');
    if (d.ghost) d.ghost.remove();
    el.dropLine.hidden = true;
  }

  /** Syns uppgiften där den står nu (med filtret som är valt)? */
  function isShown(item) {
    var parent = findParent(item.id);
    if (!parent) return isVisible(item);
    return isVisible(parent) && visibleSubs(parent).indexOf(item) >= 0;
  }

  /** Flyttar uppgiften (eller deluppgiften) till målet och sparar. */
  function moveTask(item, target) {
    var before = C.serializeDocument(doc());
    var oldParent = findParent(item.id);
    var newParent = null;

    if (oldParent) oldParent.subtasks.splice(oldParent.subtasks.indexOf(item), 1);
    else state.tasks.splice(state.tasks.indexOf(item), 1);

    if (target.type === 'before' || target.type === 'after') {
      if (!item.subtasks) item.subtasks = [];
      var i = state.tasks.indexOf(target.task);
      state.tasks.splice(target.type === 'before' ? i : i + 1, 0, item);
    } else {
      newParent = target.parent;
      delete item.subtasks;
      var subs = newParent.subtasks;
      var j = subs.length;
      if (target.type === 'sub-before') j = subs.indexOf(target.sub);
      else if (target.type === 'sub-after') j = subs.indexOf(target.sub) + 1;
      else if (target.type === 'nest-start') j = 0;
      subs.splice(j, 0, item);
    }

    // Med ett filter valt ska uppgiften inte försvinna ur vyn: syns den inte på sin nya plats
    // får den filtrets person, som en ny uppgift.
    if (state.filter && !isShown(item)) item.who = state.filter;

    var today = C.today();
    if (oldParent && oldParent !== newParent) C.syncParent(oldParent, today);
    if (newParent) C.syncParent(newParent, today);

    if (C.serializeDocument(doc()) !== before) save();
    render();
  }

  // Tangentbord: pilarna flyttar uppgiften när greppet har fokus.
  el.openList.addEventListener('keydown', function (event) {
    var key = event.key;
    if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    var handle = event.target.closest && event.target.closest('.drag-handle');
    if (!handle || state.drag || state.locked) return;
    event.preventDefault();
    var item = findTask(Number(handle.closest('.task').dataset.id));
    if (!item) return;
    var parent = findParent(item.id);
    var target = null;

    if (parent) {
      var subs = visibleSubs(parent).filter(function (s) { return !s.done; });
      var k = subs.indexOf(item);
      if (key === 'ArrowUp' && k > 0) target = { type: 'sub-before', parent: parent, sub: subs[k - 1] };
      if (key === 'ArrowDown' && k < subs.length - 1) target = { type: 'sub-after', parent: parent, sub: subs[k + 1] };
      if (key === 'ArrowLeft') target = { type: 'after', task: parent };
    } else {
      var open = state.openOrder;
      var n = open.indexOf(item);
      if (key === 'ArrowUp' && n > 0) target = { type: 'before', task: open[n - 1] };
      if (key === 'ArrowDown' && n >= 0 && n < open.length - 1) target = { type: 'after', task: open[n + 1] };
      if (key === 'ArrowRight' && n > 0 && !(item.subtasks && item.subtasks.length)) {
        target = { type: 'nest-end', parent: open[n - 1] };
      }
    }
    if (!target) return;
    state.expandedId = null;
    moveTask(item, target);
    var moved = el.openList.querySelector('.task[data-id="' + item.id + '"] > .row .drag-handle');
    if (moved && !moved.hidden) moved.focus();
  });

  // ---------- Rendering ----------

  // ---------- Filter per person ----------

  el.filters.addEventListener('click', function (event) {
    var chip = event.target.closest('.chip');
    if (!chip) return;
    state.filter = chip.dataset.who || null;
    storeFilter(state.filter);
    state.expandedId = null;
    resetClearButton();
    render();
  });

  el.editPeople.addEventListener('click', function () {
    state.editingPeople = !state.editingPeople;
    render();
  });

  function renderFilters() {
    var frag = document.createDocumentFragment();
    [null].concat(state.people).forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (name ? ' ' + personClass(name) : '');
      b.dataset.who = name || '';
      b.setAttribute('aria-pressed', String(state.filter === name));
      if (name) {
        var dot = document.createElement('span');
        dot.className = 'dot';
        b.appendChild(dot);
      }
      b.appendChild(document.createTextNode(name || 'Alla'));
      frag.appendChild(b);
    });
    el.filters.replaceChildren(frag);
    // Se till att den valda personen syns om raden är bredare än skärmen.
    var active = el.filters.querySelector('.chip[aria-pressed="true"]');
    if (active) {
      var r = active.getBoundingClientRect();
      var rr = el.filters.getBoundingClientRect();
      if (r.right > rr.right) el.filters.scrollLeft += r.right - rr.right + 4;
      else if (r.left < rr.left) el.filters.scrollLeft -= rr.left - r.left + 4;
    }
    el.editPeople.hidden = state.locked || !state.note;
    el.editPeople.setAttribute('aria-pressed', String(state.editingPeople));
  }

  // ---------- Ändra personer ----------

  el.peopleDone.addEventListener('click', function () {
    state.editingPeople = false;
    render();
  });

  onEnter(el.newPerson, addPersonFromInput);
  document.getElementById('add-person-btn').addEventListener('click', addPersonFromInput);

  function addPersonFromInput() {
    if (state.locked) return;
    if (C.addPerson(doc(), el.newPerson.value)) {
      el.newPerson.value = '';
      save();
      render();
    }
    el.newPerson.focus();
  }

  // Byt namn när fältet lämnas eller Enter trycks.
  el.peopleList.addEventListener('change', function (event) {
    var input = event.target.closest('.person-name');
    if (!input || state.locked) return;
    var oldName = input.dataset.name;
    var newName = C.cleanName(input.value);
    if (newName === oldName) {
      input.value = oldName;
      return;
    }
    if (C.renamePerson(doc(), oldName, newName)) {
      if (state.filter === oldName) {
        state.filter = newName;
        storeFilter(newName);
      }
      save();
      render();
    } else {
      input.value = oldName; // tomt eller upptaget namn
    }
  });

  el.peopleList.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && event.target.closest('.person-name')) {
      event.preventDefault();
      event.target.blur();
    }
  });

  // Ta bort kräver två tryck; personens uppgifter blir utan person.
  var removeTimer = null;
  el.peopleList.addEventListener('click', function (event) {
    var btn = event.target.closest('.person-remove');
    if (!btn || state.locked) return;
    if (!btn.classList.contains('confirm')) {
      el.peopleList.querySelectorAll('.person-remove.confirm').forEach(resetRemoveButton);
      btn.classList.add('confirm');
      btn.textContent = 'Säker?';
      clearTimeout(removeTimer);
      removeTimer = setTimeout(function () { resetRemoveButton(btn); }, CONFIRM_MS);
      return;
    }
    clearTimeout(removeTimer);
    var name = btn.dataset.name;
    C.removePerson(doc(), name);
    if (state.filter === name) {
      state.filter = null;
      storeFilter(null);
    }
    save();
    render();
  });

  function resetRemoveButton(btn) {
    btn.classList.remove('confirm');
    btn.textContent = 'Ta bort';
  }

  function renderPeoplePanel() {
    el.peoplePanel.hidden = !state.editingPeople;
    if (!state.editingPeople) return;
    var frag = document.createDocumentFragment();
    state.people.forEach(function (name) {
      var li = document.createElement('li');
      li.className = personClass(name);
      var dot = document.createElement('span');
      dot.className = 'dot';
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'person-name';
      input.value = name;
      input.dataset.name = name;
      input.maxLength = 40;
      input.setAttribute('aria-label', 'Namn');
      input.setAttribute('enterkeyhint', 'done');
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'link-btn danger person-remove';
      remove.dataset.name = name;
      remove.textContent = 'Ta bort';
      li.append(dot, input, remove);
      frag.appendChild(li);
    });
    el.peopleList.replaceChildren(frag);
  }

  function render() {
    // Listan ritas om: ett pågående drag släpps (t.ex. när anteckningen ändras utifrån).
    cleanupDrag();
    // Ett sparat filter för en person som inte finns i den här listan gäller inte.
    if (state.note && state.filter && state.people.indexOf(state.filter) < 0) {
      state.filter = null;
    }
    if (state.locked) state.editingPeople = false;
    var visible = state.tasks.filter(isVisible);
    var open = visible.filter(function (t) { return !isDoneInView(t); });
    var done = visible.filter(isDoneInView);
    var hasNote = Boolean(state.note);
    state.openOrder = open;
    // Greppen syns när det finns något att flytta: två uppgifter, eller en med deluppgifter.
    state.sortable = hasNote && !state.locked && (open.length > 1 ||
      (open.length === 1 && visibleSubs(open[0]).some(function (s) { return !s.done; })));

    renderFilters();
    renderPeoplePanel();
    el.input.placeholder = state.filter ? 'Lägg till uppgift för ' + state.filter + '…' : 'Lägg till uppgift…';

    el.input.disabled = !hasNote || state.locked;
    el.addBtn.disabled = !hasNote || state.locked;
    el.form.hidden = state.locked;
    el.lockedBanner.hidden = !state.locked;

    fillList(el.openList, open);
    fillList(el.doneList, done);

    el.empty.hidden = !hasNote || open.length > 0;
    if (state.filter) {
      el.empty.textContent = visible.length ? 'Allt klart för ' + state.filter + '!' : 'Inga uppgifter för ' + state.filter + '.';
    } else {
      el.empty.textContent = state.tasks.length ? 'Allt klart!' : 'Inga uppgifter ännu.';
    }
    el.doneSection.hidden = done.length === 0;
    el.doneTitle.textContent = 'Klara · ' + done.length;
    var clearable = done.some(function (t) { return t.done && !t.recur && ownsTask(t); });
    el.clearDone.disabled = state.locked || !clearable;

    el.counts.textContent = open.length + ' kvar' + (done.length ? ' · ' + done.length + ' klara' : '');
  }

  function fillList(list, tasks) {
    var frag = document.createDocumentFragment();
    tasks.forEach(function (task) {
      frag.appendChild(renderTask(task));
    });
    list.replaceChildren(frag);
  }

  function renderTask(task) {
    var li = el.template.content.firstElementChild.cloneNode(true);
    li.dataset.id = task.id;

    var doneInView = isDoneInView(task);
    var check = li.querySelector('.check');
    check.checked = doneInView;
    check.disabled = state.locked;
    check.setAttribute('aria-label', (doneInView ? 'Markera som ej klar: ' : 'Markera som klar: ') + task.title);

    var body = li.querySelector('.body');
    body.disabled = state.locked || doneInView;
    li.querySelector('.title').textContent = task.title;
    renderMeta(li.querySelector('.meta'), task);
    li.querySelector('.drag-handle').hidden = !state.sortable || doneInView;

    var expanded = state.expandedId === task.id && !doneInView && !state.locked;
    showNote(li, task);
    body.setAttribute('aria-expanded', String(expanded));
    var details = li.querySelector('.details');
    details.hidden = !expanded;

    // Deluppgifter visas under öppna uppgifter; i Klara räcker framstegsräknaren.
    // Återstående deluppgifter överst, klara längst ner (ordningen i texten ändras inte).
    var subs = visibleSubs(task);
    subs = subs.filter(function (s) { return !s.done; }).concat(subs.filter(function (s) { return s.done; }));
    var subList = li.querySelector('.subtasks');
    if (subs.length && !doneInView) {
      subList.hidden = false;
      subs.forEach(function (s) { subList.appendChild(renderSubtask(s)); });
    }

    if (expanded) {
      li.querySelector('.d-title').value = task.title;
      li.querySelector('.d-note').value = task.note || '';
      var whoSelect = li.querySelector('.d-who');
      whoSelect.appendChild(new Option('Ingen', ''));
      whoSelect.appendChild(new Option('Alla', C.EVERYONE));
      state.people.forEach(function (name) {
        whoSelect.appendChild(new Option(name, name));
      });
      whoSelect.value = task.who || '';
      var select = li.querySelector('.d-recur');
      select.appendChild(new Option('Ingen', ''));
      C.RECURRENCES.forEach(function (r) {
        select.appendChild(new Option(r.label, r.key));
      });
      select.value = task.recur || '';
      li.querySelector('.d-due').value = task.due || '';
      li.querySelector('.d-clear-date').disabled = !task.due;
    }
    return li;
  }

  function renderSubtask(sub) {
    var li = el.subTemplate.content.firstElementChild.cloneNode(true);
    li.dataset.id = sub.id;
    if (sub.done) li.classList.add('is-done');
    var check = li.querySelector('.check');
    check.checked = sub.done;
    check.disabled = state.locked;
    check.setAttribute('aria-label', (sub.done ? 'Markera som ej klar: ' : 'Markera som klar: ') + sub.title);
    var body = li.querySelector('.body');
    body.disabled = state.locked || sub.done;
    li.querySelector('.title').textContent = sub.title;
    renderMeta(li.querySelector('.meta'), sub);
    li.querySelector('.drag-handle').hidden = !state.sortable || sub.done;

    var expanded = state.expandedId === sub.id && !sub.done && !state.locked;
    body.setAttribute('aria-expanded', String(expanded));
    li.querySelector('.details').hidden = !expanded;
    showNote(li, sub);
    if (expanded) {
      li.querySelector('.d-title').value = sub.title;
      li.querySelector('.d-note').value = sub.note || '';
      var whoSelect = li.querySelector('.d-who');
      whoSelect.appendChild(new Option('Ingen', ''));
      whoSelect.appendChild(new Option('Alla', C.EVERYONE));
      state.people.forEach(function (name) {
        whoSelect.appendChild(new Option(name, name));
      });
      whoSelect.value = sub.who || '';
    }
    return li;
  }

  function renderMeta(meta, task) {
    var parts = [];
    // Personen visas inte när listan redan är filtrerad på den personen.
    if (task.who && state.filter !== task.who) {
      var who = document.createElement('span');
      who.className = 'who ' + personClass(task.who);
      var dot = document.createElement('span');
      dot.className = 'dot';
      who.appendChild(dot);
      who.appendChild(document.createTextNode(task.who));
      parts.push(who);
    }
    if (task.recur) {
      parts.push(span('↻ ' + C.recurLabel(task.recur), ''));
    }
    if (task.done) {
      var back = C.returnDate(task);
      if (back) parts.push(span('tillbaka ' + lowerFirst(C.formatDate(back, state.today)), ''));
    } else if (task.due) {
      var status = C.dueStatus(task, state.today);
      var label = C.formatDate(task.due, state.today);
      if (status === 'overdue') label = 'Försenad · ' + label;
      parts.push(span(label, status === 'overdue' ? 'overdue' : status === 'today' ? 'today' : ''));
    }
    if (task.subtasks && task.subtasks.length) {
      var pr = C.progress(task);
      parts.push(span(pr.done + '/' + pr.total + ' klara', 'progress'));
    }
    parts.forEach(function (node, i) {
      if (i > 0) meta.appendChild(document.createTextNode(' · '));
      meta.appendChild(node);
    });
  }

  function span(text, cls) {
    var s = document.createElement('span');
    s.textContent = text;
    if (cls) s.className = cls;
    return s;
  }

  function lowerFirst(s) {
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  function findTask(id) {
    if (id == null) return null;
    for (var i = 0; i < state.tasks.length; i++) {
      var t = state.tasks[i];
      if (t.id === id) return t;
      for (var j = 0; j < (t.subtasks || []).length; j++) {
        if (t.subtasks[j].id === id) return t.subtasks[j];
      }
    }
    return null;
  }

  function findParent(id) {
    for (var i = 0; i < state.tasks.length; i++) {
      var subs = state.tasks[i].subtasks || [];
      for (var j = 0; j < subs.length; j++) {
        if (subs[j].id === id) return state.tasks[i];
      }
    }
    return null;
  }

  function setSaveState(label, kind) {
    el.saveState.textContent = label;
    el.saveState.className = 'save-state' + (kind ? ' ' + kind : '');
  }

  render();
})();
