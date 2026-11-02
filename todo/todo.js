/*
 * Todo (jagemyr) – gränssnittet. All logik för text, datum och upprepning finns i core.js.
 *
 * - Avbockade uppgifter stryks över och flyttas till "Klara" längst ner.
 * - Återkommande uppgifter står överstrukna tills nästa datum och kommer då tillbaka oavbockade.
 * - Allt sparas som vanlig text i anteckningen, en uppgift per rad.
 */
(function () {
  'use strict';

  var VERSION = '1.6.0';
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
    einkToggle: document.getElementById('eink-toggle')
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
    editingPeople: false
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
    // Ett sparat filter för en person som inte finns i den här listan gäller inte.
    if (state.note && state.filter && state.people.indexOf(state.filter) < 0) {
      state.filter = null;
    }
    if (state.locked) state.editingPeople = false;
    var visible = state.tasks.filter(isVisible);
    var open = visible.filter(function (t) { return !isDoneInView(t); });
    var done = visible.filter(isDoneInView);
    var hasNote = Boolean(state.note);

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
