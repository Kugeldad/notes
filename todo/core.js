/*
 * Todo (kugeldad) – logik utan gränssnitt: läsa/skriva anteckningens text,
 * datum och upprepning. Fungerar både i webbläsaren (window.TodoCore) och i Node (tester).
 *
 * Textformat, en uppgift per rad (läsbart även i vanliga editorn):
 *   - [ ] Köp mjölk
 *   - [ ] Ta ut soporna 🔁 varje vecka 📅 2026-10-20
 *   - [x] Ring tandläkaren ✅ 2026-10-18
 *   - [ ] Städa rummet 👤 Son 🔁 varje vecka
 *
 * Egna namn på personerna står på en egen rad överst, t.ex. "👥 Anna, Bo".
 * Deluppgifter är indragna rader under sin huvuduppgift:
 *   - [ ] Städdag 🔁 varje vecka
 *     - [ ] Dammsuga 👤 Son
 *     - [x] Handla 👤 Pappa ✅ 2026-10-18
 *
 * Noteringar är rader som börjar med ">" direkt under uppgiften (eller deluppgiften):
 *   - [ ] Boka tid hos tandläkaren
 *     > Ring före kl 12.
 *     > Kom ihåg försäkringskortet.
 */
(function (root) {
  'use strict';

  var RECURRENCES = [
    { key: 'dagligen', label: 'Dagligen' },
    { key: 'vardagar', label: 'Vardagar' },
    { key: 'varje vecka', label: 'Varje vecka' },
    { key: 'varannan vecka', label: 'Varannan vecka' },
    { key: 'varje månad', label: 'Varje månad' },
    { key: 'varje år', label: 'Varje år' }
  ];

  // Standardpersoner. Egna namn läggs in i editorn och sparas i anteckningen
  // (krypterad i Standard Notes), aldrig i koden.
  var DEFAULT_PEOPLE = ['Pappa', 'Mamma', 'Dotter', 'Son'];

  // Särskilt värde: uppgiften gäller hela familjen och syns i allas filter.
  var EVERYONE = 'Alla';

  function isEveryone(name) {
    return String(name || '').trim().toLowerCase() === EVERYONE.toLowerCase();
  }

  var WEEKDAYS = ['sön', 'mån', 'tis', 'ons', 'tors', 'fre', 'lör'];
  var MONTHS = ['jan', 'feb', 'mars', 'apr', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec'];

  var TASK_RE = /^\s*[-*+]\s+\[( |x|X)\]\s?(.*)$/;
  var BULLET_RE = /^\s*[-*+]\s+(.*)$/;
  var RECUR_RE = /\s*🔁\s*(dagligen|vardagar|varje vecka|varannan vecka|varje månad|varje år)/i;
  var DUE_RE = /\s*📅\s*(\d{4}-\d{2}-\d{2})/;
  var DONE_RE = /\s*✅\s*(\d{4}-\d{2}-\d{2})/;
  // Namnet sträcker sig fram till nästa markering eller radens slut.
  var WHO_RE = /\s*👤\s*(.*?)\s*(?=🔁|📅|✅|👤|$)/u;
  var PEOPLE_LINE_RE = /^\s*👥\s*(.*)$/u;

  // ---------- Personer ----------

  function cleanName(name) {
    return String(name || '')
      .replace(/[,👤👥🔁📅✅]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findPerson(list, name) {
    var lower = cleanName(name).toLowerCase();
    for (var i = 0; i < list.length; i++) {
      if (list[i].toLowerCase() === lower) return list[i];
    }
    return null;
  }

  function splitPeople(s) {
    var out = [];
    String(s || '').split(',').forEach(function (part) {
      var n = cleanName(part);
      if (n && !isEveryone(n) && !findPerson(out, n)) out.push(n);
    });
    return out;
  }

  function samePeople(a, b) {
    return a.length === b.length && a.every(function (n, i) { return n === b[i]; });
  }

  /** Alla uppgifter inklusive deluppgifter. */
  function eachTask(tasks, fn) {
    tasks.forEach(function (t) {
      fn(t, null);
      (t.subtasks || []).forEach(function (s) { fn(s, t); });
    });
  }

  function addPerson(doc, name) {
    var n = cleanName(name);
    if (!n || isEveryone(n) || findPerson(doc.people, n)) return false;
    doc.people.push(n);
    return true;
  }

  /** Byter namn och uppdaterar alla uppgifter med det gamla namnet. */
  function renamePerson(doc, oldName, newName) {
    var n = cleanName(newName);
    var i = doc.people.indexOf(oldName);
    if (i < 0 || !n || isEveryone(n)) return false;
    var clash = findPerson(doc.people, n);
    if (clash && clash !== oldName) return false;
    doc.people[i] = n;
    eachTask(doc.tasks, function (t) {
      if (t.who === oldName) t.who = n;
    });
    return true;
  }

  /** Tar bort personen; dennes uppgifter blir utan person. */
  function removePerson(doc, name) {
    var i = doc.people.indexOf(name);
    if (i < 0) return false;
    doc.people.splice(i, 1);
    eachTask(doc.tasks, function (t) {
      if (t.who === name) t.who = null;
    });
    return true;
  }

  // ---------- Datum (lokal tid, format ÅÅÅÅ-MM-DD) ----------

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function toIso(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function fromIso(iso) {
    var p = iso.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function today(now) {
    return toIso(now || new Date());
  }

  function addMonths(d, n) {
    var day = d.getDate();
    var r = new Date(d.getFullYear(), d.getMonth() + n, 1);
    var last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
    r.setDate(Math.min(day, last));
    return r;
  }

  function daysBetween(fromIsoDate, toIsoDate) {
    var a = fromIso(fromIsoDate);
    var b = fromIso(toIsoDate);
    return Math.round((b - a) / 86400000);
  }

  /** Nästa datum efter iso enligt upprepningsregeln. */
  function advance(iso, recur) {
    var d = fromIso(iso);
    switch (recur) {
      case 'dagligen':
        d.setDate(d.getDate() + 1);
        break;
      case 'vardagar':
        do {
          d.setDate(d.getDate() + 1);
        } while (d.getDay() === 0 || d.getDay() === 6);
        break;
      case 'varje vecka':
        d.setDate(d.getDate() + 7);
        break;
      case 'varannan vecka':
        d.setDate(d.getDate() + 14);
        break;
      case 'varje månad':
        d = addMonths(d, 1);
        break;
      case 'varje år':
        d = addMonths(d, 12);
        break;
      default:
        return null;
    }
    return toIso(d);
  }

  // ---------- Läsa och skriva text ----------

  function parseLines(lines) {
    var tasks = [];
    var parent = null;
    var parentIndent = 0;
    var last = null;
    lines.forEach(function (line) {
      if (!line.trim()) {
        return;
      }
      // Notering: "> text" hör till senaste uppgiften/deluppgiften.
      var nm = /^\s*>\s?(.*)$/.exec(line);
      if (nm && last) {
        last.note = last.note === null ? nm[1] : last.note + '\n' + nm[1];
        return;
      }
      // Rad med större indrag än huvuduppgiften = deluppgift (bara en nivå; djupare plattas ut).
      var indent = line.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
      var indented = parent !== null && indent > parentIndent;
      var done = false;
      var rest;
      var m = TASK_RE.exec(line);
      if (m) {
        done = m[1] !== ' ';
        rest = m[2];
      } else {
        var b = BULLET_RE.exec(line);
        rest = b ? b[1] : line.trim();
      }

      var recur = null;
      var due = null;
      var doneDate = null;
      var who = null;
      var r;
      if ((r = WHO_RE.exec(rest))) {
        who = cleanName(r[1]) || null;
        rest = rest.replace(WHO_RE, ' ');
      }
      if ((r = RECUR_RE.exec(rest))) {
        recur = r[1].toLowerCase();
        rest = rest.replace(RECUR_RE, '');
      }
      if ((r = DUE_RE.exec(rest))) {
        due = r[1];
        rest = rest.replace(DUE_RE, '');
      }
      if ((r = DONE_RE.exec(rest))) {
        doneDate = r[1];
        rest = rest.replace(DONE_RE, '');
      }

      var title = rest.trim();
      if (!title) {
        return;
      }
      var task = { title: title, done: done, who: who, recur: recur, due: due, doneDate: done ? doneDate : null, note: null };
      if (indented) {
        parent.subtasks.push(task);
      } else {
        task.subtasks = [];
        tasks.push(task);
        parent = task;
        parentIndent = indent;
      }
      last = task;
    });
    // Tomma rader i slutet av en notering är ingen text.
    tasks.forEach(function (t) {
      [t].concat(t.subtasks).forEach(function (x) {
        if (x.note !== null) x.note = x.note.replace(/\s+$/, '') || null;
      });
    });
    return tasks;
  }

  /**
   * Hela anteckningen: en valfri personrad ("👥 Namn, Namn") och uppgifterna.
   * Utan personrad används standardpersonerna.
   */
  function parseDocument(text) {
    var people = null;
    var lines = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var m = PEOPLE_LINE_RE.exec(line);
      if (m && people === null) {
        people = splitPeople(m[1]);
        return;
      }
      lines.push(line);
    });
    var list = people || DEFAULT_PEOPLE.slice();
    var tasks = parseLines(lines);
    // Namn som används i uppgifter men saknas i listan läggs till, så att inget försvinner.
    eachTask(tasks, function (t) {
      if (!t.who) return;
      if (isEveryone(t.who)) {
        t.who = EVERYONE;
        return;
      }
      var known = findPerson(list, t.who);
      if (known) t.who = known;
      else list.push(t.who);
    });
    return { people: list, tasks: tasks };
  }

  function parse(text) {
    return parseDocument(text).tasks;
  }

  function serializeLine(t, indent) {
    var line = indent + '- [' + (t.done ? 'x' : ' ') + '] ' + t.title.replace(/\s*\n\s*/g, ' ').trim();
    if (t.who) line += ' 👤 ' + t.who;
    if (t.recur) line += ' 🔁 ' + t.recur;
    if (t.due) line += ' 📅 ' + t.due;
    if (t.done && t.doneDate) line += ' ✅ ' + t.doneDate;
    return line;
  }

  function serializeNote(t, indent) {
    if (!t.note || !String(t.note).trim()) return [];
    return String(t.note).replace(/\s+$/, '').split(/\r?\n/).map(function (l) {
      return indent + '>' + (l ? ' ' + l : '');
    });
  }

  function serializeTask(t) {
    var lines = [serializeLine(t, '')].concat(serializeNote(t, '  '));
    (t.subtasks || []).forEach(function (s) {
      lines.push(serializeLine(s, '  '));
      lines = lines.concat(serializeNote(s, '    '));
    });
    return lines.join('\n');
  }

  function serialize(tasks) {
    return tasks.map(serializeTask).join('\n');
  }

  function serializeDocument(doc) {
    var lines = [];
    if (!samePeople(doc.people, DEFAULT_PEOPLE)) {
      lines.push('👥 ' + doc.people.join(', '));
    }
    return lines.concat(doc.tasks.map(serializeTask)).join('\n');
  }

  // ---------- Avbockning och återkommande ----------

  function complete(task, todayIso) {
    task.done = true;
    task.doneDate = todayIso;
  }

  function uncomplete(task) {
    task.done = false;
    task.doneDate = null;
  }

  /** Bocka av huvuduppgift: alla deluppgifter bockas av också. */
  function completeTree(task, todayIso) {
    complete(task, todayIso);
    (task.subtasks || []).forEach(function (s) {
      if (!s.done) complete(s, todayIso);
    });
  }

  /** Bocka ur huvuduppgift: deluppgifterna öppnas igen. */
  function uncompleteTree(task) {
    uncomplete(task);
    (task.subtasks || []).forEach(uncomplete);
  }

  /** Huvuduppgiften är klar exakt när alla deluppgifter är klara. Returnerar true om den ändrades. */
  function syncParent(task, todayIso) {
    var subs = task.subtasks || [];
    if (!subs.length) return false;
    var allDone = subs.every(function (s) { return s.done; });
    if (allDone && !task.done) {
      complete(task, todayIso);
      return true;
    }
    if (!allDone && task.done) {
      uncomplete(task);
      return true;
    }
    return false;
  }

  function progress(task) {
    var subs = task.subtasks || [];
    return { done: subs.filter(function (s) { return s.done; }).length, total: subs.length };
  }

  /**
   * Datum då en avbockad återkommande uppgift kommer tillbaka:
   * första förekomsten efter avbockningsdagen, räknat från uppgiftens datum.
   */
  function returnDate(task) {
    if (!task.recur || !task.done) {
      return null;
    }
    var doneOn = task.doneDate || task.due;
    if (!doneOn) {
      return null;
    }
    var next = advance(task.due || doneOn, task.recur);
    var guard = 0;
    while (next <= doneOn && guard < 5000) {
      next = advance(next, task.recur);
      guard++;
    }
    return next;
  }

  /** Öppnar återkommande uppgifter vars nästa datum har kommit. Returnerar true om något ändrades. */
  function rollover(tasks, todayIso) {
    var changed = false;
    tasks.forEach(function (t) {
      var back = returnDate(t);
      if (back && back <= todayIso) {
        // Hoppa fram till senaste förekomsten fram till idag, så att en lång
        // frånvaro inte ger en uppgift som varit förfallen i månader.
        var guard = 0;
        var next = advance(back, t.recur);
        while (next <= todayIso && guard < 5000) {
          back = next;
          next = advance(back, t.recur);
          guard++;
        }
        t.done = false;
        t.doneDate = null;
        t.due = back;
        // En återkommande huvuduppgift börjar om: alla deluppgifter öppnas.
        (t.subtasks || []).forEach(uncomplete);
        changed = true;
      }
    });
    return changed;
  }

  // ---------- Text för visning ----------

  function recurLabel(key) {
    for (var i = 0; i < RECURRENCES.length; i++) {
      if (RECURRENCES[i].key === key) return RECURRENCES[i].label;
    }
    return key;
  }

  function formatDate(iso, todayIso) {
    var diff = daysBetween(todayIso, iso);
    if (diff === 0) return 'Idag';
    if (diff === 1) return 'Imorgon';
    if (diff === -1) return 'Igår';
    var d = fromIso(iso);
    var s = WEEKDAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    if (d.getFullYear() !== fromIso(todayIso).getFullYear()) {
      s += ' ' + d.getFullYear();
    }
    return s;
  }

  /** 'overdue' | 'today' | 'upcoming' | null */
  function dueStatus(task, todayIso) {
    if (task.done || !task.due) return null;
    if (task.due < todayIso) return 'overdue';
    if (task.due === todayIso) return 'today';
    return 'upcoming';
  }

  function preview(tasks) {
    var open = tasks.filter(function (t) { return !t.done; });
    var head = open.length + ' kvar';
    if (!open.length) {
      return tasks.length ? 'Allt klart' : 'Tom lista';
    }
    var titles = open.slice(0, 3).map(function (t) { return t.title; }).join(', ');
    return (head + ': ' + titles).slice(0, 90);
  }

  var api = {
    RECURRENCES: RECURRENCES,
    DEFAULT_PEOPLE: DEFAULT_PEOPLE,
    EVERYONE: EVERYONE,
    parseDocument: parseDocument,
    serializeDocument: serializeDocument,
    cleanName: cleanName,
    addPerson: addPerson,
    renamePerson: renamePerson,
    removePerson: removePerson,
    parse: parse,
    serialize: serialize,
    complete: complete,
    uncomplete: uncomplete,
    completeTree: completeTree,
    uncompleteTree: uncompleteTree,
    syncParent: syncParent,
    progress: progress,
    eachTask: eachTask,
    returnDate: returnDate,
    rollover: rollover,
    advance: advance,
    today: today,
    formatDate: formatDate,
    recurLabel: recurLabel,
    dueStatus: dueStatus,
    preview: preview
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TodoCore = api;
  }
})(typeof self !== 'undefined' ? self : this);
