/*
 * NWO (jagemyr) – beställningar i Standard Notes. En anteckning kan hålla flera
 * beställningar, var och en med Företag, en eller flera Varor, Fraktbolag, Beställd,
 * Skickad, Bedömt levdatum och Levererad.
 *
 * Allt sparas som vanlig text i anteckningen: ett block per beställning, en rad per
 * fält, en Vara-rad per vara och en tom rad mellan beställningarna. En levererad vara
 * får ✅ och datum efter namnet; Levererad fylls i när alla varor är levererade.
 *
 *   Företag: Webbutiken
 *   Vara: Skruvdragare ✅ 2026-10-29
 *   Vara: Bitsats
 *   Fraktbolag: PostNord
 *   Trackingnummer: 00370712345678901234
 *   Beställd: 2026-10-27
 *   Skickad:
 *   Bedömt levdatum: 2026-11-03
 *   Redo att hämtas:
 *   Hämtställe:
 *   Levererad:
 *   Kommentar: Returnera om fel storlek
 *
 * Rader som inte är fält (t.ex. något som skrivits i en annan editor) ligger kvar
 * oförändrade: i sin beställning om de står i ett block med fält, annars sist.
 */
(function () {
  'use strict';

  var VERSION = '2.8.0';
  var NOT_CONNECTED_HINT_MS = 2500;
  var CONFIRM_MS = 3000;
  var SETTLE_MS = 700;
  var PREVIEW_LENGTH = 90;
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  var FIELD_LINE = /^\s*([^:]{1,40}?)\s*:(.*)$/;
  // "Skruvdragare ✅ 2026-10-29": bocken och det som står efter den (helst ett datum).
  var DONE_MARK = /\s*✅\s*(.*?)\s*$/;
  // Levererad utan datum (t.ex. bara ✅ skrivet för hand).
  var DONE_NO_DATE = 'ja';

  // Förslag under Fraktbolag. Egna knappar i stället för <datalist>: Safaris förslagsfönster
  // öppnas mitt i tangenttrycket och kan få tangenten att upprepas (PPPP…).
  // Spåra-länken: fraktbolagets egen spårningssida när den är känd, annars 17TRACK, som känner
  // igen de flesta fraktbolag på numret. Fraktbolaget matchas mot det som står i Fraktbolag.
  var TRACKERS = [
    { match: /postnord|posten/i, name: 'PostNord', url: 'https://www.postnord.se/vara-verktyg/spara-brev-paket-och-pall?shipmentId=' },
    { match: /\bdhl\b/i, name: 'DHL', url: 'https://www.dhl.com/se-sv/home/tracking.html?submit=1&tracking-id=' },
    { match: /\bbring\b/i, name: 'Bring', url: 'https://tracking.bring.com/tracking.html?lang=sv&q=' },
    { match: /\bups\b/i, name: 'UPS', url: 'https://www.ups.com/track?loc=en_US&tracknum=' },
    { match: /fedex/i, name: 'FedEx', url: 'https://www.fedex.com/fedextrack/?trknbr=' }
  ];
  var UNIVERSAL_TRACKER = { name: '17TRACK', url: 'https://t.17track.net/en#nums=' };

  var CARRIERS = ['PostNord', 'DHL', 'Budbee', 'Instabox', 'Bring', 'DB Schenker', 'UPS', 'FedEx', 'Airmee', 'Early Bird'];

  // Ordningen här är ordningen i anteckningen. Alias gör att rader skrivna för hand också känns igen.
  var FIELDS = [
    { key: 'foretag', label: 'Företag', aliases: ['foretag', 'företag'] },
    // multi: en rad per vara.
    { key: 'vara', label: 'Vara', multi: true, aliases: ['vara', 'varor'] },
    { key: 'fraktbolag', label: 'Fraktbolag', aliases: ['fraktbolag', 'frakt'] },
    { key: 'tracking', label: 'Trackingnummer', aliases: ['trackingnummer', 'trackingnumber', 'tracking', 'spårningsnummer', 'spårning', 'kollinummer', 'kolli-id', 'sändningsnummer', 'sändnings-id'] },
    { key: 'bestalld', label: 'Beställd', aliases: ['beställd', 'bestalld', 'beställt', 'beställning', 'beställningsdatum', 'orderdatum'] },
    { key: 'skickad', label: 'Skickad', aliases: ['skickad', 'skickat', 'skickades', 'skickat datum', 'avsänd'] },
    // late: ett passerat datum visas i rött (leveransen borde ha kommit).
    { key: 'levdatum', label: 'Bedömt levdatum', late: true, aliases: ['bedömt levdatum', 'bedomt levdatum', 'bedömt leveransdatum', 'levdatum', 'leveransdatum'] },
    // Paketet har kommit till en box eller ett utlämningsställe.
    { key: 'hamtas', label: 'Redo att hämtas', aliases: ['redo att hämtas', 'redo att hamtas', 'kan hämtas', 'att hämta', 'hämtas', 'ankommen', 'ankommet'] },
    { key: 'hamtstalle', label: 'Hämtställe', aliases: ['hämtställe', 'hamtstalle', 'utlämningsställe', 'uthämtningsställe', 'utlämning', 'ombud', 'paketbox', 'box'] },
    { key: 'levererad', label: 'Levererad', aliases: ['levererad', 'levererat', 'mottagen', 'mottaget', 'hämtad', 'hämtat'] },
    // lines: flera rader text, sparade som en Kommentar-rad per rad.
    { key: 'kommentar', label: 'Kommentar', lines: true, aliases: ['kommentar', 'kommentarer', 'anteckning', 'notering', 'not'] }
  ];

  // Statusen i listan visar det senaste steget som är ifyllt (levererad visas för sig).
  var STEPS = [
    { key: 'levdatum', label: 'Lev', preview: 'lev' },
    { key: 'skickad', label: 'Skickad', preview: 'skickad' },
    { key: 'bestalld', label: 'Beställd', preview: 'beställd' }
  ];

  // Kanske: saker man kanske ska beställa, en rad per sak ("Kanske: Vinterdäck").
  var MAYBE_LABEL = 'Kanske';
  var MAYBE_ALIASES = ['kanske', 'att beställa', 'önskelista', 'önskas', 'vill ha'];

  var el = {
    page: document.querySelector('.page'),
    maybeSection: document.getElementById('maybe-section'),
    maybeTitle: document.getElementById('maybe-title'),
    maybeList: document.getElementById('maybe-list'),
    maybeAddRow: document.getElementById('maybe-add'),
    maybeNew: document.getElementById('maybe-new'),
    maybeAddBtn: document.getElementById('maybe-add-btn'),
    maybeTemplate: document.getElementById('maybe-template'),
    notice: document.getElementById('notice'),
    lockedBanner: document.getElementById('locked-banner'),
    orders: document.getElementById('orders'),
    doneSection: document.getElementById('done-section'),
    doneTitle: document.getElementById('done-title'),
    doneList: document.getElementById('done-list'),
    clearDone: document.getElementById('clear-done'),
    addOrder: document.getElementById('add-order'),
    template: document.getElementById('order-template'),
    itemTemplate: document.getElementById('item-template'),
    count: document.getElementById('count'),
    saveState: document.getElementById('save-state')
  };

  var state = {
    connected: false,
    note: null,
    locked: false,
    orders: [],
    // Kanske-listan: text per rad (tomma rader sparas inte).
    maybe: [],
    rest: '',
    expanded: -1,
    confirmIndex: -1,
    confirmClear: false,
    confirmTimer: null,
    // En beställning som just blev levererad står kvar en stund innan den flyttas ner.
    settlingIndex: -1,
    // Pågående drag (se Sortering nedan) eller null.
    drag: null,
    settleTimer: null,
    lastSentText: null,
    // De senaste texterna vi själva har sparat. En sparning kan komma tillbaka från appen
    // efter att man har skrivit vidare, och ska då inte skriva över fälten.
    sentTexts: []
  };

  // ---------- Beställningar ----------

  function emptyOrder() {
    var values = {};
    FIELDS.forEach(function (f) { values[f.key] = f.multi ? [] : ''; });
    return { values: values, extra: [] };
  }

  function emptyItem() {
    return { text: '', done: '' };
  }

  /** Varorna som har text (tomma rader i formuläret sparas inte). */
  function filledItems(order) {
    return order.values.vara.filter(function (item) { return oneLine(item.text); });
  }

  function itemNames(order) {
    return filledItems(order).map(function (item) { return oneLine(item.text); });
  }

  /** En beställning utan något ifyllt sparas inte (den finns bara i formuläret). */
  function hasContent(order) {
    return FIELDS.some(function (f) {
      return f.multi ? filledItems(order).length > 0 : oneLine(order.values[f.key]);
    }) || order.extra.some(function (line) { return line.trim(); });
  }

  /** Levererad: alla varor är bockade, eller (utan varor) Levererad är ifyllt. */
  function isDelivered(order) {
    var items = filledItems(order);
    if (items.length) return items.every(function (item) { return item.done; });
    return Boolean(oneLine(order.values.levererad));
  }

  /** Redo att hämtas: har kommit till en box eller ett utlämningsställe men är inte levererad. */
  function isReady(order) {
    return !isDelivered(order) && Boolean(oneLine(order.values.hamtas));
  }

  /**
   * Läget som styr färgen i listan: grå beställd, blå skickad, grön redo att hämtas.
   * Bedömt levdatum ändrar inte läget. Levererade har ingen färg (de ligger under Levererade).
   */
  function orderState(order) {
    if (isDelivered(order)) return 'delivered';
    if (isReady(order)) return 'ready';
    if (oneLine(order.values.skickad)) return 'shipped';
    if (oneLine(order.values.bestalld)) return 'ordered';
    return '';
  }

  var STATE_CLASSES = ['state-ordered', 'state-shipped', 'state-ready'];

  function deliveredCount(order) {
    return filledItems(order).filter(function (item) { return item.done; }).length;
  }

  /** Håller Levererad i takt med varornas bockar: senaste datumet när alla är levererade. */
  function syncDelivered(order) {
    var items = filledItems(order);
    if (!items.length) return;
    if (!items.every(function (item) { return item.done; })) {
      order.values.levererad = '';
      return;
    }
    var dates = items.map(function (item) { return item.done; }).filter(parseIso).sort();
    order.values.levererad = dates.length ? dates[dates.length - 1] : (oneLine(order.values.levererad) || DONE_NO_DATE);
  }

  /** Efter inläsning: "Levererad: datum" skrivet för hand bockar av varor som saknar bock. */
  function normalize(order) {
    var levererad = oneLine(order.values.levererad);
    var items = filledItems(order);
    if (levererad && items.length && !items.every(function (item) { return item.done; })) {
      items.forEach(function (item) { if (!item.done) item.done = levererad; });
    }
    syncDelivered(order);
  }

  function setDelivered(order, delivered) {
    var items = filledItems(order);
    var today = todayIso();
    if (items.length) {
      items.forEach(function (item) { item.done = delivered ? (item.done || today) : ''; });
      syncDelivered(order);
    } else {
      order.values.levererad = delivered ? today : '';
    }
  }

  /** Rubrik i listan: varorna, annars företaget. */
  function orderTitle(order) {
    return itemNames(order).join(', ') || oneLine(order.values.foretag);
  }

  /** Kort namn i förhandsvisningen: första varan och "+N" för resten. */
  function shortTitle(order) {
    var names = itemNames(order);
    if (!names.length) return oneLine(order.values.foretag);
    return names[0] + (names.length > 1 ? ' +' + (names.length - 1) : '');
  }

  /** Senaste ifyllda steget: { step, value, date } eller null. */
  function latestStep(order) {
    for (var i = 0; i < STEPS.length; i++) {
      var value = oneLine(order.values[STEPS[i].key]);
      if (value) return { step: STEPS[i], value: value, date: parseIso(value) };
    }
    return null;
  }

  // ---------- Textformat ----------

  function fieldByLabel(label) {
    var wanted = label.trim().toLowerCase();
    for (var i = 0; i < FIELDS.length; i++) {
      if (FIELDS[i].aliases.indexOf(wanted) !== -1) return FIELDS[i];
    }
    return null;
  }

  function parseItem(value) {
    var m = DONE_MARK.exec(value);
    if (!m) return { text: value, done: '' };
    return { text: value.slice(0, m.index).trim(), done: m[1] || DONE_NO_DATE };
  }

  function isMaybeLabel(label) {
    return MAYBE_ALIASES.indexOf(label.trim().toLowerCase()) !== -1;
  }

  function parse(text) {
    var orders = [];
    var maybe = [];
    var restBlocks = [];
    var blocks = String(text || '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/);

    blocks.forEach(function (block) {
      var current = null;
      var seen = {};
      var loose = [];

      block.split('\n').forEach(function (line) {
        var m = FIELD_LINE.exec(line);
        // Kanske-rader hör inte till någon beställning, var de än står.
        if (m && isMaybeLabel(m[1])) {
          var wish = m[2].trim();
          if (wish) maybe.push(wish);
          return;
        }
        var field = m && fieldByLabel(m[1]);
        if (!field) {
          if (!line.trim()) return;
          if (current) current.extra.push(line); else loose.push(line);
          return;
        }
        var value = m[2].trim();
        // Samma fält igen utan tom rad emellan: en ny beställning börjar (utom för varor och kommentarer).
        if (current && seen[field.key] && !field.multi && !field.lines) current = null;
        if (!current) {
          current = emptyOrder();
          seen = {};
          orders.push(current);
        }
        seen[field.key] = true;
        if (field.multi) {
          var item = parseItem(value);
          if (item.text || item.done) current.values[field.key].push(item);
        } else if (field.lines) {
          var prev = current.values[field.key];
          if (value) current.values[field.key] = prev ? prev + '\n' + value : value;
        } else {
          current.values[field.key] = value;
        }
      });

      if (loose.length) restBlocks.push(loose.join('\n'));
    });

    orders.forEach(normalize);
    return { orders: orders, maybe: maybe, rest: restBlocks.join('\n\n') };
  }

  function serializeItem(item) {
    var text = oneLine(item.text);
    if (!item.done) return text;
    return text + ' ✅' + (item.done !== DONE_NO_DATE ? ' ' + oneLine(item.done) : '');
  }

  function serialize(orders, rest, maybe) {
    var filled = orders.filter(hasContent);
    var wishes = filledMaybe(maybe);
    // En tom mall sparas så att fälten syns även i andra editorer (inte om det bara finns Kanske).
    if (!filled.length && !wishes.length) filled = [emptyOrder()];
    var blocks = filled.map(function (order) {
      var lines = [];
      FIELDS.forEach(function (f) {
        var values = f.multi ? filledItems(order).map(serializeItem)
          : f.lines ? textLines(order.values[f.key])
          : [oneLine(order.values[f.key])];
        if (!values.length) values = [''];
        values.forEach(function (v) { lines.push(f.label + ':' + (v ? ' ' + v : '')); });
      });
      return lines.concat(order.extra).join('\n');
    });
    if (wishes.length) {
      blocks.push(wishes.map(function (w) { return MAYBE_LABEL + ': ' + w; }).join('\n'));
    }
    if (rest) blocks.push(rest);
    return blocks.join('\n\n');
  }

  /** Raderna i Kanske som har text. */
  function filledMaybe(maybe) {
    return (maybe || state.maybe).map(oneLine).filter(Boolean);
  }

  /** Raderna i ett flerradigt fält, utan tomma rader. */
  function textLines(value) {
    return String(value || '').split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
  }

  function oneLine(value) {
    return String(value || '').replace(/\s*\n\s*/g, ' ').trim();
  }

  /**
   * Förhandsvisningen i anteckningslistan.
   * En beställning: "Skruvdragare +1 · Webbutiken · PostNord · lev 3 nov".
   * Flera: "1 att hämta, 1 på väg, 1 levererad: Skruvdragare +1 (att hämta), Vinterjacka (lev 3 nov)".
   * Kanske läggs till sist ("· 3 kanske"), eller visas ensam ("Kanske: Vinterdäck, Lampa").
   */
  function preview(orders) {
    var wishes = filledMaybe();
    var base = previewOrders(orders);
    if (!wishes.length) return truncate(base);
    if (!base) return truncate(MAYBE_LABEL + ': ' + wishes.join(', '));
    var suffix = ' · ' + wishes.length + ' kanske';
    return truncate(base, PREVIEW_LENGTH - suffix.length) + suffix;
  }

  function previewOrders(orders) {
    var filled = orders.filter(hasContent);
    if (!filled.length) return '';
    if (filled.length === 1) {
      var o = filled[0];
      var itemText = itemNames(o).length ? shortTitle(o) : '';
      var parts = [itemText, o.values.foretag, o.values.fraktbolag].map(oneLine).filter(Boolean);
      var s = stepText(o);
      if (s) parts.push(s);
      return parts.join(' · ');
    }
    var active = filled.filter(function (order) { return !isDelivered(order); });
    if (!active.length) return 'Alla ' + filled.length + ' levererade';
    // Det som kan hämtas står först.
    active.sort(function (a, b) { return Number(isReady(b)) - Number(isReady(a)); });
    return countText(filled, ', ') + ': ' + active.map(function (order) {
      var title = shortTitle(order) || 'Beställning';
      var s = stepText(order);
      return s ? title + ' (' + s + ')' : title;
    }).join(', ');
  }

  /** "1 att hämta, 2 på väg, 1 levererad" – bara de delar som finns. */
  function countText(filled, separator) {
    var ready = filled.filter(isReady).length;
    var done = filled.filter(isDelivered).length;
    var onTheWay = filled.length - ready - done;
    var parts = [];
    if (ready) parts.push(ready + ' att hämta');
    if (onTheWay) parts.push(onTheWay + ' på väg');
    if (done) parts.push(done + (done === 1 ? ' levererad' : ' levererade'));
    return parts.join(separator);
  }

  function stepText(order) {
    if (isDelivered(order)) {
      var date = parseIso(order.values.levererad);
      return 'levererad' + (date ? ' ' + shortDate(date) : '');
    }
    if (isReady(order)) {
      var place = oneLine(order.values.hamtstalle);
      return 'att hämta' + (place ? ' ' + place : '');
    }
    var latest = latestStep(order);
    if (!latest) return '';
    return latest.step.preview + ' ' + (latest.date ? shortDate(latest.date) : latest.value);
  }

  function truncate(text, max) {
    max = max || PREVIEW_LENGTH;
    return text.length > max ? text.slice(0, max - 1).trim() + '…' : text;
  }

  // ---------- Datum ----------

  /** "2026-11-03" → { y, m, d } eller null om det inte är ett riktigt datum. */
  function parseIso(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
    return { y: y, m: mo, d: d };
  }

  function daysFromToday(date) {
    var now = new Date();
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((Date.UTC(date.y, date.m - 1, date.d) - today) / 86400000);
  }

  function longDate(date) {
    var js = new Date(date.y, date.m - 1, date.d);
    var opts = { weekday: 'long', day: 'numeric', month: 'long' };
    if (date.y !== new Date().getFullYear()) opts.year = 'numeric';
    var text;
    try {
      text = js.toLocaleDateString('sv-SE', opts);
    } catch (e) {
      text = date.d + ' ' + MONTHS[date.m - 1] + ' ' + date.y;
    }
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function shortDate(date) {
    var text = date.d + ' ' + MONTHS[date.m - 1];
    return date.y !== new Date().getFullYear() ? text + ' ' + date.y : text;
  }

  function todayIso() {
    var now = new Date();
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function relative(days) {
    if (days === 0) return 'idag';
    if (days === 1) return 'imorgon';
    if (days === -1) return 'igår';
    if (days > 1) return 'om ' + days + ' dagar';
    return 'för ' + (-days) + ' dagar sedan';
  }

  /** Klass för ett levdatum: rött om det har passerat, blått idag och imorgon. */
  function lateClass(days) {
    if (days < 0) return 'late';
    if (days <= 1) return 'soon';
    return '';
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
      'Fel: ' + (diagInfo.errors.length ? diagInfo.errors.join(' | ') : 'inga')
    ].join('\n');
  }

  // ---------- Anslutning ----------

  // Versionen längst ner till höger, så att man ser vilken version varje enhet kör.
  document.getElementById('version').textContent = 'v' + VERSION;

  var relay = new ComponentRelay({
    targetWindow: window,
    options: { coallesedSaving: true, coallesedSavingDelay: 250 },
    onReady: function () {
      state.connected = true;
      el.notice.hidden = true;
      setSaveState('', '');
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
      state.sentTexts = [];
      resetConfirm();
      stopSettling();
      setSaveState('', '');
    }

    var textChanged = false;
    if (!note.isMetadataUpdate || isNewNote) {
      var incoming = (note.content && note.content.text) || '';
      // Vår egen sparning som kommer tillbaka ska inte skriva över det man håller på att skriva.
      var isEcho = !isNewNote && (state.sentTexts.indexOf(incoming) !== -1 || incoming === serialize(state.orders, state.rest, state.maybe));
      if (!isEcho) {
        // Ändring utifrån mitt i ett drag: släpp draget, listan ritas om nedan.
        cancelDrag();
        var parsed = parse(incoming);
        state.orders = parsed.orders;
        state.maybe = parsed.maybe;
        state.rest = parsed.rest;
        ensureOrder();
        stopSettling();
        // En ensam beställning visas utfälld; flera visas som en lista.
        if (isNewNote || state.expanded >= state.orders.length) {
          state.expanded = state.orders.length === 1 ? 0 : -1;
        }
        textChanged = true;
      }
    }

    if (isNewNote || textChanged || wasLocked !== state.locked) {
      render();
      if (isNewNote) el.page.scrollTop = 0;
    }
  });

  function isLocked(note) {
    // Egen uppslagning: relayens getItemAppDataValue kraschar om domänen saknas i appData.
    var appData = note.content && note.content.appData;
    var sn = appData && appData['org.standardnotes.sn'];
    return Boolean(sn && sn.locked);
  }

  function editable() {
    return Boolean(state.note) && !state.locked;
  }

  /** Utan beställningar och utan något i Kanske visas en tom beställning att fylla i. */
  function ensureOrder() {
    if (state.orders.length || filledMaybe().length) return;
    state.orders.push(emptyOrder());
    state.expanded = 0;
  }

  // ---------- Till Standard Notes ----------

  function save() {
    if (!editable()) return;
    var note = state.note;
    var text = serialize(state.orders, state.rest, state.maybe);
    var previewText = preview(state.orders);
    setSaveState('Sparar…', '');
    relay.saveItemWithPresave(note, function () {
      note.content.text = text;
      note.content.preview_plain = previewText;
      note.content.preview_html = null;
      state.lastSentText = text;
      state.sentTexts.push(text);
      if (state.sentTexts.length > 20) state.sentTexts.shift();
    }, function () {
      if (state.note && state.note.uuid === note.uuid) {
        setSaveState('Sparat', 'saved');
      }
    });
  }

  // ---------- Händelser ----------

  function orderIndex(target) {
    var card = target.closest('.order');
    return card ? Number(card.getAttribute('data-index')) : -1;
  }

  function itemIndex(target) {
    var row = target.closest('.item');
    return row ? Array.prototype.indexOf.call(row.parentNode.children, row) : -1;
  }

  function cardFor(index) {
    return document.querySelector('.order[data-index="' + index + '"]');
  }

  /**
   * Inmatning ritar bara om det som ändras (rubrik, räknare, datumrad, förslag),
   * inte hela kortet, så att inget i fältet man skriver i rörs.
   */
  function onInput(event) {
    var input = event.target;
    var isField = input.tagName === 'INPUT' || input.tagName === 'TEXTAREA';
    if (!isField || input.type === 'checkbox' || !editable()) return;
    var card = input.closest('.order');
    var order = state.orders[orderIndex(input)];
    if (!order) return;

    if (input.classList.contains('item-input')) {
      var item = order.values.vara[itemIndex(input)];
      if (!item || item.text === input.value) return;
      item.text = input.value;
      // En vara utan text kan inte vara levererad.
      if (!oneLine(item.text)) item.done = '';
      syncDelivered(order);
      renderItemControls(card, order, true);
    } else {
      var key = input.getAttribute('data-key');
      if (!key || order.values[key] === input.value) return;
      order.values[key] = input.value;
      if (input.type === 'date') {
        renderDateBlock(card.querySelector('[data-date-field="' + key + '"]'), order, true);
      }
      if (key === 'fraktbolag') renderCarriers(card, order, true);
      if (key === 'fraktbolag' || key === 'tracking') renderTrackLinks(card, order);
      if (input.tagName === 'TEXTAREA') autoGrow(input);
    }
    renderSummary(card, order, true);
    renderCount();
    save();
  }

  /** Bockarna: en vara, eller hela beställningen. */
  function onCheck(event) {
    var box = event.target;
    if (box.type !== 'checkbox') return;
    var index = orderIndex(box);
    var order = state.orders[index];
    if (!order || !editable()) { render(); return; }
    var wasDelivered = isDelivered(order);

    if (box.classList.contains('item-check')) {
      var item = order.values.vara[itemIndex(box)];
      if (!item) return;
      item.done = box.checked ? todayIso() : '';
      syncDelivered(order);
    } else if (box.classList.contains('order-check')) {
      setDelivered(order, !wasDelivered);
    }

    var nowDelivered = isDelivered(order);
    if (nowDelivered && !wasDelivered) settle(index);
    render();
    save();
  }

  el.page.addEventListener('input', onInput);
  el.page.addEventListener('change', function (event) {
    if (event.target.type === 'checkbox') onCheck(event); else onInput(event);
  });

  el.page.addEventListener('click', function (event) {
    var index = orderIndex(event.target);
    if (index < 0) return;

    if (event.target.closest('.summary')) {
      toggle(index);
      return;
    }

    var button = event.target.closest('[data-action], [data-carrier]');
    if (!button) return;
    var action = button.getAttribute('data-action');

    if (action === 'collapse') {
      state.expanded = -1;
      resetConfirm();
      render();
      return;
    }
    if (!editable()) return;
    var order = state.orders[index];
    var card = cardFor(index);

    if (button.hasAttribute('data-carrier')) {
      order.values.fraktbolag = button.getAttribute('data-carrier');
      render();
      save();
    } else if (action === 'today' || action === 'clear') {
      var key = button.closest('[data-date-field]').getAttribute('data-date-field');
      order.values[key] = action === 'today' ? todayIso() : '';
      render();
      save();
    } else if (action === 'add-item') {
      var items = order.values.vara;
      // Återanvänd en tom sista rad i stället för att lägga till en till.
      if (!items.length || oneLine(items[items.length - 1].text)) items.push(emptyItem());
      renderItems(card, order, true, items.length - 1);
    } else if (action === 'remove-item') {
      var i = itemIndex(button);
      if (i < 0) return;
      order.values.vara.splice(i, 1);
      syncDelivered(order);
      render();
      save();
    } else if (action === 'remove') {
      removeOrder(index);
    }
  });

  el.page.addEventListener('keydown', function (event) {
    var input = event.target;
    if (event.key !== 'Enter' || input.tagName !== 'INPUT' || input.type === 'date' || input.type === 'checkbox') return;
    var card = input.closest('.order');
    if (!card) return;
    event.preventDefault();

    // Enter på en vara med text ger en ny rad under; Enter på en tom rad går vidare till Fraktbolag.
    if (input.classList.contains('item-input') && editable()) {
      var order = state.orders[orderIndex(input)];
      var i = itemIndex(input);
      if (!oneLine(input.value)) {
        card.querySelector('[data-key="fraktbolag"]').focus();
        return;
      }
      var next = order.values.vara[i + 1];
      if (!next || oneLine(next.text)) order.values.vara.splice(i + 1, 0, emptyItem());
      renderItems(card, order, true, i + 1);
      return;
    }

    // Annars: nästa fält i samma beställning (ingen <form>, se README).
    var all = Array.prototype.slice.call(card.querySelectorAll('.details input:not([type="checkbox"])'));
    var following = all[all.indexOf(input) + 1];
    if (following) following.focus(); else input.blur();
  });

  el.addOrder.addEventListener('click', function () {
    if (!editable()) return;
    // Återanvänd en tom beställning i stället för att lägga till en till.
    var emptyIndex = -1;
    state.orders.forEach(function (order, i) { if (!hasContent(order)) emptyIndex = i; });
    if (emptyIndex < 0) {
      state.orders.push(emptyOrder());
      emptyIndex = state.orders.length - 1;
    }
    state.expanded = emptyIndex;
    resetConfirm();
    render();
    var card = cardFor(emptyIndex);
    scrollIntoView(card);
    card.querySelector('[data-key="foretag"]').focus();
  });

  /** Rensa: tar bort alla levererade beställningar, efter ett andra tryck. */
  el.clearDone.addEventListener('click', function () {
    if (!editable()) return;
    if (!state.confirmClear) {
      resetConfirm();
      state.confirmClear = true;
      state.confirmTimer = setTimeout(function () { resetConfirm(); render(); }, CONFIRM_MS);
      render();
      return;
    }
    resetConfirm();
    stopSettling();
    state.orders = state.orders.filter(function (order) { return !(hasContent(order) && isDelivered(order)); });
    state.expanded = -1;
    ensureOrder();
    render();
    save();
  });

  // ---------- Kanske ----------

  function maybeIndex(target) {
    var row = target.closest('.maybe');
    return row ? Array.prototype.indexOf.call(el.maybeList.children, row) : -1;
  }

  function addMaybe() {
    if (!editable()) return;
    var text = oneLine(el.maybeNew.value);
    if (!text) return;
    state.maybe.push(text);
    el.maybeNew.value = '';
    render();
    save();
    el.maybeNew.focus();
  }

  el.maybeAddBtn.addEventListener('click', addMaybe);

  el.maybeNew.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addMaybe();
  });

  el.maybeList.addEventListener('input', function (event) {
    if (!event.target.classList.contains('maybe-input') || !editable()) return;
    var i = maybeIndex(event.target);
    if (i < 0 || state.maybe[i] === event.target.value) return;
    state.maybe[i] = event.target.value;
    renderMaybeControls(editable());
    renderCount();
    save();
  });

  // Enter i en befintlig rad hoppar ner till raden för nya saker.
  el.maybeList.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' || !event.target.classList.contains('maybe-input')) return;
    event.preventDefault();
    el.maybeNew.focus();
  });

  el.maybeList.addEventListener('click', function (event) {
    if (!editable()) return;
    var i = maybeIndex(event.target);
    if (i < 0) return;
    if (event.target.closest('.maybe-order')) {
      orderMaybe(i);
    } else if (event.target.closest('.maybe-remove')) {
      state.maybe.splice(i, 1);
      ensureOrder();
      render();
      save();
    }
  });

  /** Beställ: raden blir en ny beställning med varan och dagens datum som Beställd. */
  function orderMaybe(i) {
    var text = oneLine(state.maybe[i]);
    if (!text) return;
    state.maybe.splice(i, 1);
    // Återanvänd en tom beställning om det finns en.
    var index = -1;
    state.orders.forEach(function (order, k) { if (!hasContent(order)) index = k; });
    if (index < 0) {
      state.orders.push(emptyOrder());
      index = state.orders.length - 1;
    }
    var order = state.orders[index];
    order.values.vara = [{ text: text, done: '' }];
    order.values.bestalld = todayIso();
    state.expanded = index;
    resetConfirm();
    render();
    save();
    var card = cardFor(index);
    scrollIntoView(card);
    card.querySelector('[data-key="foretag"]').focus();
  }

  // ---------- Sortering: dra i greppet, eller pil upp och ner när greppet har fokus ----------
  //
  // Pointer events i stället för HTML5 drag-and-drop, som inte fungerar med fingret i iOS.
  // Korten flyttas bara inom sin egen lista (På väg eller Levererade). Ordningen är
  // ordningen i anteckningens text och sparas som vanligt.

  var DRAG_THRESHOLD = 4;
  var AUTOSCROLL_EDGE = 60;
  var AUTOSCROLL_SPEED = 16;

  el.page.addEventListener('pointerdown', function (event) {
    var handle = event.target.closest('.drag-handle');
    // Inte medan en nyss levererad beställning är på väg ner (listan ritas om strax).
    if (!handle || state.drag || state.settlingIndex >= 0 || !editable()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    var card = handle.closest('.order');
    var list = card.parentNode;
    var cards = Array.prototype.slice.call(list.children);
    if (cards.length < 2) return;
    event.preventDefault();

    var scroll = el.page.scrollTop;
    var gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    var from = cards.indexOf(card);
    state.drag = {
      pointerId: event.pointerId,
      handle: handle,
      card: card,
      cards: cards,
      from: from,
      to: from,
      startY: event.clientY,
      lastY: event.clientY,
      startScroll: scroll,
      moved: false,
      // Lägena räknas i sidans innehåll (inte i fönstret), så att autoskroll inte rubbar dem.
      slots: cards.map(function (c) {
        var r = c.getBoundingClientRect();
        return { top: r.top + scroll, height: r.height };
      }),
      // Så långt de andra korten flyttar sig för att ge plats.
      step: card.getBoundingClientRect().height + gap,
      raf: 0
    };
    try { handle.setPointerCapture(event.pointerId); } catch (e) { /* äldre webbläsare */ }
    resetConfirm();
    document.body.classList.add('is-dragging');
    card.classList.add('dragging');
    state.drag.raf = requestAnimationFrame(autoScroll);
  });

  document.addEventListener('pointermove', function (event) {
    var d = state.drag;
    if (!d || event.pointerId !== d.pointerId) return;
    event.preventDefault();
    d.lastY = event.clientY;
    if (Math.abs(d.lastY - d.startY) > DRAG_THRESHOLD) d.moved = true;
    layoutDrag();
  });

  document.addEventListener('pointerup', function (event) { finishDrag(event, false); });
  document.addEventListener('pointercancel', function (event) { finishDrag(event, true); });

  /** Flyttar kortet efter pekaren och låter de andra glida undan. */
  function layoutDrag() {
    var d = state.drag;
    var slots = d.slots;
    var first = slots[0];
    var last = slots[slots.length - 1];
    var own = slots[d.from];
    var dy = d.lastY - d.startY + (el.page.scrollTop - d.startScroll);
    // Inte längre upp än första platsen eller längre ner än sista.
    dy = Math.max(first.top - own.top, Math.min(last.top + last.height - own.top - own.height, dy));

    // Nedåt byter kortet plats när underkanten passerar mitten på nästa kort, uppåt när
    // överkanten gör det. Då fungerar det även med ett högt, utfällt kort.
    var top = own.top + dy;
    var bottom = top + own.height;
    var to = d.from;
    slots.forEach(function (s, i) {
      var mid = s.top + s.height / 2;
      if (i > d.from && bottom > mid) to = i;
      if (i < d.from && top < mid && to >= d.from) to = i;
    });
    d.to = to;

    d.card.style.transform = 'translateY(' + dy + 'px)';
    d.cards.forEach(function (c, i) {
      if (i === d.from) return;
      var shift = 0;
      if (i > d.from && i <= to) shift = -d.step;
      if (i < d.from && i >= to) shift = d.step;
      c.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
    });
  }

  /** Skrollar sidan när man drar nära över- eller underkanten. */
  function autoScroll() {
    var d = state.drag;
    if (!d) return;
    if (d.moved) {
      var rect = el.page.getBoundingClientRect();
      var speed = 0;
      if (d.lastY < rect.top + AUTOSCROLL_EDGE) {
        speed = -AUTOSCROLL_SPEED * Math.min(1, (rect.top + AUTOSCROLL_EDGE - d.lastY) / AUTOSCROLL_EDGE);
      } else if (d.lastY > rect.bottom - AUTOSCROLL_EDGE) {
        speed = AUTOSCROLL_SPEED * Math.min(1, (d.lastY - rect.bottom + AUTOSCROLL_EDGE) / AUTOSCROLL_EDGE);
      }
      if (speed) {
        var before = el.page.scrollTop;
        el.page.scrollTop = before + speed;
        if (el.page.scrollTop !== before) layoutDrag();
      }
    }
    d.raf = requestAnimationFrame(autoScroll);
  }

  function finishDrag(event, cancelled) {
    var d = state.drag;
    if (!d || (event && event.pointerId !== d.pointerId)) return;
    state.drag = null;
    cancelAnimationFrame(d.raf);
    try { d.handle.releasePointerCapture(d.pointerId); } catch (e) { /* redan släppt */ }
    document.body.classList.remove('is-dragging');
    d.card.classList.remove('dragging');
    d.cards.forEach(function (c) { c.style.transform = ''; });
    if (cancelled || d.to === d.from) return;
    var indices = d.cards.map(function (c) { return Number(c.getAttribute('data-index')); });
    moveWithin(indices, d.from, d.to);
  }

  /** Avbryter ett pågående drag utan att flytta något (t.ex. när anteckningen ändras utifrån). */
  function cancelDrag() {
    if (state.drag) finishDrag(null, true);
  }

  // Tangentbord: pil upp och ner flyttar beställningen ett steg när greppet har fokus.
  el.page.addEventListener('keydown', function (event) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    var handle = event.target.closest && event.target.closest('.drag-handle');
    if (!handle || state.drag || !editable()) return;
    event.preventDefault();
    var card = handle.closest('.order');
    var list = card.parentNode;
    var cards = Array.prototype.slice.call(list.children);
    var from = cards.indexOf(card);
    var to = from + (event.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= cards.length) return;
    var indices = cards.map(function (c) { return Number(c.getAttribute('data-index')); });
    var newIndex = moveWithin(indices, from, to);
    var moved = list.querySelector('.order[data-index="' + newIndex + '"] .drag-handle');
    if (moved) moved.focus();
  });

  /**
   * Flyttar kortet på plats `from` till plats `to` i en lista. `indices` är listans
   * beställningar (index i state.orders, i visningsordning). Beställningarna i den andra
   * listan står kvar där de är. Returnerar den flyttade beställningens nya index.
   */
  function moveWithin(indices, from, to) {
    var sequence = indices.slice();
    var moved = sequence.splice(from, 1)[0];
    sequence.splice(to, 0, moved);
    var slots = indices.slice().sort(function (a, b) { return a - b; });
    var old = state.orders.slice();
    var newIndexOf = {};
    slots.forEach(function (slot, k) {
      state.orders[slot] = old[sequence[k]];
      newIndexOf[sequence[k]] = slot;
    });
    if (Object.prototype.hasOwnProperty.call(newIndexOf, state.expanded)) {
      state.expanded = newIndexOf[state.expanded];
    }
    resetConfirm();
    stopSettling();
    // Bygg om korten så att varje kort hör ihop med rätt beställning.
    el.orders.removeAttribute('data-signature');
    el.doneList.removeAttribute('data-signature');
    render();
    save();
    return newIndexOf[moved];
  }

  // Uppdatera "om N dagar" när man kommer tillbaka till appen en annan dag.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !state.drag) render();
  });

  function toggle(index) {
    state.expanded = state.expanded === index ? -1 : index;
    resetConfirm();
    render();
    if (state.expanded === index) scrollIntoView(cardFor(index));
  }

  /** Låt en nyss levererad beställning stå kvar en stund, fäll ihop den och flytta ner den. */
  function settle(index) {
    stopSettling();
    state.settlingIndex = index;
    state.settleTimer = setTimeout(function () {
      state.settlingIndex = -1;
      state.settleTimer = null;
      var order = state.orders[index];
      if (state.expanded === index && order && isDelivered(order)) state.expanded = -1;
      render();
    }, SETTLE_MS);
  }

  function stopSettling() {
    clearTimeout(state.settleTimer);
    state.settleTimer = null;
    state.settlingIndex = -1;
  }

  /** Första trycket frågar, andra tar bort. En tom beställning tas bort direkt. */
  function removeOrder(index) {
    var order = state.orders[index];
    if (hasContent(order) && state.confirmIndex !== index) {
      resetConfirm();
      state.confirmIndex = index;
      state.confirmTimer = setTimeout(function () { resetConfirm(); render(); }, CONFIRM_MS);
      render();
      return;
    }
    resetConfirm();
    stopSettling();
    state.orders.splice(index, 1);
    if (state.expanded === index) state.expanded = -1;
    else if (state.expanded > index) state.expanded--;
    ensureOrder();
    render();
    save();
  }

  function resetConfirm() {
    clearTimeout(state.confirmTimer);
    state.confirmTimer = null;
    state.confirmIndex = -1;
    state.confirmClear = false;
  }

  function scrollIntoView(node) {
    if (!node) return;
    try { node.scrollIntoView({ block: 'nearest' }); } catch (e) { node.scrollIntoView(false); }
  }

  // ---------- Rendering ----------

  /** Ritar båda listorna: på väg överst, levererade under rubriken Levererade. */
  function render() {
    var canEdit = editable();
    el.lockedBanner.hidden = !state.locked;

    var active = [];
    var done = [];
    state.orders.forEach(function (order, i) {
      var inDone = hasContent(order) && isDelivered(order) && i !== state.settlingIndex;
      (inDone ? done : active).push(i);
    });

    syncList(el.orders, active, canEdit);
    syncList(el.doneList, done, canEdit);

    el.doneSection.hidden = !done.length;
    el.doneTitle.textContent = 'Levererade (' + done.length + ')';
    el.clearDone.hidden = !canEdit;
    el.clearDone.textContent = state.confirmClear ? 'Tryck igen för att rensa' : 'Rensa';
    el.clearDone.classList.toggle('confirm', state.confirmClear);

    el.addOrder.hidden = !canEdit;
    renderMaybe(canEdit);
    renderCount();
  }

  /** Kanske-listan. Raderna byggs bara om när antalet ändras, så att fokus och markör står kvar. */
  function renderMaybe(canEdit) {
    var list = el.maybeList;
    if (list.children.length !== state.maybe.length) {
      list.textContent = '';
      state.maybe.forEach(function () {
        list.appendChild(el.maybeTemplate.content.firstElementChild.cloneNode(true));
      });
    }
    Array.prototype.forEach.call(list.children, function (row, i) {
      var input = row.querySelector('.maybe-input');
      if (input.value !== state.maybe[i]) input.value = state.maybe[i];
      setFlag(input, 'disabled', !state.note);
      setFlag(input, 'readOnly', state.locked);
    });
    renderMaybeControls(canEdit);
    // Utan något i listan visas Kanske bara när man kan lägga till.
    el.maybeSection.hidden = !state.note || (!canEdit && !filledMaybe().length);
    el.maybeAddRow.hidden = !canEdit;
  }

  /** Knapparna och antalet i rubriken (ändras när man skriver, utan att raderna byggs om). */
  function renderMaybeControls(canEdit) {
    Array.prototype.forEach.call(el.maybeList.children, function (row, i) {
      var hasText = Boolean(oneLine(state.maybe[i]));
      row.querySelector('.maybe-order').hidden = !canEdit || !hasText;
      row.querySelector('.maybe-remove').hidden = !canEdit;
    });
    var count = filledMaybe().length;
    el.maybeTitle.textContent = count ? MAYBE_LABEL + ' (' + count + ')' : MAYBE_LABEL;
  }

  /** Korten byggs bara om när listans sammansättning ändras, så att fokus och markör står kvar. */
  function syncList(list, indices, canEdit) {
    var signature = indices.join(',');
    if (list.getAttribute('data-signature') !== signature) {
      list.setAttribute('data-signature', signature);
      list.textContent = '';
      indices.forEach(function (i) {
        var card = el.template.content.firstElementChild.cloneNode(true);
        card.setAttribute('data-index', String(i));
        list.appendChild(card);
      });
    }
    // Greppet syns bara när det finns något att sortera.
    var sortable = canEdit && list.children.length > 1;
    Array.prototype.forEach.call(list.children, function (card) {
      var i = Number(card.getAttribute('data-index'));
      renderCard(card, state.orders[i], i, canEdit);
      card.classList.toggle('sortable', sortable);
      card.querySelector('.drag-handle').hidden = !sortable;
    });
  }

  function renderCount() {
    var filled = state.orders.filter(hasContent);
    var doneCount = filled.filter(isDelivered).length;
    var readyCount = filled.filter(isReady).length;
    var maybeCount = filledMaybe().length;
    var text;
    if (!filled.length && maybeCount) {
      text = '';
    } else if (!doneCount && !readyCount) {
      text = filled.length === 1 ? '1 beställning' : filled.length + ' beställningar';
    } else if (doneCount === filled.length) {
      text = doneCount === 1 ? '1 levererad' : 'Alla ' + doneCount + ' levererade';
    } else {
      text = countText(filled, ' · ');
    }
    if (maybeCount) text = (text ? text + ' · ' : '') + maybeCount + ' kanske';
    el.count.textContent = text;
  }

  function renderCard(card, order, index, canEdit) {
    var expanded = state.expanded === index;
    card.classList.toggle('expanded', expanded);
    card.classList.toggle('completing', state.settlingIndex === index);
    card.querySelector('.summary').setAttribute('aria-expanded', String(expanded));
    card.querySelector('.details').hidden = !expanded;
    renderSummary(card, order, canEdit);

    Array.prototype.forEach.call(card.querySelectorAll('input[data-key], textarea[data-key]'), function (input) {
      var value = order.values[input.getAttribute('data-key')] || '';
      if (input.type === 'date') {
        // Datumväljaren kan bara visa ÅÅÅÅ-MM-DD; annan text står kvar i anteckningen och visas under fältet.
        var iso = parseIso(value) ? value : '';
        if (input.value !== iso) input.value = iso;
        setFlag(input, 'disabled', !canEdit);
        input.classList.toggle('empty', !iso);
      } else {
        if (input.value !== value) input.value = value;
        setFlag(input, 'disabled', !state.note);
        setFlag(input, 'readOnly', state.locked);
        if (input.tagName === 'TEXTAREA' && expanded) autoGrow(input);
      }
    });

    renderItems(card, order, canEdit);
    renderCarriers(card, order, canEdit);
    renderTrackLinks(card, order);
    Array.prototype.forEach.call(card.querySelectorAll('[data-date-field]'), function (block) {
      renderDateBlock(block, order, canEdit);
    });
    renderDeliveredNote(card, order);

    var remove = card.querySelector('[data-action="remove"]');
    var confirming = state.confirmIndex === index;
    remove.hidden = !canEdit;
    remove.textContent = confirming ? 'Tryck igen för att ta bort' : 'Ta bort beställning';
    remove.classList.toggle('confirm', confirming);
  }

  /** Sätter en egenskap bara när den faktiskt ändras. */
  function setFlag(node, name, value) {
    if (node[name] !== value) node[name] = value;
  }

  /** Bock, rubrik, undertext och status i den ihopfällda raden. */
  function renderSummary(card, order, canEdit) {
    var delivered = isDelivered(order);
    var total = filledItems(order).length;
    var doneItems = deliveredCount(order);
    var stateClass = 'state-' + orderState(order);
    STATE_CLASSES.forEach(function (cls) { card.classList.toggle(cls, cls === stateClass); });

    var check = card.querySelector('.order-check');
    setFlag(check, 'checked', delivered);
    setFlag(check, 'indeterminate', !delivered && doneItems > 0);
    setFlag(check, 'disabled', !canEdit || !hasContent(order));

    var title = card.querySelector('.s-title');
    var text = orderTitle(order);
    title.textContent = text || 'Ny beställning';
    title.classList.toggle('placeholder', !text);

    var place = oneLine(order.values.hamtstalle);
    var meta = [total ? oneLine(order.values.foretag) : '', oneLine(order.values.fraktbolag)];
    // Var paketet ska hämtas är det viktigaste när det väntar, så det står först.
    if (place) {
      if (isReady(order)) meta.unshift(place); else meta.push(place);
    }
    if (!delivered && doneItems > 0) meta.push(doneItems + ' av ' + total + ' levererade');
    card.querySelector('.s-meta').textContent = meta.filter(Boolean).join(' · ');
    // Kommentarens första rad syns i den ihopfällda raden.
    var comment = textLines(order.values.kommentar);
    var note = card.querySelector('.s-note');
    note.textContent = comment.length ? comment[0] + (comment.length > 1 ? ' …' : '') : '';
    renderStatus(card, order, delivered);
  }

  /** Kommentarsfältet växer med texten i stället för att få en egen rullist. */
  function autoGrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 2 + 'px';
  }

  function renderStatus(card, order, delivered) {
    var top = card.querySelector('.s-top');
    var bottom = card.querySelector('.s-bottom');
    top.textContent = '';
    bottom.textContent = '';
    top.className = 's-top';
    bottom.className = 's-bottom';

    if (delivered) {
      var date = parseIso(order.values.levererad);
      top.textContent = 'Levererad';
      bottom.textContent = date ? shortDate(date) : '';
      bottom.classList.add('ok');
      return;
    }

    if (isReady(order)) {
      var since = parseIso(order.values.hamtas);
      top.textContent = 'Redo att hämtas';
      bottom.textContent = since ? relative(daysFromToday(since)) : oneLine(order.values.hamtas);
      return;
    }

    var latest = latestStep(order);
    if (!latest) return;
    if (!latest.date) {
      top.textContent = latest.step.label;
      bottom.textContent = latest.value;
    } else if (latest.step.key === 'levdatum') {
      var days = daysFromToday(latest.date);
      top.textContent = latest.step.label + ' ' + shortDate(latest.date);
      bottom.textContent = relative(days);
      var cls = lateClass(days);
      if (cls) bottom.classList.add(cls);
    } else {
      top.textContent = latest.step.label;
      bottom.textContent = shortDate(latest.date);
    }
  }

  /** Varuraderna i ett kort. Raderna byggs bara om när antalet ändras. */
  function renderItems(card, order, canEdit, focusIndex) {
    var items = order.values.vara;
    if (!items.length) items.push(emptyItem());
    var list = card.querySelector('.items');

    if (list.children.length !== items.length) {
      list.textContent = '';
      items.forEach(function () {
        list.appendChild(el.itemTemplate.content.firstElementChild.cloneNode(true));
      });
    }

    Array.prototype.forEach.call(list.children, function (row, i) {
      var input = row.querySelector('.item-input');
      if (input.value !== items[i].text) input.value = items[i].text;
      setFlag(input, 'disabled', !state.note);
      setFlag(input, 'readOnly', state.locked);
      input.setAttribute('aria-label', 'Vara ' + (i + 1));
    });
    renderItemControls(card, order, canEdit);

    if (typeof focusIndex === 'number' && list.children[focusIndex]) {
      list.children[focusIndex].querySelector('.item-input').focus();
    }
  }

  /** Bockarna, kryssen, "Lägg till vara" och antalet i rubriken. */
  function renderItemControls(card, order, canEdit) {
    var items = order.values.vara;
    var list = card.querySelector('.items');
    Array.prototype.forEach.call(list.children, function (row, i) {
      var item = items[i];
      var hasText = Boolean(item && oneLine(item.text));
      var check = row.querySelector('.item-check');
      setFlag(check, 'checked', Boolean(item && item.done));
      // En tom rad kan inte bockas av.
      setFlag(check, 'disabled', !canEdit || !hasText);
      check.setAttribute('aria-label', hasText ? 'Levererad: ' + oneLine(item.text) : 'Levererad');
      row.classList.toggle('is-done', Boolean(item && item.done));
      // Den enda raden går inte att ta bort så länge den är tom.
      row.querySelector('.item-remove').hidden = !canEdit || (items.length === 1 && !hasText);
    });
    var count = filledItems(order).length;
    card.querySelector('.items-label').textContent = count > 1 ? 'Varor (' + count + ')' : 'Varor';
    card.querySelector('[data-action="add-item"]').hidden = !canEdit;
  }

  /** Förslag på fraktbolag: alla när fältet är tomt, annars de som börjar på det man skrivit. */
  /** Spåra-länkarna: fraktbolagets sida (om den är känd) och 17TRACK. Syns när det finns ett nummer. */
  function renderTrackLinks(card, order) {
    var box = card.querySelector('.track-links');
    // Mellanslag följer ofta med när man kopierar ett nummer; de ska inte med i länken.
    var number = oneLine(order.values.tracking).replace(/\s+/g, '');
    box.hidden = !number;
    if (!number) return;
    var carrier = oneLine(order.values.fraktbolag);
    var tracker = TRACKERS.filter(function (t) { return t.match.test(carrier); })[0];
    var main = box.querySelector('.track-link');
    var alt = box.querySelector('.track-alt');
    var primary = tracker || UNIVERSAL_TRACKER;
    main.textContent = 'Spåra hos ' + primary.name + ' ↗';
    main.href = primary.url + encodeURIComponent(number);
    // 17TRACK som reserv bredvid fraktbolagets egen länk.
    alt.hidden = !tracker;
    alt.href = UNIVERSAL_TRACKER.url + encodeURIComponent(number);
  }

  function renderCarriers(card, order, canEdit) {
    var box = card.querySelector('.carriers');
    var typed = oneLine(order.values.fraktbolag).toLowerCase();
    var names = !canEdit ? [] : CARRIERS.filter(function (name) {
      var lower = name.toLowerCase();
      return !typed || (lower.indexOf(typed) === 0 && lower !== typed);
    });
    var key = names.join('|');
    if (box.getAttribute('data-shown') === key) return;
    box.setAttribute('data-shown', key);
    box.textContent = '';
    names.forEach(function (name) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'carrier';
      chip.setAttribute('data-carrier', name);
      chip.textContent = name;
      box.appendChild(chip);
    });
  }

  function renderDateBlock(block, order, canEdit) {
    var key = block.getAttribute('data-date-field');
    var field = FIELDS.filter(function (f) { return f.key === key; })[0];
    var value = order.values[key] || '';
    var date = parseIso(value);
    var today = block.querySelector('[data-action="today"]');
    var when = block.querySelector('.when');
    var input = block.querySelector('input');

    input.classList.toggle('empty', !input.value);
    block.querySelector('[data-action="clear"]').hidden = !value || !canEdit;
    if (today) today.hidden = Boolean(value) || !canEdit;

    when.textContent = '';
    when.hidden = !value;
    if (!value) return;
    if (!date) {
      when.textContent = 'I anteckningen står: ' + value;
      return;
    }
    var days = daysFromToday(date);
    var rel = document.createElement('span');
    rel.textContent = relative(days);
    // Ett levdatum är bara försenat så länge beställningen inte har kommit.
    if (field && field.late && !isDelivered(order) && !isReady(order)) rel.className = lateClass(days);
    when.appendChild(document.createTextNode(longDate(date) + ' · '));
    when.appendChild(rel);
  }

  function renderDeliveredNote(card, order) {
    var note = card.querySelector('.delivered-note');
    var delivered = hasContent(order) && isDelivered(order);
    note.hidden = !delivered;
    if (!delivered) return;
    var date = parseIso(order.values.levererad);
    note.textContent = date ? 'Levererad ' + longDate(date).toLowerCase() : 'Levererad';
  }

  function setSaveState(label, kind) {
    el.saveState.textContent = label;
    el.saveState.className = 'save-state' + (kind ? ' ' + kind : '');
  }
})();
