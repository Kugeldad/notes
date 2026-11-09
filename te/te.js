/*
 * Tea (kugeldad) – teer i Standard Notes. En anteckning håller en lista med teer, var och
 * ett med Type, Name, Temperature, Brew time (vanlig bryggning), Country, Shop, Taste, om
 * teet passar för gong fu och om det behöver fyllas på. Gränssnittet och texten är på
 * engelska; äldre text med svenska fältnamn, sorter, länder och smakord läses in och skrivs
 * om till engelska (se toEnglish).
 *
 * Allt sparas som vanlig text i anteckningen: ett block per te, en rad per fält och en
 * tom rad mellan teerna. Ordningen i texten är den ordning teerna lades till; i appen
 * grupperas de per sort och sorteras på namn.
 *
 *   Type: Oolong
 *   Name: Dong Ding
 *   Temperature: 95
 *   Brew time: 2-3
 *   Country: Taiwan
 *   Shop: In the Mood for Tea
 *   Taste: honey, floral
 *   Gong fu: yes
 *   Refill:
 *   Untried:
 *
 * Rader som inte är fält (t.ex. något som skrivits i en annan editor) ligger kvar
 * oförändrade: i sitt te om de står i ett block med fält, annars sist.
 *
 * Timern (längst ner) följer gong fu-schemat eller teets bryggtid och sparar inget.
 */
