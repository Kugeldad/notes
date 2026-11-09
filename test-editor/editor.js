/*
 * Testeditor (kugeldad) – en minimal editor för Standard Notes.
 *
 * Flöde:
 *  1. ComponentRelay sköter handskakningen med appen (postMessage).
 *  2. streamContextItem tar emot den öppna anteckningen och varje ändring av den.
 *  3. Vid inmatning sparas texten tillbaka med saveItemWithPresave (debouncad).
 */
(function () {
  'use strict';

  var PREVIEW_LENGTH = 90;
  var NOT_CONNECTED_HINT_MS = 2500;

  var textarea = document.getElementById('editor');
  var countsEl = document.getElementById('counts');
  var saveStateEl = document.getElementById('save-state');
  var lockEl = document.getElementById('lock');
  var noticeEl = document.getElementById('notice');

  var currentNote = null;
  var lastSentText = null;
  var connected = false;

  var relay = new ComponentRelay({
    targetWindow: window,
    options: {
      coallesedSaving: true,
      coallesedSavingDelay: 250
    },
    onReady: function () {
      connected = true;
      noticeEl.hidden = true;
      setSaveState('Ansluten', '');
    }
  });

  // Visa en förklaring om sidan öppnas direkt i en webbläsare.
  setTimeout(function () {
    if (!connected) {
      noticeEl.hidden = false;
      setSaveState('Ej ansluten', 'error');
    }
  }, NOT_CONNECTED_HINT_MS);

  relay.streamContextItem(function (note) {
    var isNewNote = !currentNote || currentNote.uuid !== note.uuid;
    currentNote = note;

    if (isNewNote) {
      lastSentText = null;
    }

    applyLockState(note);
    applySpellcheck(note);

    // Metadata-uppdateringar (fäst, arkiverad o.s.v.) rör inte texten.
    if (note.isMetadataUpdate) {
      return;
    }

    var incoming = (note.content && note.content.text) || '';

    if (isNewNote) {
      textarea.value = incoming;
      textarea.scrollTop = 0;
      textarea.setSelectionRange(0, 0);
      setSaveState('', '');
    } else if (incoming !== textarea.value && incoming !== lastSentText) {
      // Ändring utifrån, t.ex. synk från en annan enhet eller återställd historik.
      replaceKeepingCaret(incoming);
    }
    // Om incoming === lastSentText är det vår egen sparning som kommer tillbaka;
    // då har användaren ofta skrivit vidare och texten ska inte skrivas över.

    updateCounts();
  });

  textarea.addEventListener('input', function () {
    updateCounts();
    if (!currentNote || textarea.readOnly) {
      return;
    }

    var note = currentNote;
    var text = textarea.value;
    setSaveState('Sparar…', 'saving');

    relay.saveItemWithPresave(note, function () {
      note.content.text = text;
      note.content.preview_plain = makePreview(text);
      note.content.preview_html = null;
      lastSentText = text;
    }, function () {
      if (currentNote && currentNote.uuid === note.uuid) {
        setSaveState('Sparat', 'saved');
      }
    });
  });

  // Tab skriver ett tabbtecken i stället för att flytta fokus.
  textarea.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (textarea.readOnly) {
      return;
    }
    event.preventDefault();
    textarea.setRangeText('\t', textarea.selectionStart, textarea.selectionEnd, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });

  function applyLockState(note) {
    // Egen uppslagning: relayens getItemAppDataValue kraschar om domänen saknas i appData.
    var appData = note.content && note.content.appData;
    var sn = appData && appData['org.standardnotes.sn'];
    var locked = Boolean(sn && sn.locked);
    textarea.disabled = false;
    textarea.readOnly = locked;
    lockEl.hidden = !locked;
  }

  function applySpellcheck(note) {
    var spellcheck = note.content && note.content.spellcheck;
    textarea.spellcheck = spellcheck !== false;
  }

  function replaceKeepingCaret(text) {
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var scroll = textarea.scrollTop;
    textarea.value = text;
    var max = text.length;
    textarea.setSelectionRange(Math.min(start, max), Math.min(end, max));
    textarea.scrollTop = scroll;
  }

  function updateCounts() {
    var text = textarea.value;
    var words = text.trim() ? text.trim().split(/\s+/).length : 0;
    var chars = Array.from(text).length;
    countsEl.textContent = formatNumber(words) + ' ord · ' + formatNumber(chars) + ' tecken';
  }

  function makePreview(text) {
    return text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH);
  }

  function formatNumber(n) {
    try {
      return n.toLocaleString('sv-SE');
    } catch (e) {
      return String(n);
    }
  }

  function setSaveState(label, kind) {
    saveStateEl.textContent = label;
    saveStateEl.className = 'save-state' + (kind ? ' ' + kind : '');
  }
})();