(function () {
  'use strict';

  var VERSION = '2.3.0';

  // Fristående läge: i Te-appen för Android (som ger window.TeNative) eller med ?standalone=1.
  // Då finns ingen Standard Notes: teerna sparas i appen, och Text-panelen flyttar texten
  // mellan appen och Standard Notes.
  var NATIVE = window.TeNative || null;
  var STANDALONE = Boolean(NATIVE) || /[?&]standalone=1(?:&|$)/.test(location.search);
  var TEXT_KEY = 'se.jagemyr.te.text';
  var NOT_CONNECTED_HINT_MS = 2500;
  var CONFIRM_MS = 3000;
  var PREVIEW_LENGTH = 90;
  var FIELD_LINE = /^\s*([^:]{1,40}?)\s*:(.*)$/;
  // "ja", "x", "✅" med mera räknas som ja; allt annat (även tomt och "nej") som nej.
  var YES = /^\s*(ja|j|yes|y|x|✓|✔|✔️|✅|1|true|sant)(?=$|[\s,.!])/i;
  // En ren siffra eller ett spann ("95", "80-85") får °C eller min efter sig i listan.
  var PLAIN_NUMBER = /^\d{1,3}(?:[.,]\d)?(?:\s*[-–—]\s*\d{1,3}(?:[.,]\d)?)?$/;

  // Filtret sparas per enhet, som i Todo.
  var FILTER_KEY = 'se.jagemyr.te.filter';
  var GONGFU_KEY = 'se.jagemyr.te.gongfu';
  var REFILL_KEY = 'se.jagemyr.te.fyllpa';
  // Untried-filtret: '1' = bara oprovade (Untried), 'tried' = bara provade (Tried), tomt = alla.
  var UNTRIED_KEY = 'se.jagemyr.te.untried';
  var NO_SORT = 'none';

  // Sorterna i den ordning grupperna visas. Alias gör att andra stavningar hamnar i rätt grupp
  // (texten i anteckningen ändras inte, utom svenska namn som blir engelska). Färgen är kanten
  // till vänster och pricken i rubriken. id är gruppens nyckel (och sparas i filtret).
  var SORTS = [
    { id: 'green', label: 'Green', color: '#4f9a3a', aliases: ['green', 'green tea', 'lü cha', 'lu cha'], sv: ['grönt', 'grön', 'gröna', 'grönt te'] },
    { id: 'white', label: 'White', color: '#a39b86', aliases: ['white', 'white tea', 'bai cha'], sv: ['vitt', 'vit', 'vitt te'] },
    { id: 'yellow', label: 'Yellow', color: '#cfa21d', aliases: ['yellow', 'yellow tea', 'huang cha'], sv: ['gult', 'gul', 'gult te'] },
    { id: 'oolong', label: 'Oolong', color: '#c47a1f', aliases: ['oolong', 'wulong', 'wu long', 'oolong tea', 'qing cha'], sv: ['oolong te'] },
    { id: 'black', label: 'Black', color: '#a43c2a', aliases: ['black', 'black tea', 'hong cha', 'red tea'], sv: ['svart', 'svart te'] },
    { id: 'puerh', label: 'Pu-erh', color: '#7a4a28', aliases: ['pu-erh', 'puerh', 'pu erh', 'pu\'er', 'puer', 'pu-er', 'sheng', 'shou', 'sheng puerh', 'shou puerh'], sv: [] },
    { id: 'dark', label: 'Dark', color: '#5c4434', aliases: ['dark', 'dark tea', 'hei cha', 'heicha'], sv: ['mörkt', 'mörk', 'mörkt te'] },
    { id: 'matcha', label: 'Matcha', color: '#62a82f', aliases: ['matcha'], sv: [] },
    { id: 'herbal', label: 'Herbal', color: '#8a6fb5', aliases: ['herbal', 'herbal tea', 'tisane', 'herbs'], sv: ['örtte', 'örter', 'ört'] },
    { id: 'rooibos', label: 'Rooibos', color: '#c0502e', aliases: ['rooibos', 'redbush'], sv: ['rotbusch'] }
  ];
  // Svenska sortnamn känns också igen (och skrivs om till engelska när teet läses in).
  SORTS.forEach(function (sort) { sort.aliases = sort.aliases.concat(sort.sv); });

  // Förslag under fälten. Egna knappar i stället för <datalist> (se README).
  var TEMPS = ['70', '75', '80', '85', '90', '95', '100'];
  var TIMES = ['1', '2', '2-3', '3', '3-4', '4', '5'];
  // Smakord: ett tryck lägger till ordet i Smak, ett till tar bort det.
  var TASTES = ['floral', 'fruity', 'citrus', 'honey', 'sweet', 'nutty', 'roasted', 'smoky', 'malty',
    'earthy', 'woody', 'grassy', 'mineral', 'spicy'];
  var COUNTRIES = ['China', 'Taiwan', 'Japan', 'India', 'Sri Lanka', 'Nepal', 'Korea', 'Vietnam', 'Kenya'];

  // Svenska smakord och länder i äldre text, översatta när teet läses in. Ord som inte finns
  // här står kvar som de är.
  var TASTES_SV = {
    'blommig': 'floral', 'blommor': 'flowers', 'fruktig': 'fruity', 'honung': 'honey', 'honungssöt': 'honey',
    'söt': 'sweet', 'sötma': 'sweetness', 'nötig': 'nutty', 'rostad': 'roasted', 'rökig': 'smoky', 'maltig': 'malty',
    'jordig': 'earthy', 'träig': 'woody', 'gräsig': 'grassy', 'mineralisk': 'mineral', 'mineralrik': 'mineral',
    'kryddig': 'spicy', 'grön': 'green', 'marin': 'marine', 'tropisk': 'tropical', 'skogsbotten': 'forest floor',
    'bark': 'bark', 'krämig': 'creamy', 'gräddig': 'creamy', 'persika': 'peach', 'mörk frukt': 'dark fruit',
    'muskot': 'nutmeg', 'muskatell': 'muscatel', 'syrlig': 'tart', 'färsk frukt': 'fresh fruit',
    'torkad frukt': 'dried fruit', 'vanilj': 'vanilla', 'kanel': 'cinnamon', 'choklad': 'chocolate',
    'mörk choklad': 'dark chocolate', 'kakao': 'cocoa', 'karamell': 'caramel', 'kola': 'toffee', 'smörig': 'buttery',
    'smör': 'butter', 'mjölkig': 'milky', 'läder': 'leather', 'tobak': 'tobacco', 'aprikos': 'apricot',
    'plommon': 'plum', 'körsbär': 'cherry', 'äpple': 'apple', 'päron': 'pear', 'melon': 'melon',
    'honungsmelon': 'honeydew', 'ananas': 'pineapple', 'litchi': 'lychee', 'bär': 'berries', 'russin': 'raisin',
    'dadel': 'date', 'dadlar': 'dates', 'fikon': 'fig', 'apelsin': 'orange', 'citron': 'lemon', 'bergamott': 'bergamot',
    'jasmin': 'jasmine', 'orkidé': 'orchid', 'ros': 'rose', 'lavendel': 'lavender', 'hö': 'hay', 'halm': 'straw',
    'spenat': 'spinach', 'sparris': 'asparagus', 'ärtor': 'peas', 'grönsaker': 'vegetal', 'vegetabilisk': 'vegetal',
    'tång': 'seaweed', 'sjögräs': 'seaweed', 'salt': 'salty', 'saltig': 'salty', 'bitter': 'bitter',
    'besk': 'bitter', 'sträv': 'astringent', 'torr': 'dry', 'fyllig': 'full-bodied', 'lätt': 'light', 'mjuk': 'smooth',
    'len': 'silky', 'silkeslen': 'silky', 'fräsch': 'fresh', 'frisk': 'fresh', 'ren': 'clean', 'djup': 'deep',
    'kraftig': 'strong', 'rund': 'round', 'komplex': 'complex', 'kamfer': 'camphor', 'mint': 'mint',
    'mynta': 'mint', 'pepparmynta': 'peppermint', 'pepprig': 'peppery', 'ingefära': 'ginger', 'lakrits': 'liquorice',
    'anis': 'anise', 'kamomill': 'chamomile', 'ängsblommor': 'meadow flowers', 'örtig': 'herbal', 'kådig': 'resinous',
    'tall': 'pine', 'ceder': 'cedar', 'mossa': 'moss', 'mossig': 'mossy', 'svamp': 'mushroom', 'skog': 'forest',
    'källare': 'cellar', 'brödig': 'bready', 'bröd': 'bread', 'kex': 'biscuit', 'spannmål': 'grain',
    'rostat ris': 'roasted rice', 'kastanj': 'chestnut', 'mandel': 'almond', 'hasselnöt': 'hazelnut',
    'valnöt': 'walnut', 'sesam': 'sesame', 'kokos': 'coconut', 'sötpotatis': 'sweet potato', 'pumpa': 'pumpkin',
    'stenig': 'stony', 'saftig': 'juicy', 'druva': 'grape', 'vinig': 'winey', 'björnbär': 'blackberry',
    'hallon': 'raspberry', 'blåbär': 'blueberry', 'jordgubbe': 'strawberry', 'svarta vinbär': 'blackcurrant',
    'rabarber': 'rhubarb', 'gurka': 'cucumber', 'nyklippt gräs': 'freshly cut grass', 'blommig honung': 'floral honey',
    'apelsinblomma': 'orange blossom', 'apelsinblom': 'orange blossom', 'körsbärsblom': 'cherry blossom',
    'körsbärsblomma': 'cherry blossom', 'skogig': 'forest floor', 'bärig': 'berry'
  };
  // Varianter av en sort i äldre text: "Grönt, smaksatt" → "Green, flavored".
  var VARIANTS_SV = {
    'smaksatt': 'flavored', 'smaksatta': 'flavored', 'jasmin': 'jasmine', 'rökt': 'smoked', 'pulver': 'powder',
    'rostad': 'roasted', 'rostat': 'roasted', 'kolrostad': 'charcoal roasted', 'kolrostat': 'charcoal roasted',
    'lagrad': 'aged', 'lagrat': 'aged', 'pressad': 'pressed', 'pressat': 'pressed', 'kaka': 'cake'
  };
  var COUNTRIES_SV = {
    'kina': 'China', 'indien': 'India', 'sydkorea': 'South Korea', 'nordkorea': 'North Korea',
    'indonesien': 'Indonesia', 'sydafrika': 'South Africa', 'georgien': 'Georgia', 'turkiet': 'Turkey',
    'brasilien': 'Brazil', 'egypten': 'Egypt', 'grekland': 'Greece', 'tyskland': 'Germany', 'frankrike': 'France',
    'sverige': 'Sweden', 'marocko': 'Morocco', 'nya zeeland': 'New Zealand', 'australien': 'Australia',
    'ryssland': 'Russia', 'azerbajdzjan': 'Azerbaijan', 'spanien': 'Spain', 'italien': 'Italy', 'mexiko': 'Mexico',
    'kambodja': 'Cambodia', 'sydamerika': 'South America', 'afrika': 'Africa', 'asien': 'Asia', 'thailand': 'Thailand',
    'ungern': 'Hungary', 'polen': 'Poland', 'kroatien': 'Croatia', 'bulgarien': 'Bulgaria'
  };
  // Butiker som alltid finns som knappar; butiker som skrivits in på andra teer läggs till efter dem.
  var SHOPS = ['In the Mood for Tea', 'The Tea Centre'];

  // Gong fu-scheman i sekunder: sköljning, infusion 1–5 som [kortast, längst], och sedan
  // `extra` sekunder till för varje infusion efter den femte. Vitt te får ett eget schema med
  // längre dragningar, eftersom knopparna släpper smak långsamt; alla andra sorter får standard.
  // Tabellen i teet och timern byggs båda härifrån.
  var BREW_SCHEDULES = {
    standard: {
      title: 'Gong fu',
      rinse: { note: '(pouring away)', lo: 5, hi: 10 },
      infusions: [[10, 15], [5, 10], [10, 15], [15, 20], [20, 30]],
      extra: 10
    },
    white: {
      title: 'Gong fu · white tea',
      rinse: { note: '(pouring away, can be skipped)', lo: 10, hi: 10 },
      infusions: [[20, 30], [15, 20], [20, 25], [30, 35], [40, 50]],
      extra: 10
    }
  };

  var COUNTRY_PATTERN = new RegExp('(^|[^A-Za-zÀ-ÿ])(' + Object.keys(COUNTRIES_SV)
    .sort(function (a, b) { return b.length - a.length; }).join('|') + ')(?=$|[^A-Za-zÀ-ÿ])', 'gi');

  // Tecknet mellan sorten och varianten: "Green, jasmine", "Pu-erh (shu)", "Black smoked".
  var VARIANT_SEPARATOR = /[\s,(/–—-]/;

  // Ordningen här är ordningen i anteckningen. Alias gör att rader skrivna för hand också känns igen.
  var FIELDS = [
    { key: 'sort', label: 'Type', aliases: ['type', 'tea type', 'kind', 'category', 'sort', 'tesort', 'typ'] },
    { key: 'namn', label: 'Name', aliases: ['name', 'tea', 'tea name', 'namn', 'te', 'benämning'] },
    { key: 'temperatur', label: 'Temperature', aliases: ['temperature', 'temp', 'water temperature', 'water temp', 'degrees', 'temperatur', 'vattentemperatur', 'vattentemp', 'grader'] },
    // Tiden för vanlig bryggning; gong fu har sitt eget schema.
    { key: 'bryggtid', label: 'Brew time', aliases: ['brew time', 'brewing time', 'steep time', 'steeping time', 'steep', 'time', 'minutes', 'bryggtid', 'tid', 'dragtid', 'dragningstid', 'minuter'] },
    { key: 'land', label: 'Country', aliases: ['country', 'origin', 'country of origin', 'land', 'ursprung', 'ursprungsland'] },
    // Var teet köptes, fritt namn.
    { key: 'butik', label: 'Shop', aliases: ['shop', 'store', 'bought at', 'bought from', 'vendor', 'seller', 'butik', 'köpt', 'köpt i', 'köpt på', 'köpt hos', 'köpställe', 'inköpsställe', 'affär', 'handlare'] },
    // Smakord åtskilda med kommatecken.
    { key: 'smak', label: 'Taste', aliases: ['taste', 'tastes', 'flavor', 'flavour', 'flavors', 'flavours', 'tasting notes', 'taste profile', 'flavor profile', 'smak', 'smaker', 'smakprofil', 'smaknoter', 'smaknot', 'smakbeskrivning'] },
    // flag: sparas som "yes" eller tomt.
    { key: 'gongfu', label: 'Gong fu', flag: true, aliases: ['gong fu', 'gongfu', 'gong-fu', 'gong fu cha', 'gongfu cha', 'good for gong fu', 'passar för gong fu'] },
    // Teet håller på att ta slut och ska köpas igen.
    { key: 'fyllpa', label: 'Refill', flag: true, aliases: ['refill', 'needs refill', 'needs refilling', 'restock', 'running low', 'buy again', 'buy more', 'reorder', 'fyll på', 'fyll pa', 'fyllpå', 'påfyllning', 'behöver fyllas på', 'snart slut', 'slut', 'köp', 'köpa', 'köp mer', 'köpa mer'] },
    // Ett te man har hemma men inte har smakat än.
    { key: 'untried', label: 'Untried', flag: true, aliases: ['untried', 'not tried', 'not tried yet', 'untested', 'to try', 'ej testat', 'ej testad', 'inte testat', 'inte provat', 'otestat', 'otestad', 'oprovat', 'oprovad'] }
  ];
  // Fältnamn som bara finns i äldre, svensk text: en sådan text skrivs om till engelska.
  var SWEDISH_LABELS = ['sort', 'tesort', 'typ', 'namn', 'te', 'benämning', 'temperatur', 'vattentemperatur',
    'vattentemp', 'grader', 'bryggtid', 'tid', 'dragtid', 'dragningstid', 'minuter', 'land', 'ursprung',
    'ursprungsland', 'butik', 'köpt', 'köpt i', 'köpt på', 'köpt hos', 'köpställe', 'inköpsställe', 'affär',
    'handlare', 'smak', 'smaker', 'smakprofil', 'smaknoter', 'smaknot', 'smakbeskrivning', 'passar för gong fu',
    'fyll på', 'fyll pa', 'fyllpå', 'påfyllning', 'behöver fyllas på', 'snart slut', 'slut', 'köp', 'köpa',
    'köp mer', 'köpa mer', 'ej testat', 'ej testad', 'inte testat', 'inte provat', 'otestat', 'otestad', 'oprovat',
    'oprovad'];
  var TEXT_KEYS = ['sort', 'namn', 'temperatur', 'bryggtid', 'land', 'butik', 'smak'];

  var el = {
    page: document.querySelector('.page'),
    notice: document.getElementById('notice'),
    lockedBanner: document.getElementById('locked-banner'),
    filtersBar: document.getElementById('filters-bar'),
    filters: document.getElementById('filters'),
    gongfuFilter: document.getElementById('gongfu-filter'),
    filterRow: document.getElementById('filter-row'),
    chipDivider: document.getElementById('chip-divider'),
    einkToggle: document.getElementById('eink-toggle'),
    textToggle: document.getElementById('text-toggle'),
    textPanel: document.getElementById('textpanel'),
    textArea: document.getElementById('text-area'),
    textCopy: document.getElementById('text-copy'),
    textSave: document.getElementById('text-save'),
    textClose: document.getElementById('text-close'),
    refillFilter: document.getElementById('refill-filter'),
    untriedFilter: document.getElementById('untried-filter'),
    triedFilter: document.getElementById('tried-filter'),
    search: document.getElementById('search'),
    searchClear: document.getElementById('search-clear'),
    groups: document.getElementById('groups'),
    empty: document.getElementById('empty'),
    addTea: document.getElementById('add-tea'),
    groupTemplate: document.getElementById('group-template'),
    teaTemplate: document.getElementById('tea-template'),
    count: document.getElementById('count'),
    saveState: document.getElementById('save-state')
  };

  var state = {
    connected: false,
    note: null,
    locked: false,
    teas: [],
    rest: '',
    expanded: -1,
    // Det utfällda teet visas först utan fält och valknappar; Ändra tar fram dem. Då byter
    // ett tryck när man scrollar inte sort av misstag. Ett nytt te öppnas direkt för ändring.
    editing: false,
    // Sort och namn för det utfällda teet när det fälldes ut. Kortet står kvar på sin plats
    // medan man skriver och flyttas till rätt grupp när det fälls ihop.
    frozen: null,
    confirmIndex: -1,
    confirmTimer: null,
    filter: migrateFilter(loadPref(FILTER_KEY)),
    gongfuOnly: loadPref(GONGFU_KEY) === '1',
    refillOnly: loadPref(REFILL_KEY) === '1',
    // '' (alla), 'untried' (bara oprovade) eller 'tried' (bara provade).
    untriedMode: untriedModeFrom(loadPref(UNTRIED_KEY)),
    // Sökningen sparas inte; den gäller tills man rensar den eller byter anteckning.
    search: '',
    lastSentText: null,
    // De senaste texterna vi själva har sparat. En sparning kan komma tillbaka från appen
    // efter att man har skrivit vidare, och ska då inte skriva över fälten.
    sentTexts: []
  };

  // ---------- Inställningar per enhet ----------
  //
  // Filter, Gong fu, Fyll på, ljud och e-ink sparas per enhet. I Standard Notes på telefonen
  // kan pluginets localStorage tömmas varje gång anteckningen öppnas, så de sparas också i
  // pluginets data i Standard Notes (som följer med när pluginet laddas), under en nyckel för
  // just den här enheten. Då påverkar ett val på telefonen inte datorn, och tvärtom.

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

  /** Läser och sparar i appen (Android: SharedPreferences). Tomt värde tar bort nyckeln. */
  function nativeGet(key) {
    try {
      var v = NATIVE.load(key);
      return v === undefined || v === null ? null : String(v);
    } catch (e) {
      return null;
    }
  }

  function nativeSet(key, value) {
    try { NATIVE.save(key, value ? String(value) : ''); } catch (e) { /* kan inte spara */ }
  }

  function loadPref(key) {
    if (NATIVE) return nativeGet(key);
    var local = null;
    try { local = window.localStorage.getItem(key); } catch (e) { /* ingen lagring */ }
    if (local !== null) return local;
    var saved = devicePrefs()[key];
    return saved === undefined ? null : saved;
  }

  function storePref(key, value) {
    if (NATIVE) {
      nativeSet(key, value);
      return;
    }
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

  /** Läser in inställningarna igen när Standard Notes har skickat pluginets data. */
  function reloadPrefs() {
    state.filter = migrateFilter(loadPref(FILTER_KEY));
    state.gongfuOnly = loadPref(GONGFU_KEY) === '1';
    state.refillOnly = loadPref(REFILL_KEY) === '1';
    state.untriedMode = untriedModeFrom(loadPref(UNTRIED_KEY));
    soundOn = loadPref(SOUND_KEY) !== '0';
    initEink();
    if (state.note) render();
  }

  // ---------- Teer ----------

  function emptyTea() {
    return { values: { sort: '', namn: '', temperatur: '', bryggtid: '', land: '', butik: '', smak: '', gongfu: false, fyllpa: false, untried: false }, extra: [], prefill: false };
  }

  /**
   * Ett te utan något ifyllt sparas inte. Ett nytt te som bara har fått sort och gong fu
   * från filtret (prefill) räknas inte heller förrän man har ändrat något i det.
   */
  function hasContent(tea) {
    if (tea.prefill) return false;
    return TEXT_KEYS.some(function (key) { return oneLine(tea.values[key]); }) ||
      tea.values.gongfu || tea.values.fyllpa || tea.values.untried ||
      tea.extra.some(function (line) { return line.trim(); });
  }

  function touch(tea) {
    tea.prefill = false;
  }

  function untriedModeFrom(stored) {
    if (stored === '1' || stored === 'untried') return 'untried';
    return stored === 'tried' ? 'tried' : '';
  }

  /** Ett sparat sortfilter från en äldre version ("k:Grönt") blir den nya nyckeln ("k:green"). */
  function migrateFilter(key) {
    if (!key) return null;
    if (key.indexOf('k:') !== 0) return key;
    var known = knownSort(key.slice(2));
    return known ? 'k:' + known.id : key;
  }

  function knownSort(text) {
    var split = splitSort(text);
    return split ? split.sort : null;
  }

  /**
   * Sorten och en eventuell variant: "Green, jasmine" → Green + "jasmine", "Pu-erh (shu)" →
   * Pu-erh + "shu", "Smoked black" → Black + "Smoked". Varianten ger ingen egen grupp eller
   * filterknapp; den står kvar i texten, visas i raden och går att söka på.
   */
  function splitSort(text) {
    var value = oneLine(text);
    var lower = value.toLowerCase();
    if (!lower) return null;
    var best = null;
    SORTS.forEach(function (sort) {
      sort.aliases.forEach(function (alias) {
        var rest = null;
        if (lower === alias) {
          rest = '';
        } else if (lower.indexOf(alias) === 0 && VARIANT_SEPARATOR.test(lower.charAt(alias.length))) {
          rest = value.slice(alias.length);
        } else if (lower.length > alias.length && lower.slice(-alias.length) === alias &&
                   VARIANT_SEPARATOR.test(lower.charAt(lower.length - alias.length - 1))) {
          rest = value.slice(0, value.length - alias.length);
        }
        if (rest !== null && (!best || alias.length > best.alias.length)) best = { sort: sort, alias: alias, rest: rest };
      });
    });
    if (!best) return null;
    return { sort: best.sort, alias: best.alias, variant: best.rest.replace(/[()]/g, ' ').replace(/^[\s,/–—-]+|[\s,/–—-]+$/g, '').replace(/\s+/g, ' ') };
  }

  /** Gruppen för en sort: { key, label, color, rank, index }. */
  function groupFor(sortValue) {
    var text = oneLine(sortValue);
    if (!text) return { key: NO_SORT, label: 'No type', color: '', rank: 2, index: 0 };
    var known = knownSort(text);
    if (known) return { key: 'k:' + known.id, label: known.label, color: known.color, rank: 0, index: SORTS.indexOf(known) };
    return { key: 'x:' + text.toLowerCase(), label: capitalize(text), color: '', rank: 1, index: 0 };
  }

  function compareGroups(a, b) {
    return a.rank - b.rank || a.index - b.index || a.label.localeCompare(b.label, 'en');
  }

  function compareNames(a, b) {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
  }

  /** Grupperna bland de ifyllda teerna, i visningsordning, med antal. */
  function groupsOf(teas) {
    var byKey = {};
    var list = [];
    teas.forEach(function (tea) {
      var g = groupFor(tea.values.sort);
      if (!byKey[g.key]) {
        g.count = 0;
        byKey[g.key] = g;
        list.push(g);
      }
      byKey[g.key].count++;
    });
    return list.sort(compareGroups);
  }

  /** "95" → "95 °C", "80-85" → "80–85 °C"; annan text visas som den står. */
  function formatTemp(value) {
    return withUnit(value, '°C');
  }

  /** "3" → "3 min", "2-3" → "2–3 min"; "30 sek" och annan text visas som den står. */
  function formatTime(value) {
    return withUnit(value, 'min');
  }

  function withUnit(value, unit) {
    var text = oneLine(value);
    if (!text || !PLAIN_NUMBER.test(text)) return text;
    return text.replace(/\s*[-–—]\s*/, '–') + ' ' + unit;
  }

  /** "2 – 3 min" → "2-3", så att förslagsknappen 2–3 visas som vald. */
  function normalizeNumber(value) {
    return oneLine(value).toLowerCase()
      .replace(/\s*(°c|°|degrees|grader|minutes|minute|minuter|minut|min)\.?$/, '')
      .replace(/\s*[-–—]\s*/, '-');
  }

  /**
   * Bryggtiden i sekunder för timern: "3" → 180, "2-3" → 120–180, "1,5" → 90,
   * "30 sek" → 30. Utan enhet räknas minuter. Annan text ger null (ingen timer).
   */
  function parseBrewTime(value) {
    var text = oneLine(value).toLowerCase().replace(/,/g, '.');
    var m = /^(\d+(?:\.\d+)?)\s*(?:[-–—]\s*(\d+(?:\.\d+)?))?\s*(minutes|minute|minuter|minut|mins|min|m|seconds|second|sekunder|sekund|secs|sec|sek|s)?\.?$/.exec(text);
    if (!m) return null;
    var factor = m[3] && m[3].charAt(0) === 's' ? 1 : 60;
    var lo = Math.round(parseFloat(m[1]) * factor);
    var hi = m[2] ? Math.round(parseFloat(m[2]) * factor) : lo;
    if (!lo || hi < lo || hi > 3600) return null;
    return { lo: lo, hi: hi };
  }

  /** Ett intervall i sekunder som text: "10–15 s", "2–3 min", "1.5 min". */
  function rangeText(lo, hi) {
    if (hi < 60) return (lo === hi ? lo : lo + '–' + hi) + ' s';
    var min = function (sec) { return String(Math.round(sec / 6) / 10); };
    return (lo === hi ? min(lo) : min(lo) + '–' + min(hi)) + ' min';
  }

  /** "honung, Persika ;blommig" → ["honung", "Persika", "blommig"]. */
  function tasteWords(value) {
    return String(value || '').split(/\s*[,;\n]\s*/).map(function (w) { return w.trim(); }).filter(Boolean);
  }

  function hasTaste(value, word) {
    var wanted = word.toLowerCase();
    return tasteWords(value).some(function (w) { return w.toLowerCase() === wanted; });
  }

  /** Lägger till ordet sist, eller tar bort det om det redan finns. */
  function toggleTaste(value, word) {
    var words = tasteWords(value);
    var wanted = word.toLowerCase();
    var kept = words.filter(function (w) { return w.toLowerCase() !== wanted; });
    if (kept.length === words.length) kept.push(word);
    return kept.join(', ');
  }

  // ---------- Textformat ----------

  function fieldByLabel(label) {
    var wanted = label.trim().toLowerCase();
    for (var i = 0; i < FIELDS.length; i++) {
      if (FIELDS[i].aliases.indexOf(wanted) !== -1) return FIELDS[i];
    }
    return null;
  }

  function parse(text) {
    var teas = [];
    var restBlocks = [];
    var converted = false;
    var blocks = String(text || '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/);

    blocks.forEach(function (block) {
      var current = null;
      var seen = {};
      var loose = [];

      block.split('\n').forEach(function (line) {
        var m = FIELD_LINE.exec(line);
        var field = m && fieldByLabel(m[1]);
        if (!field) {
          if (!line.trim()) return;
          if (current) current.extra.push(line); else loose.push(line);
          return;
        }
        var value = m[2].trim();
        // Samma fält igen utan tom rad emellan: ett nytt te börjar.
        if (current && seen[field.key]) current = null;
        if (!current) {
          current = emptyTea();
          seen = {};
          teas.push(current);
        }
        seen[field.key] = true;
        current.values[field.key] = field.flag ? YES.test(value) : value;
        // Svenskt fältnamn eller "ja": texten är i det äldre, svenska formatet.
        if (SWEDISH_LABELS.indexOf(m[1].trim().toLowerCase()) !== -1 || (field.flag && /^\s*ja\b/i.test(value))) converted = true;
      });

      if (loose.length) restBlocks.push(loose.join('\n'));
    });

    teas.forEach(function (tea) { if (toEnglish(tea)) converted = true; });
    return { teas: teas, rest: restBlocks.join('\n\n'), converted: converted };
  }

  function variantToEnglish(text) {
    var whole = VARIANTS_SV[text.toLowerCase()];
    if (whole) return whole;
    return text.split(/(\s*,\s*|\s+)/).map(function (part) {
      var lower = part.toLowerCase();
      return VARIANTS_SV[lower] || TASTES_SV[lower] || part;
    }).join('');
  }

  /**
   * Svenska sortnamn, länder och smakord i ett te blir engelska ("Grönt" → "Green",
   * "Kina" → "China", "honung, blommig" → "honey, floral"). Returnerar true om något ändrades.
   */
  function toEnglish(tea) {
    var v = tea.values;
    var before = v.sort + '|' + v.land + '|' + v.smak;
    // Svensk sort, även med variant: "Grönt" → "Green", "Svart, smaksatt" → "Black, flavored".
    var split = splitSort(v.sort);
    if (split) {
      var variant = split.variant ? variantToEnglish(split.variant) : '';
      if (split.sort.sv.indexOf(split.alias) !== -1 || variant !== split.variant) {
        v.sort = split.sort.label + (variant ? ', ' + variant : '');
      }
    }
    v.land = String(v.land || '').replace(COUNTRY_PATTERN, function (all, lead, word) {
      return lead + COUNTRIES_SV[word.toLowerCase()];
    });
    if (v.smak) {
      v.smak = tasteWords(v.smak).map(function (w) {
        return TASTES_SV[w.toLowerCase()] || w;
      }).join(', ');
    }
    return before !== v.sort + '|' + v.land + '|' + v.smak;
  }

  function serialize(teas, rest) {
    var filled = teas.filter(hasContent);
    // En tom mall sparas så att fälten syns även i andra editorer.
    if (!filled.length) filled = [emptyTea()];
    var blocks = filled.map(function (tea) {
      var lines = FIELDS.map(function (f) {
        var v = f.flag ? (tea.values[f.key] ? 'yes' : '') : oneLine(tea.values[f.key]);
        return f.label + ':' + (v ? ' ' + v : '');
      });
      return lines.concat(tea.extra).join('\n');
    });
    if (rest) blocks.push(rest);
    return blocks.join('\n\n');
  }

  function oneLine(value) {
    return String(value || '').replace(/\s*\n\s*/g, ' ').trim();
  }

  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function teaCount(n) {
    return n === 1 ? '1 tea' : n + ' teas';
  }

  /**
   * Förhandsvisningen i anteckningslistan.
   * Ett te: "Dong Ding · Oolong · 95 °C · Taiwan · gong fu".
   * Flera: "12 teas, 7 for gong fu, 2 untried: 4 oolong, 3 green, 2 black, 2 pu-erh, 1 no type".
   */
  function preview(teas) {
    var filled = teas.filter(hasContent);
    if (!filled.length) return '';
    if (filled.length === 1) {
      var v = filled[0].values;
      var parts = [oneLine(v.namn), oneLine(v.sort), formatTemp(v.temperatur), formatTime(v.bryggtid), oneLine(v.land), v.gongfu ? 'gong fu' : '', v.fyllpa ? 'refill' : '', v.untried ? 'untried' : ''];
      return truncate(parts.filter(Boolean).join(' · '));
    }
    var gongfu = filled.filter(function (tea) { return tea.values.gongfu; }).length;
    var refill = filled.filter(function (tea) { return tea.values.fyllpa; }).length;
    var untried = filled.filter(function (tea) { return tea.values.untried; }).length;
    var groups = groupsOf(filled).sort(function (a, b) { return b.count - a.count || compareGroups(a, b); });
    return truncate(teaCount(filled.length) + (gongfu ? ', ' + gongfu + ' for gong fu' : '') +
      (refill ? ', ' + refill + ' to refill' : '') + (untried ? ', ' + untried + ' untried' : '') + ': ' +
      groups.map(function (g) { return g.count + ' ' + g.label.toLowerCase(); }).join(', '));
  }

  function truncate(text) {
    return text.length > PREVIEW_LENGTH ? text.slice(0, PREVIEW_LENGTH - 1).trim() + '…' : text;
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
    if (kind === 'string') { try { d = JSON.parse(d); kind = 'json-string'; } catch (x) { /* ren sträng */ } }
    diagInfo.lastMessage = 'origin=' + e.origin + ' type=' + kind + (d && d.action ? ' action=' + d.action : '');
  }, true);

  function diagText() {
    var m = /Chrome\/([\d.]+)/.exec(navigator.userAgent);
    var ref = '';
    try { ref = document.referrer ? new URL(document.referrer).origin : '(empty)'; } catch (e) { ref = '(invalid)'; }
    return [
      'Version: ' + VERSION,
      'WebView: ' + (m ? 'Chrome ' + m[1] : navigator.userAgent.slice(0, 80)),
      'In iframe: ' + (window.parent !== window),
      'Referrer: ' + ref,
      'Messages received: ' + diagInfo.messages + (diagInfo.lastMessage ? ' (last ' + diagInfo.lastMessage + ')' : ''),
      'Errors: ' + (diagInfo.errors.length ? diagInfo.errors.join(' | ') : 'none')
    ].join('\n');
  }

  // ---------- Anslutning ----------

  // Versionen längst ner till höger, så att man ser vilken version varje enhet kör.
  document.getElementById('version').textContent = 'v' + VERSION;

  // E-ink-läge: svart och vitt, ramar i stället för tonade bakgrunder, inga animationer.
  // Väljs per enhet med knappen i statusraden. Utan val slås det på av sig självt om
  // skärmen säger att den är svartvit.
  var EINK_KEY = 'se.jagemyr.te.eink';

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

  var relay = STANDALONE ? null : new ComponentRelay({
    targetWindow: window,
    options: { coallesedSaving: true, coallesedSavingDelay: 250 },
    onReady: function () {
      state.connected = true;
      el.notice.hidden = true;
      setSaveState('', '');
      // Pluginets data kan saknas första gången; då börjar den tom.
      try { if (!relay.component.data) relay.component.data = {}; } catch (e) { /* okänt */ }
      reloadPrefs();
    }
  });

  setTimeout(function () {
    if (!state.connected && !STANDALONE) {
      el.notice.hidden = false;
      document.getElementById('diag').textContent = diagText();
      setSaveState('Not connected', 'error');
    }
  }, NOT_CONNECTED_HINT_MS);

  // ---------- Från Standard Notes ----------

  if (relay) relay.streamContextItem(onNote);

  function onNote(note) {
    var isNewNote = !state.note || state.note.uuid !== note.uuid;
    var wasLocked = state.locked;
    state.note = note;
    state.locked = isLocked(note);

    if (isNewNote) {
      state.lastSentText = null;
      state.sentTexts = [];
      resetConfirm();
      setSearch('');
      setSaveState('', '');
    }

    var textChanged = false;
    var converted = false;
    if (!note.isMetadataUpdate || isNewNote) {
      var incoming = (note.content && note.content.text) || '';
      // Vår egen sparning som kommer tillbaka ska inte skriva över det man håller på att skriva.
      var isEcho = !isNewNote && (state.sentTexts.indexOf(incoming) !== -1 || incoming === serialize(state.teas, state.rest));
      if (!isEcho) {
        var parsed = parse(incoming);
        state.teas = parsed.teas;
        state.rest = parsed.rest;
        converted = parsed.converted;
        // Indexet hör till den gamla texten; släpp det utan att röra den nya listan.
        if (isNewNote || state.expanded >= state.teas.length) {
          state.expanded = -1;
          state.frozen = null;
        }
        // En tom anteckning visar ett tomt te, utfällt och klart att fylla i.
        if (!state.teas.some(hasContent)) {
          if (!state.teas.length) state.teas.push(emptyTea());
          expand(0);
          state.editing = true;
        }
        textChanged = true;
      }
    }

    if (isNewNote || textChanged || wasLocked !== state.locked) {
      render();
      if (isNewNote) el.page.scrollTop = 0;
    }
    // Äldre, svensk text skrivs om till engelska direkt, så att anteckningen också blir engelsk.
    if (converted && state.teas.some(hasContent)) save();
  }

  function isLocked(note) {
    // Egen uppslagning: relayens getItemAppDataValue kraschar om domänen saknas i appData.
    var appData = note.content && note.content.appData;
    var sn = appData && appData['org.standardnotes.sn'];
    return Boolean(sn && sn.locked);
  }

  function editable() {
    return Boolean(state.note) && !state.locked;
  }

  // ---------- Till Standard Notes ----------

  function save() {
    if (!editable()) return;
    var note = state.note;
    var text = serialize(state.teas, state.rest);
    if (STANDALONE) {
      note.content.text = text;
      storeText(text);
      setSaveState('Saved', 'saved');
      return;
    }
    var previewText = preview(state.teas);
    setSaveState('Saving…', '');
    relay.saveItemWithPresave(note, function () {
      note.content.text = text;
      note.content.preview_plain = previewText;
      note.content.preview_html = null;
      state.lastSentText = text;
      state.sentTexts.push(text);
      if (state.sentTexts.length > 20) state.sentTexts.shift();
    }, function () {
      if (state.note && state.note.uuid === note.uuid) {
        setSaveState('Saved', 'saved');
      }
    });
  }

  // ---------- Händelser ----------

  function teaIndex(target) {
    var card = target.closest('.tea');
    return card ? Number(card.getAttribute('data-index')) : -1;
  }

  function cardFor(index) {
    return el.groups.querySelector('.tea[data-index="' + index + '"]');
  }

  /**
   * Inmatning ritar bara om det som ändras (raden, förslagen, räknaren och filtren),
   * inte hela listan, så att inget i fältet man skriver i rörs.
   */
  el.page.addEventListener('input', function (event) {
    var input = event.target;
    if (input.tagName !== 'INPUT' || input.type === 'checkbox' || !editable()) return;
    var tea = state.teas[teaIndex(input)];
    var key = input.getAttribute('data-key');
    if (!tea || !key || tea.values[key] === input.value) return;
    tea.values[key] = input.value;
    touch(tea);
    var card = input.closest('.tea');
    renderSummary(card, tea);
    renderSuggestions(card, tea, true);
    renderFilters();
    renderCount();
    save();
  });

  el.page.addEventListener('change', function (event) {
    var box = event.target;
    var flag = box.getAttribute && box.getAttribute('data-flag');
    if (!flag) return;
    var tea = state.teas[teaIndex(box)];
    if (!tea || !editable()) { render(); return; }
    tea.values[flag] = box.checked;
    touch(tea);
    renderSummary(box.closest('.tea'), tea);
    renderFilters();
    renderCount();
    save();
  });

  el.page.addEventListener('click', function (event) {
    var index = teaIndex(event.target);
    if (index < 0) return;

    if (event.target.closest('.summary')) {
      toggle(index);
      return;
    }

    // Ett tryck på ett steg i gong fu-schemat startar timern där.
    var stepRow = event.target.closest('.brew tr[data-step]');
    if (stepRow) {
      openTimer(state.teas[index], 'gongfu', Number(stepRow.getAttribute('data-step')));
      return;
    }

    var button = event.target.closest('[data-action], [data-value]');
    if (!button) return;
    var action = button.getAttribute('data-action');

    if (action === 'collapse') {
      collapseAndShow(index);
      return;
    }
    // Timern ändrar inget i anteckningen, så den fungerar även när den är låst.
    if (action === 'timer-gongfu' || action === 'timer-western') {
      openTimer(state.teas[index], action === 'timer-gongfu' ? 'gongfu' : 'western', 0);
      return;
    }
    if (!editable()) return;
    var tea = state.teas[index];
    var card = cardFor(index);

    if (action === 'edit') {
      state.editing = true;
      resetConfirm();
      render();
      return;
    }

    if (button.hasAttribute('data-value')) {
      var key = button.closest('[data-suggest]').getAttribute('data-suggest');
      var chosen = button.getAttribute('data-value');
      // En sort med variant behåller varianten: "Green, jasmine" + Black → "Black, jasmine".
      var current = key === 'sort' ? splitSort(tea.values.sort) : null;
      if (current && current.variant) {
        chosen = current.sort.label === chosen ? oneLine(tea.values.sort) : chosen + ', ' + current.variant;
      }
      // Smakorden läggs till och tas bort; de andra knapparna ersätter fältet.
      tea.values[key] = key === 'smak' ? toggleTaste(tea.values.smak, chosen) : chosen;
      touch(tea);
      renderCard(card, tea, index, true);
      renderFilters();
      renderCount();
      save();
      // Efter en sort är namnet nästa sak att fylla i.
      if (key === 'sort' && !oneLine(tea.values.namn)) card.querySelector('[data-key="namn"]').focus();
    } else if (action === 'remove') {
      removeTea(index);
    }
  });

  // Ett tryck direkt efter en scroll (t.ex. för att stoppa den) räknas inte som ett val:
  // valknappar, bockar, Ändra och Ta bort ignorerar tryck inom SCROLL_GUARD_MS efter scroll.
  // Bara scroll som ett dragande finger har satt igång räknas, även när sidan glider vidare
  // efteråt. Ett vanligt tryck (utan att dra) räknas inte, och inte heller appens egen scroll
  // (t.ex. fram till ett utfällt te), så att Ändra inte spärras direkt efter att man fällt ut.
  var SCROLL_GUARD_MS = 400;
  var TOUCH_SCROLL_MS = 3000;
  var OWN_SCROLL_MS = 500;
  var lastScroll = 0;
  var lastDrag = 0;
  var ownScrollUntil = 0;
  el.page.addEventListener('touchmove', function () { lastDrag = Date.now(); }, { passive: true });
  el.page.addEventListener('scroll', function () {
    var now = Date.now();
    if (now < ownScrollUntil) return;
    if (now - lastDrag < TOUCH_SCROLL_MS) lastScroll = now;
  }, { passive: true });
  el.page.addEventListener('click', function (event) {
    if (Date.now() - lastScroll > SCROLL_GUARD_MS) return;
    if (!event.target.closest('.suggest, .toggle, [data-action="edit"], [data-action="remove"]')) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  // Enter hoppar till nästa fält i samma te (ingen <form>, se README).
  el.page.addEventListener('keydown', function (event) {
    var input = event.target;
    if (event.key !== 'Enter' || input.tagName !== 'INPUT' || input.type === 'checkbox') return;
    var card = input.closest('.tea');
    if (!card) return;
    event.preventDefault();
    var all = Array.prototype.slice.call(card.querySelectorAll('.details input[data-key]'));
    var following = all[all.indexOf(input) + 1];
    if (following) following.focus(); else input.blur();
  });

  el.addTea.addEventListener('click', function () {
    if (!editable()) return;
    collapse();
    // Återanvänd ett tomt te i stället för att lägga till ett till.
    var index = -1;
    state.teas.forEach(function (tea, i) { if (!hasContent(tea)) index = i; });
    if (index < 0) {
      state.teas.push(emptyTea());
      index = state.teas.length - 1;
    }
    var tea = state.teas[index];
    // Med ett filter valt får det nya teet den sorten (och gong fu eller fyll på), som i Todo.
    var sort = filterSortLabel();
    if (sort || state.gongfuOnly || state.refillOnly || state.untriedMode === 'untried') {
      tea.values.sort = sort || tea.values.sort;
      tea.values.gongfu = state.gongfuOnly || tea.values.gongfu;
      tea.values.fyllpa = state.refillOnly || tea.values.fyllpa;
      tea.values.untried = state.untriedMode === 'untried' || tea.values.untried;
      tea.prefill = TEXT_KEYS.every(function (key) { return key === 'sort' || !oneLine(tea.values[key]); });
    }
    expand(index);
    state.editing = true;
    resetConfirm();
    render();
    var card = cardFor(index);
    scrollIntoView(card);
    card.querySelector(oneLine(tea.values.sort) ? '[data-key="namn"]' : '[data-key="sort"]').focus();
  });

  /** Sorten som hör till det valda filtret, eller tom sträng. */
  function filterSortLabel() {
    if (!state.filter || state.filter === NO_SORT) return '';
    var g = groupsOf(state.teas.filter(hasContent)).filter(function (x) { return x.key === state.filter; })[0];
    return g ? g.label : '';
  }

  // ---------- Filter ----------

  el.filters.addEventListener('click', function (event) {
    var chip = event.target.closest('.chip');
    if (!chip) return;
    state.filter = chip.getAttribute('data-group') || null;
    storePref(FILTER_KEY, state.filter);
    collapse();
    resetConfirm();
    render();
    el.page.scrollTop = 0;
  });

  el.gongfuFilter.addEventListener('click', function () {
    state.gongfuOnly = !state.gongfuOnly;
    storePref(GONGFU_KEY, state.gongfuOnly ? '1' : '');
    collapse();
    resetConfirm();
    render();
    el.page.scrollTop = 0;
  });

  // Fyll på: bara teer som behöver köpas igen, som en inköpslista.
  // Untried: teer man har hemma men inte har smakat än. Tried: alla andra. Bara ett av dem åt gången.
  function setUntriedMode(mode) {
    state.untriedMode = state.untriedMode === mode ? '' : mode;
    storePref(UNTRIED_KEY, state.untriedMode === 'untried' ? '1' : state.untriedMode);
    collapse();
    resetConfirm();
    render();
    el.page.scrollTop = 0;
  }

  el.untriedFilter.addEventListener('click', function () { setUntriedMode('untried'); });
  el.triedFilter.addEventListener('click', function () { setUntriedMode('tried'); });

  el.refillFilter.addEventListener('click', function () {
    state.refillOnly = !state.refillOnly;
    storePref(REFILL_KEY, state.refillOnly ? '1' : '');
    collapse();
    resetConfirm();
    render();
    el.page.scrollTop = 0;
  });

  /** Ett te syns om det passar sortfiltret, gong fu- och fyll på-filtren och sökningen. */
  function passesFilters(tea) {
    if (state.filter && groupFor(tea.values.sort).key !== state.filter) return false;
    if (state.gongfuOnly && !tea.values.gongfu) return false;
    if (state.refillOnly && !tea.values.fyllpa) return false;
    if (state.untriedMode === 'untried' && !tea.values.untried) return false;
    if (state.untriedMode === 'tried' && tea.values.untried) return false;
    return matchesSearch(tea);
  }

  // ---------- Sök ----------
  //
  // Söker i namn, sort, land, butik och smak. Alla ord man skriver måste finnas någonstans i teet,
  // så "honung taiwan" hittar de taiwanesiska teerna som smakar honung. Stora och små
  // bokstäver, accenter och bindestreck spelar ingen roll ("rokig" hittar "rökig",
  // "puerh" hittar "Pu-erh").

  function foldText(text) {
    var lower = String(text || '').toLowerCase();
    try { lower = lower.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* äldre webbläsare */ }
    return lower.replace(/[-'’´`]/g, '');
  }

  function searchTerms() {
    return foldText(state.search).split(/[\s,]+/).filter(Boolean);
  }

  function matchesSearch(tea) {
    var terms = searchTerms();
    if (!terms.length) return true;
    var v = tea.values;
    var hay = foldText([v.namn, v.sort, groupFor(v.sort).label, v.land, v.butik, v.smak].join(' '));
    return terms.every(function (term) { return hay.indexOf(term) !== -1; });
  }

  /** Något av sort-, gong fu- eller fyll på-filtren är valt. */
  function anyFilter() {
    return Boolean(state.filter) || state.gongfuOnly || state.refillOnly || Boolean(state.untriedMode);
  }

  function setSearch(value) {
    state.search = value;
    if (el.search.value !== value) el.search.value = value;
    el.searchClear.hidden = !value;
  }

  el.search.addEventListener('input', function () {
    setSearch(el.search.value);
    collapse();
    resetConfirm();
    render();
    el.page.scrollTop = 0;
  });

  el.search.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && state.search) {
      event.preventDefault();
      clearSearch();
    } else if (event.key === 'Enter') {
      // Stänger tangentbordet i mobilen; resultatet syns redan.
      event.preventDefault();
      el.search.blur();
    }
  });

  el.searchClear.addEventListener('click', function () {
    clearSearch();
    el.search.focus();
  });

  function clearSearch() {
    setSearch('');
    collapse();
    resetConfirm();
    render();
  }

  // ---------- Fälla ut och ihop ----------

  function expand(index) {
    var tea = state.teas[index];
    state.expanded = index;
    state.editing = false;
    state.frozen = { sort: tea.values.sort, namn: tea.values.namn };
  }

  /** Fäller ihop. Ett nytt te som inte har fått något eget innehåll försvinner. */
  function collapse() {
    var tea = state.teas[state.expanded];
    if (tea && !hasContent(tea)) {
      state.teas.splice(state.expanded, 1);
      if (state.confirmIndex === state.expanded) resetConfirm();
    }
    state.expanded = -1;
    state.editing = false;
    state.frozen = null;
  }

  function toggle(index) {
    if (state.expanded === index) {
      collapseAndShow(index);
      return;
    }
    // Ett annat te som var utfällt fälls ihop och kan försvinna; räkna om indexet då.
    var target = state.teas[index];
    collapse();
    index = state.teas.indexOf(target);
    if (index < 0) { render(); return; }
    expand(index);
    resetConfirm();
    render();
    scrollIntoView(cardFor(index));
  }

  /** Fäller ihop och visar teet där det hamnar (det kan ha bytt grupp eller plats). */
  function collapseAndShow(index) {
    var tea = state.teas[index];
    collapse();
    resetConfirm();
    render();
    var i = state.teas.indexOf(tea);
    if (i >= 0) scrollIntoView(cardFor(i));
  }

  /** Första trycket frågar, andra tar bort. Ett tomt te tas bort direkt. */
  function removeTea(index) {
    var tea = state.teas[index];
    if (hasContent(tea) && state.confirmIndex !== index) {
      resetConfirm();
      state.confirmIndex = index;
      state.confirmTimer = setTimeout(function () { resetConfirm(); render(); }, CONFIRM_MS);
      render();
      return;
    }
    resetConfirm();
    state.teas.splice(index, 1);
    state.expanded = -1;
    state.frozen = null;
    render();
    save();
  }

  function resetConfirm() {
    clearTimeout(state.confirmTimer);
    state.confirmTimer = null;
    state.confirmIndex = -1;
  }

  function scrollIntoView(node) {
    if (!node) return;
    // Appens egen scroll ska inte spärra tryck (se spärren mot tryck efter scroll).
    ownScrollUntil = Date.now() + OWN_SCROLL_MS;
    try { node.scrollIntoView({ block: 'nearest' }); } catch (e) { node.scrollIntoView(false); }
  }

  // ---------- Rendering ----------

  /**
   * Vilka teer som syns, i vilka grupper och i vilken ordning. Det utfällda teet syns alltid
   * och står kvar där det var när det fälldes ut (state.frozen).
   */
  function layout() {
    var byKey = {};
    var groups = [];
    state.teas.forEach(function (tea, i) {
      var isExpanded = i === state.expanded;
      if (!isExpanded && !hasContent(tea)) return;
      var values = isExpanded && state.frozen ? state.frozen : tea.values;
      var g = groupFor(values.sort);
      if (!isExpanded && !passesFilters(tea)) return;
      if (!byKey[g.key]) {
        g.entries = [];
        byKey[g.key] = g;
        groups.push(g);
      }
      byKey[g.key].entries.push({ index: i, name: oneLine(values.namn) });
    });
    groups.sort(compareGroups);
    groups.forEach(function (g) {
      g.entries.sort(function (a, b) { return compareNames(a.name, b.name) || a.index - b.index; });
      g.indices = g.entries.map(function (e) { return e.index; });
    });
    return groups;
  }

  function render() {
    var canEdit = editable();
    el.lockedBanner.hidden = !state.locked;

    // Ett sparat filter för en sort som inte finns i den här anteckningen gäller inte.
    var filled = state.teas.filter(hasContent);
    if (state.note && state.filter && !groupsOf(filled).some(function (g) { return g.key === state.filter; })) {
      state.filter = null;
    }

    var groups = layout();
    // Rubrikerna behövs bara när flera sorter visas; med en sort vald står den i filtret.
    var headings = !state.filter && groups.length > 1;
    var signature = (headings ? 'h|' : '') + groups.map(function (g) { return g.key + ':' + g.indices.join(','); }).join('|');

    if (el.groups.getAttribute('data-signature') !== signature) {
      el.groups.setAttribute('data-signature', signature);
      el.groups.textContent = '';
      groups.forEach(function (g) {
        var section = el.groupTemplate.content.firstElementChild.cloneNode(true);
        section.setAttribute('data-group', g.key);
        section.querySelector('.section-head').hidden = !headings;
        var list = section.querySelector('.teas');
        g.indices.forEach(function (i) {
          var card = el.teaTemplate.content.firstElementChild.cloneNode(true);
          card.setAttribute('data-index', String(i));
          list.appendChild(card);
        });
        el.groups.appendChild(section);
      });
    }

    Array.prototype.forEach.call(el.groups.children, function (section, k) {
      var g = groups[k];
      var count = g.indices.filter(function (i) { return hasContent(state.teas[i]); }).length;
      section.querySelector('.g-title').textContent = g.label + (count ? ' (' + count + ')' : '');
      section.style.setProperty('--sort', g.color || 'var(--muted)');
      Array.prototype.forEach.call(section.querySelectorAll('.tea'), function (card) {
        var i = Number(card.getAttribute('data-index'));
        renderCard(card, state.teas[i], i, canEdit);
      });
    });

    renderEmpty(groups, filled);
    el.addTea.hidden = !canEdit;
    renderFilters();
    renderCount();
  }

  function renderEmpty(groups, filled) {
    var text = '';
    if (!groups.length && state.note) {
      if (!filled.length) {
        text = 'No teas yet.';
      } else if (state.search.trim()) {
        text = 'No teas match “' + state.search.trim() + '”' + (anyFilter() ? ' with the selected filter.' : '.');
      } else {
        var label = state.filter ? groupsOf(filled).filter(function (g) { return g.key === state.filter; })[0] : null;
        var among = label ? ' among the ' + label.label.toLowerCase() + ' teas' : '';
        if (state.refillOnly && state.untriedMode) text = 'No teas match the selected filters.';
        else if (state.refillOnly) text = 'Nothing needs a refill' + (state.gongfuOnly ? ' among the gong fu teas' : among) + '.';
        else if (state.untriedMode === 'untried') text = 'No untried teas' + (state.gongfuOnly ? ' among the gong fu teas' : among) + '.';
        else if (state.untriedMode === 'tried') text = 'No tried teas yet' + (state.gongfuOnly ? ' among the gong fu teas' : among) + '.';
        else if (state.gongfuOnly) text = 'No gong fu teas' + among + '.';
        else text = 'No teas here.';
      }
    }
    el.empty.textContent = text;
    el.empty.hidden = !text;
  }

  /** Filterknapparna: Alla och en per sort som finns, plus Gong fu till höger. */
  function renderFilters() {
    var filled = state.teas.filter(hasContent);
    var groups = groupsOf(filled);
    var anyGongfu = filled.some(function (tea) { return tea.values.gongfu; });
    var anyRefill = filled.some(function (tea) { return tea.values.fyllpa; });
    var anyUntried = filled.some(function (tea) { return tea.values.untried; });
    var show = filled.length >= 2 || anyFilter() || Boolean(state.search);
    el.filtersBar.hidden = !show;
    if (!show) return;

    var key = (state.filter || '') + '#' + groups.map(function (g) { return g.key + '=' + g.label + '=' + g.count; }).join('|');
    if (el.filters.getAttribute('data-shown') !== key) {
      el.filters.setAttribute('data-shown', key);
      var frag = document.createDocumentFragment();
      frag.appendChild(chip('', 'All', '', !state.filter));
      groups.forEach(function (g) { frag.appendChild(chip(g.key, g.label, g.color, state.filter === g.key)); });
      el.filters.textContent = '';
      el.filters.appendChild(frag);
      var active = el.filters.querySelector('.chip[aria-pressed="true"]');
      if (active) {
        var r = active.getBoundingClientRect();
        var rr = el.filterRow.getBoundingClientRect();
        if (r.right > rr.right) el.filterRow.scrollLeft += r.right - rr.right + 4;
        else if (r.left < rr.left) el.filterRow.scrollLeft -= rr.left - r.left + 4;
      }
    }
    el.gongfuFilter.hidden = !anyGongfu && !state.gongfuOnly;
    el.gongfuFilter.setAttribute('aria-pressed', String(state.gongfuOnly));
    el.refillFilter.hidden = !anyRefill && !state.refillOnly;
    // Tried och Untried behövs bara när något te är oprovat (eller när ett av dem redan är valt).
    el.triedFilter.hidden = !anyUntried && state.untriedMode !== 'tried';
    el.triedFilter.setAttribute('aria-pressed', String(state.untriedMode === 'tried'));
    el.untriedFilter.hidden = !anyUntried && state.untriedMode !== 'untried';
    el.untriedFilter.setAttribute('aria-pressed', String(state.untriedMode === 'untried'));
    el.chipDivider.hidden = el.gongfuFilter.hidden && el.refillFilter.hidden && el.untriedFilter.hidden && el.triedFilter.hidden;
    el.refillFilter.setAttribute('aria-pressed', String(state.refillOnly));
  }

  function chip(groupKey, label, color, pressed) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('data-group', groupKey);
    b.setAttribute('aria-pressed', String(pressed));
    if (groupKey) {
      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = color || 'var(--muted)';
      b.appendChild(dot);
    }
    b.appendChild(document.createTextNode(label));
    return b;
  }

  function renderCount() {
    var filled = state.teas.filter(hasContent);
    var text = teaCount(filled.length);
    if (anyFilter() || searchTerms().length) {
      text = filled.filter(passesFilters).length + ' of ' + text;
    } else {
      var gongfu = filled.filter(function (tea) { return tea.values.gongfu; }).length;
      if (gongfu) text += ' · ' + gongfu + ' for gong fu';
      var refill = filled.filter(function (tea) { return tea.values.fyllpa; }).length;
      if (refill) text += ' · ' + refill + ' to refill';
      var untried = filled.filter(function (tea) { return tea.values.untried; }).length;
      if (untried) text += ' · ' + untried + ' untried';
    }
    el.count.textContent = text;
  }

  function renderCard(card, tea, index, canEdit) {
    var expanded = state.expanded === index;
    card.classList.toggle('expanded', expanded);
    card.querySelector('.summary').setAttribute('aria-expanded', String(expanded));
    card.querySelector('.details').hidden = !expanded;
    renderSummary(card, tea);

    Array.prototype.forEach.call(card.querySelectorAll('input[data-key]'), function (input) {
      var value = tea.values[input.getAttribute('data-key')] || '';
      if (input.value !== value) input.value = value;
      setFlag(input, 'disabled', !state.note);
      setFlag(input, 'readOnly', state.locked);
    });

    Array.prototype.forEach.call(card.querySelectorAll('[data-flag]'), function (check) {
      setFlag(check, 'checked', Boolean(tea.values[check.getAttribute('data-flag')]));
      setFlag(check, 'disabled', !canEdit);
    });

    renderSuggestions(card, tea, canEdit);

    // Visa eller ändra: fälten, valknapparna och Ta bort te bara när man ändrar.
    var editing = expanded && state.editing && canEdit;
    card.classList.toggle('editing', editing);
    card.querySelector('.edit-fields').hidden = !editing;
    // Gong fu ändras sällan och hör till Ändra; Fyll på kan man bocka i direkt.
    card.querySelector('.toggle-gongfu').hidden = !editing;
    card.querySelector('[data-action="edit"]').hidden = !canEdit || editing;

    var remove = card.querySelector('[data-action="remove"]');
    var confirming = state.confirmIndex === index;
    remove.hidden = !editing;
    remove.textContent = confirming ? 'Tap again to remove' : 'Remove tea';
    remove.classList.toggle('confirm', confirming);
  }

  /** Sätter en egenskap bara när den faktiskt ändras. */
  function setFlag(node, name, value) {
    if (node[name] !== value) node[name] = value;
  }

  /**
   * Den ihopfällda raden: namn, land och gong fu och under dem smaken till vänster,
   * temperatur och bryggtid till höger.
   */
  function renderSummary(card, tea) {
    var g = groupFor(tea.values.sort);
    card.style.setProperty('--sort', g.color || 'transparent');

    var title = card.querySelector('.s-title');
    var name = oneLine(tea.values.namn);
    title.textContent = name || (hasContent(tea) ? 'Unnamed tea' : 'New tea');
    title.classList.toggle('placeholder', !name);

    // Sorten står i gruppens rubrik; den syns i raden bara om den har ändrats sedan dess.
    var section = card.closest('.group');
    var meta = [];
    var sortText = oneLine(tea.values.sort);
    var split = splitSort(sortText);
    if (sortText && section && section.getAttribute('data-group') !== g.key) {
      meta.push(split && split.variant ? capitalize(sortText) : g.label);
    } else if (split && split.variant) {
      meta.push(capitalize(split.variant));
    }
    meta.push(oneLine(tea.values.land), oneLine(tea.values.butik));
    var metaText = meta.filter(Boolean).join(' · ');
    card.querySelector('.s-meta').textContent = metaText;
    card.querySelector('.s-gongfu').hidden = !tea.values.gongfu;
    card.querySelector('.s-refill').hidden = !tea.values.fyllpa;
    card.querySelector('.s-untried').hidden = !tea.values.untried;
    card.querySelector('.s-sub').hidden = !metaText && !tea.values.gongfu && !tea.values.fyllpa && !tea.values.untried;
    card.querySelector('.s-taste').textContent = tasteWords(tea.values.smak).join(', ');

    card.querySelector('.s-temp').textContent = formatTemp(tea.values.temperatur);
    card.querySelector('.s-time').textContent = formatTime(tea.values.bryggtid);
    // Bryggschemat syns i det utfällda teet när det passar för gong fu.
    var brew = card.querySelector('.brew');
    brew.hidden = !tea.values.gongfu;
    card.querySelector('.brew-hint').hidden = !tea.values.gongfu;
    if (tea.values.gongfu) renderBrew(brew, scheduleName(tea));

    // Timerknapparna överst i det utfällda teet: gong fu och vanlig bryggning.
    var western = parseBrewTime(tea.values.bryggtid);
    var gongfuBtn = card.querySelector('[data-action="timer-gongfu"]');
    var westernBtn = card.querySelector('[data-action="timer-western"]');
    gongfuBtn.hidden = !tea.values.gongfu;
    westernBtn.hidden = !western;
    if (western) westernBtn.querySelector('.timer-btn-label').textContent = rangeText(western.lo, western.hi);
    card.querySelector('.brew-bar').hidden = gongfuBtn.hidden && westernBtn.hidden;
  }

  /** Vitt te har ett eget gong fu-schema. */
  function scheduleName(tea) {
    return groupFor(tea.values.sort).key === 'k:white' ? 'white' : 'standard';
  }

  /**
   * Fyller schemat; byggs bara om när det byter schema (t.ex. när sorten blir Vitt).
   * Varje rad har sitt steg (0 = sköljning), så att ett tryck startar timern där.
   */
  function renderBrew(table, name) {
    if (table.getAttribute('data-schedule') === name) return;
    table.setAttribute('data-schedule', name);
    var schedule = BREW_SCHEDULES[name];
    table.querySelector('caption').textContent = schedule.title;
    var body = table.querySelector('tbody');
    body.textContent = '';
    var rows = [['First rinse', schedule.rinse.note, secText(schedule.rinse.lo, schedule.rinse.hi)]];
    schedule.infusions.forEach(function (r, i) { rows.push(['Infusion ' + (i + 1), '', secText(r[0], r[1])]); });
    rows.push(['Infusion ' + (schedule.infusions.length + 1) + '+', '', '+' + schedule.extra + ' sec per extra infusion']);
    rows.forEach(function (row, step) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-step', String(step));
      tr.title = 'Start the timer here';
      var th = document.createElement('th');
      th.scope = 'row';
      th.textContent = row[0];
      if (row[1]) {
        var note = document.createElement('span');
        note.className = 'brew-note';
        note.textContent = row[1];
        th.appendChild(document.createTextNode(' '));
        th.appendChild(note);
      }
      var td = document.createElement('td');
      td.textContent = row[2];
      tr.appendChild(th);
      tr.appendChild(td);
      body.appendChild(tr);
    });
  }

  /** "10–15 sec", eller "10 sec" när kortast och längst är samma. */
  function secText(lo, hi) {
    return (lo === hi ? lo : lo + '–' + hi) + ' sec';
  }

  /**
   * Förslagsknapparna. Sort, temperatur och bryggtid visar alla knappar med den valda
   * markerad; smak markerar alla ord som finns i fältet; land visar de som börjar på det
   * man har skrivit, som fraktbolagen i NWO; butik visar dina butiker med den valda markerad.
   */
  function renderSuggestions(card, tea, canEdit) {
    suggest(card, 'sort', canEdit, SORTS.map(function (s) { return s.label; }), function (option, value) {
      var known = knownSort(value);
      return known ? known.label === option : false;
    }, true);
    var sameNumber = function (option, value) { return normalizeNumber(value) === option; };
    suggest(card, 'temperatur', canEdit, TEMPS, sameNumber, true);
    suggest(card, 'bryggtid', canEdit, TIMES, sameNumber, true);
    suggest(card, 'land', canEdit, COUNTRIES, null, false);
    suggest(card, 'butik', canEdit, shopOptions(tea), function (option, value) {
      return option.toLowerCase() === oneLine(value).toLowerCase();
    }, true);
    suggest(card, 'smak', canEdit, TASTES, function (option, value) { return hasTaste(value, option); }, true);
  }

  /**
   * Butikerna att välja bland: de fasta först, sedan de som skrivits in på andra teer i
   * anteckningen, flest teer först. Teet man redigerar räknas inte, så att det man håller på
   * att skriva inte blir en knapp.
   */
  function shopOptions(current) {
    var seen = {};
    var counts = {};
    var extra = [];
    SHOPS.forEach(function (name) { seen[name.toLowerCase()] = true; });
    state.teas.forEach(function (tea) {
      if (tea === current || !hasContent(tea)) return;
      var name = oneLine(tea.values.butik);
      var key = name.toLowerCase();
      if (!name) return;
      counts[key] = (counts[key] || 0) + 1;
      if (seen[key]) return;
      seen[key] = true;
      extra.push(name);
    });
    extra.sort(function (a, b) {
      return counts[b.toLowerCase()] - counts[a.toLowerCase()] || a.localeCompare(b, 'en');
    });
    return SHOPS.concat(extra);
  }

  /** Texten på en förslagsknapp: 95°, 2–3 min, annars som den står. */
  function suggestionLabel(key, name) {
    if (key === 'temperatur') return name + '°';
    if (key === 'bryggtid') return name.replace('-', '–') + ' min';
    return name;
  }

  function suggest(card, key, canEdit, options, isSelected, showAll) {
    var box = card.querySelector('[data-suggest="' + key + '"]');
    var value = oneLine(card.querySelector('[data-key="' + key + '"]').value);
    var typed = value.toLowerCase();
    var names = !canEdit ? [] : options.filter(function (name) {
      if (showAll) return true;
      var lower = name.toLowerCase();
      return !typed || (lower.indexOf(typed) === 0 && lower !== typed);
    });
    var pressed = names.map(function (name) { return Boolean(isSelected && isSelected(name, value)); });
    var shown = names.map(function (name, i) { return name + (pressed[i] ? '*' : ''); }).join('|');
    if (box.getAttribute('data-shown') === shown) return;
    box.setAttribute('data-shown', shown);
    box.textContent = '';
    names.forEach(function (name, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'suggestion';
      b.setAttribute('data-value', name);
      if (isSelected) b.setAttribute('aria-pressed', String(pressed[i]));
      if (key === 'sort') {
        var dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = SORTS[i].color;
        b.appendChild(dot);
      }
      b.appendChild(document.createTextNode(suggestionLabel(key, name)));
      box.appendChild(b);
    });
  }

  function setSaveState(label, kind) {
    el.saveState.textContent = label;
    el.saveState.className = 'save-state' + (kind ? ' ' + kind : '');
  }

  // ---------- Fristående läge ----------

  function loadText() {
    if (NATIVE) return nativeGet(TEXT_KEY) || '';
    try { return window.localStorage.getItem(TEXT_KEY) || ''; } catch (e) { return ''; }
  }

  function storeText(text) {
    if (NATIVE) {
      nativeSet(TEXT_KEY, text);
      return;
    }
    try { window.localStorage.setItem(TEXT_KEY, text); } catch (e) { setSaveState('Can’t save', 'error'); }
  }

  /** Appen håller skärmen tänd medan timern är öppen (finns bara i Te-appen). */
  function nativeKeepScreenOn(on) {
    try { if (NATIVE && NATIVE.keepScreenOn) NATIVE.keepScreenOn(Boolean(on)); } catch (e) { /* stöds inte */ }
  }

  function startStandalone() {
    state.connected = true;
    document.documentElement.classList.add('standalone');
    el.textToggle.hidden = false;
    setSaveState('', '');
    reloadPrefs();
    onNote({ uuid: 'standalone', content: { text: loadText(), appData: {} } });
  }

  // Text-panelen: hela listan som text, för att flytta den mellan appen och Standard Notes.
  function openTextPanel() {
    var any = state.teas.some(hasContent) || state.rest;
    el.textArea.value = any ? serialize(state.teas, state.rest) : '';
    el.textCopy.textContent = 'Copy all';
    el.textPanel.hidden = false;
    document.body.classList.add('timer-open');
  }

  function closeTextPanel() {
    el.textPanel.hidden = true;
    document.body.classList.remove('timer-open');
    el.textToggle.focus();
  }

  /** Ersätter hela listan med texten i panelen. */
  function applyText(text) {
    var parsed = parse(text);
    state.teas = parsed.teas;
    state.rest = parsed.rest;
    state.expanded = -1;
    state.frozen = null;
    state.editing = false;
    if (!state.teas.some(hasContent)) {
      if (!state.teas.length) state.teas.push(emptyTea());
      expand(0);
      state.editing = true;
    }
    resetConfirm();
    render();
    save();
    el.page.scrollTop = 0;
  }

  function copyText(text) {
    try {
      if (NATIVE && NATIVE.copy) {
        NATIVE.copy(text);
        return true;
      }
    } catch (e) { /* försök på annat sätt */ }
    try {
      el.textArea.focus();
      el.textArea.select();
      if (document.execCommand('copy')) return true;
    } catch (e) { /* försök på annat sätt */ }
    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* går inte */ }
    return false;
  }

  el.textToggle.addEventListener('click', openTextPanel);
  el.textClose.addEventListener('click', closeTextPanel);
  el.textSave.addEventListener('click', function () {
    applyText(el.textArea.value);
    closeTextPanel();
  });
  el.textCopy.addEventListener('click', function () {
    el.textCopy.textContent = copyText(el.textArea.value) ? 'Copied' : 'Select and copy it yourself';
  });
  el.textPanel.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTextPanel();
    }
  });

  /**
   * Androids tillbakaknapp (anropas av appen): stäng timern eller Text-panelen, töm sökningen
   * eller fäll ihop teet. Returnerar false när det inte finns något att stänga (då avslutas appen).
   */
  window.teBack = function () {
    if (timer) {
      closeTimer();
      return true;
    }
    if (!el.textPanel.hidden) {
      closeTextPanel();
      return true;
    }
    if (state.expanded >= 0) {
      collapseAndShow(state.expanded);
      return true;
    }
    if (state.search) {
      clearSearch();
      return true;
    }
    return false;
  };

  // ---------- Timer ----------
  //
  // Gong fu: stegar genom schemat (sköljning, infusion 1–5, sedan +10 s per infusion).
  // Vanlig bryggning: ett steg med teets bryggtid. Timern räknar ner till den kortaste tiden
  // i intervallet; vid noll är det dags att hälla (ljud och vibration), och sedan räknas
  // sekunderna uppåt: grönt så länge man är inom intervallet, orange efter det. Tiden räknas
  // från klockan och inte från antalet tick, så den stämmer även om webbläsaren saktar ner.
  // Pipen bokas in i ljudsystemet redan när timern startar: med låst skärm saktar telefonen
  // ner JavaScript (tick kan komma 20 sekunder sent), men ljudet spelas ändå i tid. En
  // ohörbar ton håller ljudsystemet igång medan timern går; annars kan telefonen frysa dess
  // klocka när skärmen är släckt, och då spelas inget. Hinner ljudklockan ändå inte fram
  // piper timern direkt när tick kommer (reserv), så att pipet aldrig uteblir helt.
  // På iPhone spelas dessutom en tyst ljudfil, annars tystar ljudlöst läge allt.
  // Inget av detta sparas i anteckningen.

  var SOUND_KEY = 'se.jagemyr.te.ljud';
  var TICK_MS = 200;
  var OVERTIME_STOP = 600;
  var CIRCUMFERENCE = 2 * Math.PI * 90;

  var tm = {
    root: document.getElementById('timer'),
    tea: document.getElementById('timer-tea'),
    temp: document.getElementById('timer-temp'),
    tempValue: document.getElementById('timer-temp-value'),
    step: document.getElementById('timer-step'),
    note: document.getElementById('timer-note'),
    time: document.getElementById('timer-time'),
    status: document.getElementById('timer-status'),
    main: document.getElementById('timer-main'),
    prev: document.getElementById('timer-prev'),
    next: document.getElementById('timer-next'),
    close: document.getElementById('timer-close'),
    sound: document.getElementById('timer-sound'),
    steps: document.getElementById('timer-steps'),
    ringWindow: document.getElementById('ring-window'),
    ringProgress: document.getElementById('ring-progress')
  };

  var timer = null;
  var tickHandle = null;
  var audio = null;
  var wakeLock = null;
  var signalCount = 0;
  var soundOn = loadPref(SOUND_KEY) !== '0';
  // iPhone och iPad (iPadOS säger att den är en Mac men har pekskärm).
  var IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var silentEl = null;

  function openTimer(tea, kind, index) {
    var western = parseBrewTime(tea.values.bryggtid);
    if (kind === 'western' && !western) return;
    timer = {
      name: oneLine(tea.values.namn) || 'Tea',
      // Vattentemperaturen, som "90–95 °C"; visas ovanför ringen.
      temp: formatTemp(tea.values.temperatur),
      kind: kind,
      schedule: BREW_SCHEDULES[scheduleName(tea)],
      western: western,
      index: kind === 'western' ? 0 : Math.max(0, index || 0),
      elapsed: 0,
      startedAt: 0,
      running: false,
      firedLo: false,
      firedHi: false,
      // Pip som redan är inbokade i ljudsystemet för det här steget.
      booked: [],
      bookedLo: false,
      bookedHi: false,
      // Ljudklockans tid för de inbokade pipen, för att se om de faktiskt har spelats.
      bookedLoAt: 0,
      bookedHiAt: 0,
      // När pipen bokades, i vanlig tid och i ljudklockans tid, och ljudklockan vid förra
      // ticket. Visar om ljudklockan har gått som den ska eller stått still.
      bookWall: 0,
      bookAudio: 0,
      lastAudio: 0,
      // Den ohörbara tonen som håller ljudsystemet igång medan timern går.
      keepAlive: null,
      opener: document.activeElement
    };
    unlockAudio();
    tm.root.hidden = false;
    document.body.classList.add('timer-open');
    nativeKeepScreenOn(true);
    clearInterval(tickHandle);
    tickHandle = setInterval(timerTick, TICK_MS);
    renderTimer();
    tm.main.focus();
  }

  function closeTimer() {
    if (!timer) return;
    var opener = timer.opener;
    cancelBeeps();
    stopKeepAlive();
    timer = null;
    clearInterval(tickHandle);
    tickHandle = null;
    releaseWakeLock();
    stopSilent();
    nativeKeepScreenOn(false);
    tm.root.hidden = true;
    document.body.classList.remove('timer-open');
    if (opener && document.body.contains(opener) && opener.focus) opener.focus();
  }

  /** Steg `index` i timern: { label, note, lo, hi } i sekunder. */
  function timerStep(index) {
    if (timer.kind === 'western') return { label: 'Western brewing', note: '', lo: timer.western.lo, hi: timer.western.hi };
    var s = timer.schedule;
    if (index === 0) return { label: 'First rinse', note: s.rinse.note, lo: s.rinse.lo, hi: s.rinse.hi };
    if (index <= s.infusions.length) {
      var r = s.infusions[index - 1];
      return { label: 'Infusion ' + index, note: '', lo: r[0], hi: r[1] };
    }
    var last = s.infusions[s.infusions.length - 1];
    var add = (index - s.infusions.length) * s.extra;
    return { label: 'Infusion ' + index, note: '+' + s.extra + ' sec per extra infusion', lo: last[0] + add, hi: last[1] + add };
  }

  function timerElapsed() {
    return timer.elapsed + (timer.running ? (Date.now() - timer.startedAt) / 1000 : 0);
  }

  function startTimer() {
    unlockAudio();
    timer.running = true;
    timer.startedAt = Date.now();
    startKeepAlive();
    bookBeeps();
    requestWakeLock();
    renderTimer();
  }

  function pauseTimer() {
    timer.elapsed = timerElapsed();
    timer.running = false;
    cancelBeeps();
    stopKeepAlive();
    renderTimer();
  }

  function goToStep(index, autostart) {
    cancelBeeps();
    if (!autostart) stopKeepAlive();
    timer.index = timer.kind === 'western' ? 0 : Math.max(0, index);
    timer.elapsed = 0;
    timer.running = false;
    timer.firedLo = false;
    timer.firedHi = false;
    if (autostart) startTimer(); else renderTimer();
  }

  /** Läget just nu: brew (före kortaste tiden), window (inom intervallet), over (efter). */
  function timerPhase(step, elapsed) {
    if (elapsed < step.lo) return 'brew';
    if (elapsed <= step.hi) return 'window';
    return 'over';
  }

  function timerTick() {
    if (!timer) return;
    if (timer.running) {
      var step = timerStep(timer.index);
      var e = timerElapsed();
      // Har ljudklockan stått still en stund men går nu igen ligger pipen för sent; boka om
      // dem. Står den fortfarande still hjälper det inte, och då väntar vi på reservpipet.
      if (audio) {
        var moving = audio.currentTime > timer.lastAudio + 0.001;
        timer.lastAudio = audio.currentTime;
        if (moving && (lagging(timer.bookedLo && !timer.firedLo, timer.bookedLoAt, step.lo, e) ||
                       lagging(timer.bookedHi && !timer.firedHi, timer.bookedHiAt, step.hi, e))) {
          bookBeeps();
        }
      }
      if (!timer.firedLo && e >= step.lo) {
        timer.firedLo = true;
        signal(true);
      }
      if (!timer.firedHi && step.hi > step.lo && e >= step.hi) {
        timer.firedHi = true;
        signal(false);
      }
      // Glömd timer: stanna efter tio minuter över tiden.
      if (e > step.hi + OVERTIME_STOP) pauseTimer();
    }
    renderTimer();
  }

  /** Ligger ett inbokat pip mer än en halv sekund senare i ljudklockan än det borde? */
  function lagging(booked, at, target, elapsed) {
    return booked && elapsed < target && (at - audio.currentTime) - (target - elapsed) > 0.5;
  }

  /**
   * Har det inbokade pipet vid ljudklockans tid `at` hörts? Ja om ljudsystemet går, dess klocka
   * har nått pipet och har gått lika långt som den vanliga klockan sedan pipen bokades. Stod
   * ljudklockan still (släckt skärm) har pipet inte spelats, hur nära det än ser ut att vara.
   */
  function bookedHeard(at) {
    if (!audio || audio.state !== 'running') return false;
    var audioProgress = audio.currentTime - timer.bookAudio;
    var wallProgress = (Date.now() - timer.bookWall) / 1000;
    return audio.currentTime >= at - 0.25 && audioProgress >= wallProgress - 0.5;
  }

  /** Huvudknappen: Starta, Paus, Fortsätt, och efter nolltid Starta nästa infusion (eller Klar). */
  function mainAction() {
    var step = timerStep(timer.index);
    var phase = timerPhase(step, timerElapsed());
    if (phase !== 'brew') {
      if (timer.kind === 'western') closeTimer(); else goToStep(timer.index + 1, true);
    } else if (timer.running) {
      pauseTimer();
    } else {
      startTimer();
    }
  }

  function mainLabel(step, phase, elapsed) {
    if (phase !== 'brew') return timer.kind === 'western' ? 'Done' : 'Start ' + timerStep(timer.index + 1).label.toLowerCase();
    if (timer.running) return 'Pause';
    return elapsed > 0 ? 'Resume' : 'Start';
  }

  /** Sekunder som "12" eller, när steget är minst en minut, "1:05". */
  function clock(seconds, minutes) {
    if (!minutes) return String(seconds);
    return Math.floor(seconds / 60) + ':' + pad2(seconds % 60);
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function renderTimer() {
    if (!timer) return;
    var step = timerStep(timer.index);
    var e = timerElapsed();
    var phase = timerPhase(step, e);
    var minutes = step.hi >= 60;

    tm.tea.textContent = timer.name;
    tm.temp.hidden = !timer.temp;
    if (tm.tempValue.textContent !== timer.temp) tm.tempValue.textContent = timer.temp;
    tm.step.textContent = step.label;
    tm.note.textContent = step.note;
    tm.note.hidden = !step.note;

    var text;
    if (phase === 'brew') text = clock(Math.max(0, Math.ceil(step.lo - e - 1e-6)), minutes);
    else text = '+' + clock(Math.floor(e - step.lo), minutes);
    if (tm.time.textContent !== text) tm.time.textContent = text;

    var status;
    // Hårt mellanslag före enheten, så att "s" eller "min" inte hamnar ensamt på en rad.
    var range = rangeText(step.lo, step.hi).replace(/ (s|min)$/, '\u00a0$1');
    if (phase === 'window') status = 'Pour now';
    else if (phase === 'over') status = 'Over time (' + range + ')';
    else if (timer.running) status = 'Brewing · pour after ' + range;
    else if (e > 0) status = 'Paused';
    else status = 'Pour after ' + range + '. Tap Start when the water is in.';
    if (tm.status.textContent !== status) tm.status.textContent = status;

    ['brew', 'window', 'over'].forEach(function (p) { tm.root.classList.toggle('phase-' + p, p === phase); });
    tm.root.classList.toggle('running', timer.running);

    // Ringen: hela varvet är den längsta tiden; den gröna biten är intervallet.
    var start = step.hi ? step.lo / step.hi : 1;
    tm.ringWindow.style.strokeDasharray = ((1 - start) * CIRCUMFERENCE) + ' ' + CIRCUMFERENCE;
    tm.ringWindow.style.strokeDashoffset = String(-start * CIRCUMFERENCE);
    var fraction = step.hi ? Math.min(e / step.hi, 1) : 1;
    tm.ringProgress.style.strokeDasharray = (fraction * CIRCUMFERENCE) + ' ' + CIRCUMFERENCE;

    tm.main.textContent = mainLabel(step, phase, e);
    var gongfu = timer.kind === 'gongfu';
    tm.prev.hidden = !gongfu;
    tm.next.hidden = !gongfu;
    tm.prev.disabled = timer.index === 0;
    tm.sound.setAttribute('aria-pressed', String(soundOn));
    renderTimerSteps(gongfu);
  }

  /** Stegknapparna under timern: Skölj, 1–5 och 6+. */
  function renderTimerSteps(gongfu) {
    tm.steps.hidden = !gongfu;
    if (!gongfu) return;
    var count = timer.schedule.infusions.length;
    if (tm.steps.children.length !== count + 2) {
      tm.steps.textContent = '';
      for (var i = 0; i <= count + 1; i++) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'timer-chip';
        b.setAttribute('data-step', String(i));
        b.textContent = i === 0 ? 'Rinse' : i > count ? count + 1 + '+' : String(i);
        tm.steps.appendChild(b);
      }
    }
    Array.prototype.forEach.call(tm.steps.children, function (b, i) {
      var current = i === timer.index || (i === count + 1 && timer.index > count);
      b.setAttribute('aria-pressed', String(current));
      b.classList.toggle('done', i < timer.index && !current);
    });
  }

  // ---------- Signal: ljud, vibration och en blink ----------

  function unlockAudio() {
    // iPhone: ljud från Web Audio räknas annars som "omgivningsljud" och tystas helt när
    // telefonen står på ljudlöst. Säg att vi spelar ljud på riktigt (nyare iOS) ...
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) { /* stöds inte */ }
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!audio && Ctx) audio = new Ctx();
      if (audio && audio.state === 'suspended') audio.resume();
    } catch (e) {
      audio = null;
    }
    // ... och spela en tyst ljudfil medan timern är öppen (äldre iOS). Ett <audio>-element
    // byter iOS ljudläge till uppspelning, och då hörs även Web Audio med ljudlöst på.
    if (IS_IOS) playSilent();
  }

  /** Den tysta ljudfilen: 0,5 s tystnad som WAV, byggd här så att ingen fil behövs. */
  function silentWav() {
    var samples = 4000;
    var bytes = new Uint8Array(44 + samples);
    var view = new DataView(bytes.buffer);
    var text = function (offset, str) {
      for (var i = 0; i < str.length; i++) bytes[offset + i] = str.charCodeAt(i);
    };
    text(0, 'RIFF');
    view.setUint32(4, 36 + samples, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 8000, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    text(36, 'data');
    view.setUint32(40, samples, true);
    for (var j = 0; j < samples; j++) bytes[44 + j] = 128;
    var binary = '';
    for (var k = 0; k < bytes.length; k++) binary += String.fromCharCode(bytes[k]);
    return 'data:audio/wav;base64,' + btoa(binary);
  }

  function playSilent() {
    if (!soundOn) return;
    try {
      if (!silentEl) {
        silentEl = document.createElement('audio');
        silentEl.src = silentWav();
        silentEl.loop = true;
        silentEl.preload = 'auto';
        silentEl.setAttribute('playsinline', '');
        silentEl.setAttribute('x-webkit-airplay', 'deny');
      }
      var playing = silentEl.play();
      if (playing && playing.catch) playing.catch(function () { /* blockerat; försöker igen vid nästa tryck */ });
      tm.root.setAttribute('data-silent', '1');
    } catch (e) { /* inget <audio> */ }
  }

  function stopSilent() {
    if (!silentEl) return;
    try { silentEl.pause(); } catch (e) { /* redan pausad */ }
    tm.root.setAttribute('data-silent', '0');
  }

  /** Spelar `times` korta pip med start `delay` sekunder från nu. Returnerar noderna. */
  function beep(times, frequency, delay) {
    var nodes = [];
    if (!soundOn || !audio) return nodes;
    try {
      var t0 = audio.currentTime + Math.max(0.02, delay || 0);
      for (var i = 0; i < times; i++) {
        var osc = audio.createOscillator();
        var gain = audio.createGain();
        var t = t0 + i * 0.28;
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        osc.connect(gain);
        gain.connect(audio.destination);
        osc.start(t);
        osc.stop(t + 0.22);
        nodes.push({ osc: osc, gain: gain });
      }
    } catch (e) {
      // Inget ljud; blinken och vibrationen räcker.
    }
    return nodes;
  }

  /**
   * Bokar in pipen för steget i ljudsystemet: starkt vid kortaste tiden, svagt vid den
   * längsta. Då kommer de i tid även när telefonen är låst och JavaScript går långsamt.
   */
  function bookBeeps() {
    cancelBeeps();
    if (!timer || !timer.running || !soundOn || !audio) return;
    var step = timerStep(timer.index);
    var e = timerElapsed();
    timer.bookWall = Date.now();
    timer.bookAudio = audio.currentTime;
    timer.lastAudio = audio.currentTime;
    if (!timer.firedLo && e < step.lo) {
      var strong = beep(3, 880, step.lo - e);
      timer.booked = timer.booked.concat(strong);
      timer.bookedLo = strong.length > 0;
      timer.bookedLoAt = audio.currentTime + (step.lo - e);
    }
    if (!timer.firedHi && step.hi > step.lo && e < step.hi) {
      var weak = beep(1, 587, step.hi - e);
      timer.booked = timer.booked.concat(weak);
      timer.bookedHi = weak.length > 0;
      timer.bookedHiAt = audio.currentTime + (step.hi - e);
    }
    tm.root.setAttribute('data-booked', String(timer.booked.length));
  }

  /** Avbokar inbokade pip (vid paus, byte av steg, ljud av och när timern stängs). */
  function cancelBeeps() {
    if (!timer) return;
    timer.booked.forEach(function (node) {
      try { node.gain.disconnect(); } catch (e) { /* redan frånkopplad */ }
      try { node.osc.stop(0); } catch (e) { /* redan stoppad */ }
    });
    timer.booked = [];
    timer.bookedLo = false;
    timer.bookedHi = false;
    timer.bookedLoAt = 0;
    timer.bookedHiAt = 0;
    tm.root.setAttribute('data-booked', '0');
  }

  /**
   * En ohörbar ton (40 Hz, −60 dB) medan timern går. Den håller telefonens ljudsystem
   * igång med släckt skärm, så att ljudklockan går och de inbokade pipen spelas.
   */
  function startKeepAlive() {
    if (!timer || timer.keepAlive || !soundOn || !audio) return;
    try {
      var osc = audio.createOscillator();
      var gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = 40;
      gain.gain.value = 0.001;
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start();
      timer.keepAlive = { osc: osc, gain: gain };
      tm.root.setAttribute('data-keepalive', '1');
    } catch (e) {
      timer.keepAlive = null;
    }
  }

  function stopKeepAlive() {
    if (!timer || !timer.keepAlive) return;
    try { timer.keepAlive.gain.disconnect(); } catch (e) { /* redan frånkopplad */ }
    try { timer.keepAlive.osc.stop(); } catch (e) { /* redan stoppad */ }
    timer.keepAlive = null;
    tm.root.setAttribute('data-keepalive', '0');
  }

  /** Stark signal när det är dags att hälla, svag när intervallet är slut. */
  function signal(strong) {
    signalCount++;
    tm.root.setAttribute('data-signals', String(signalCount));
    // Pip bara här om det inbokade inte har hörts. Det har hörts om ljudsystemet går och dess
    // klocka har hunnit fram till pipet; annars (frusen klocka med släckt skärm) piper vi nu
    // och avbokar det gamla, så att det inte kommer sent ovanpå.
    var booked = timer && (strong ? timer.bookedLo : timer.bookedHi);
    var at = timer ? (strong ? timer.bookedLoAt : timer.bookedHiAt) : 0;
    var heard = booked && bookedHeard(at);
    if (!heard) {
      if (booked) cancelBeeps();
      unlockAudio();
      beep(strong ? 3 : 1, strong ? 880 : 587);
      tm.root.setAttribute('data-live-beeps', String(Number(tm.root.getAttribute('data-live-beeps') || 0) + 1));
      // Boka om det som är kvar (det svaga pipet när intervallet är slut).
      if (booked && timer && timer.running) bookBeeps();
    }
    try {
      if (navigator.vibrate) navigator.vibrate(strong ? [200, 100, 200] : 150);
    } catch (e) { /* ingen vibration */ }
    tm.root.classList.remove('flash');
    void tm.root.offsetWidth;
    tm.root.classList.add('flash');
  }

  // Skärmen ska inte slockna medan timern går (där webbläsaren tillåter det).
  function requestWakeLock() {
    try {
      if (!navigator.wakeLock || wakeLock) return;
      navigator.wakeLock.request('screen').then(function (lock) {
        wakeLock = lock;
        lock.addEventListener('release', function () { wakeLock = null; });
      }).catch(function () { /* inte tillåtet i den här webbvyn */ });
    } catch (e) { /* inte tillåtet */ }
  }

  function releaseWakeLock() {
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* redan släppt */ }
    wakeLock = null;
  }

  document.addEventListener('visibilitychange', function () {
    if (!timer) return;
    // Se till att ljudsystemet går, både när skärmen släcks och när den tänds igen.
    if (timer.running && audio && audio.state !== 'running') {
      try { audio.resume(); } catch (e) { /* tillåts inte nu */ }
    }
    if (!document.hidden) {
      if (timer.running) requestWakeLock();
      timerTick();
    }
  });

  tm.main.addEventListener('click', function () { if (timer) mainAction(); });
  tm.prev.addEventListener('click', function () { if (timer && timer.index > 0) goToStep(timer.index - 1, false); });
  tm.next.addEventListener('click', function () { if (timer) goToStep(timer.index + 1, false); });
  tm.close.addEventListener('click', closeTimer);
  tm.sound.addEventListener('click', function () {
    soundOn = !soundOn;
    storePref(SOUND_KEY, soundOn ? '' : '0');
    if (soundOn) {
      unlockAudio();
      beep(1, 880);
      if (timer && timer.running) {
        startKeepAlive();
        bookBeeps();
      }
    } else {
      cancelBeeps();
      stopKeepAlive();
      stopSilent();
    }
    renderTimer();
  });
  tm.steps.addEventListener('click', function (event) {
    var chip = event.target.closest('.timer-chip');
    if (chip && timer) goToStep(Number(chip.getAttribute('data-step')), false);
  });
  tm.root.addEventListener('keydown', function (event) {
    if (!timer) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTimer();
    } else if (event.key === ' ' && event.target === tm.root) {
      event.preventDefault();
      mainAction();
    } else if (event.key === 'ArrowRight' && timer.kind === 'gongfu') {
      event.preventDefault();
      goToStep(timer.index + 1, false);
    } else if (event.key === 'ArrowLeft' && timer.kind === 'gongfu' && timer.index > 0) {
      event.preventDefault();
      goToStep(timer.index - 1, false);
    }
  });

  if (STANDALONE) startStandalone();
})();
