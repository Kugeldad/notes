# Standard Notes-plugins

Egna plugins till [Standard Notes](https://standardnotes.com), publicerade med GitHub Pages på
<https://jagemyr.github.io/notes/>.

## Plugins

| Plugin | Typ | Installationsadress |
|---|---|---|
| Todo | Editor | `https://jagemyr.github.io/notes/todo/ext.json` |
| NWO | Editor | `https://jagemyr.github.io/notes/nwo/ext.json` |
| Te | Editor | `https://jagemyr.github.io/notes/te/ext.json` |
| Testeditor | Editor | `https://jagemyr.github.io/notes/test-editor/ext.json` |

## Todo

- Avbockade uppgifter stryks över och samlas under **Klara** längst ner.
- Välj vem uppgiften gäller. Knapparna överst filtrerar listan per person, och filtret sparas per enhet
  (se *Inställningar per enhet* nedan).
  Nya uppgifter får den person som är vald i filtret.
- **Alla** i Vem-listan betyder hela familjen: uppgiften syns i allas filter och den som gör den bockar av den för alla.
- Personerna heter Pappa, Mamma, Dotter och Son från början. Pennan sist i raden byter namn,
  lägger till eller tar bort personer. **Egna namn sparas i anteckningen** (krypterad i Standard Notes),
  aldrig i koden eller i det här repot.
- Tryck på en uppgift för att ändra text, person, datum och upprepning.
- Upprepning: dagligen, vardagar, varje vecka, varannan vecka, varje månad, varje år.
  En avbockad återkommande uppgift står överstruken tills nästa datum och kommer då tillbaka oavbockad.
- **Rensa** tar bort klara engångsuppgifter (bara de som syns i filtret). Återkommande uppgifter ligger kvar.
- **Deluppgifter:** tryck på en uppgift och lägg till deluppgifter, var och en med egen person.
  Klara deluppgifter stryks över och hamnar längst ner, så att de återstående står överst.
  Huvuduppgiften visar framsteg (t.ex. 2/4 klara) och bockas av automatiskt när alla deluppgifter är klara;
  bockar man av huvuduppgiften bockas alla deluppgifter av. Med ett filter valt syns bara personens egna
  deluppgifter, och när de är klara hamnar uppgiften under Klara för den personen.
  En återkommande huvuduppgift nollställer sina deluppgifter när den kommer tillbaka.
- **Noteringar:** tryck på en uppgift eller deluppgift och skriv i fältet Notering. Noteringen visas under
  uppgiften och sparas som rader som börjar med `>`.
- **E-ink-läge:** knappen **E-ink** bredvid versionen längst ner gör pluginet svart och vitt för e-ink-skärmar
  (som i Te och NWO): svarta ramar, vita fält, inga animationer eller genomskinlighet. Personfärgerna försvinner
  och namnet står i fetstil i stället, den valda personen i filtret står inverterad och försenade datum stryks under.
  Valet gäller den här enheten. Utan val slås läget på av sig självt på svartvita skärmar och Mudita-telefoner.
- **Inställningar per enhet** (filtret och e-ink) sparas i localStorage och också i pluginets data i Standard Notes,
  under en nyckel för enheten (modell och skärmstorlek). Standard Notes på telefonen tömmer pluginets localStorage
  när anteckningen öppnas; valen läses då därifrån i stället.
- **Smal skärm:** under 400 px bredd blir marginalerna mindre, och under 360 px står Vem, Upprepas och Datum under
  varandra så att valen inte kortas av.

Uppgifterna sparas som vanlig text i anteckningen, en per rad, så de går att läsa även i andra editorer:

```
👥 Pappa, Mamma, Dotter, Son
- [ ] Köp mjölk
- [ ] Ta ut soporna 👤 Son 🔁 varje vecka 📅 2026-10-20
- [ ] Städdag 🔁 varje vecka
  - [ ] Dammsuga 👤 Son
  - [x] Handla 👤 Pappa ✅ 2026-10-18
- [ ] Boka tid hos tandläkaren
  > Ring före kl 12.
  > Kom ihåg försäkringskortet.
- [x] Ring tandläkaren ✅ 2026-10-18
```

Raden med 👥 skrivs bara när personerna har ändrats från standard. Rader som inte är uppgifter blir uppgifter när listan sparas.

## NWO

Håll koll på beställningar. En anteckning kan hålla flera beställningar från olika ställen, var och en med
**Företag**, en eller flera **Varor**, **Fraktbolag**, **Trackingnummer**, **Beställd**, **Skickad**,
**Bedömt levdatum**, **Redo att hämtas** med **Hämtställe**, **Levererad** och **Kommentar**.

- Beställningarna visas som en lista. Varje rad visar varorna, företag, fraktbolag och hämtställe, och till höger
  det senaste steget: levererad, redo att hämtas, bedömt levdatum med hur många dagar det är kvar, skickad
  eller beställd.
- Tryck på en beställning för att fälla ut den och ändra fälten. **Klar** fäller ihop den igen.
  En anteckning med bara en beställning visas utfälld direkt.
- **Ny beställning** lägger till en beställning sist i listan.
- **E-ink-läge:** knappen **E-ink** bredvid versionen längst ner gör pluginet svart och vitt för e-ink-skärmar
  (som i Te): svarta ramar, vita fält, inga animationer eller genomskinlighet. Lägesfärgerna blir en svart kant
  till vänster: tunn för beställd, mellan för skickad och tjock för redo att hämtas, och *Redo att hämtas* står
  inverterat. Försenade datum stryks under. Valet gäller den här enheten och sparas både i localStorage och i
  pluginets data i Standard Notes under en nyckel per enhet (telefonen tömmer localStorage). Utan val slås läget
  på av sig självt på svartvita skärmar och Mudita-telefoner. Under 400 px bredd blir marginalerna mindre och
  pilen på raderna försvinner.
- **Kanske:** under beställningarna finns en lista för saker du kanske ska beställa. Skriv i fältet och tryck
  Enter eller **Lägg till**; raderna går att ändra direkt och krysset tar bort. **Beställ** gör raden till en ny
  beställning med saken som vara och dagens datum som Beställd, och fäller ut den så att du kan fylla i resten.
- **Sortera:** dra i greppet (⋮⋮) längst till höger på raden för att flytta en beställning. Det fungerar med
  mus och med fingret, och sidan skrollar när man drar mot kanten. Med tangentbordet: fokus på greppet och
  pil upp eller ner. Beställningar flyttas inom sin lista (På väg eller Levererade), och ordningen sparas som
  ordningen i anteckningens text. Greppet är egna pekarhändelser och inte HTML5 drag-and-drop, som inte
  fungerar med fingret i iOS.
- **Ta bort beställning** frågar en gång till (*Tryck igen för att ta bort*). En tom beställning tas bort direkt.
- Varor: **Lägg till vara** ger en ny rad, och Enter på en vara med text gör samma sak. Enter på en tom rad
  går vidare till Fraktbolag. Krysset tar bort varan. Tomma rader sparas inte.
- **Trackingnummer** står under Fraktbolag, i fast teckenbredd så att det är lätt att läsa av. När det finns ett
  nummer visas **Spåra hos …** under fältet. Länken går till fraktbolagets egen spårningssida för PostNord, DHL,
  Bring, UPS och FedEx (fraktbolaget känns igen på det som står i Fraktbolag), annars till 17TRACK, som känner
  igen de flesta fraktbolag på numret. Bredvid en fraktbolagslänk finns 17TRACK som reserv. Mellanslag i numret
  tas bort i länken. Länken öppnas i ett nytt fönster; i Mac-appen öppnas den i den vanliga webbläsaren.
- **Kommentar** står sist och kan ha flera rader; fältet växer med texten. Första raden syns kursivt i den
  ihopfällda raden i listan.
- **Redo att hämtas:** fyll i datumet (eller tryck **Idag**) när paketet har kommit till en box eller ett
  utlämningsställe, och skriv var i **Hämtställe**. Raden visar *Redo att hämtas*
  och hur länge paketet har väntat. Bocka av beställningen när den är hämtad.
- **Färger:** varje rad har en färgad kant till vänster och statustexten i samma färg efter hur långt
  beställningen har kommit: grå när den är beställd, blå när den är skickad och grön när den är redo att hämtas.
  Bedömt levdatum ändrar inte färgen. Samma färger står som en prick framför datumfälten.
- **Levererad:** bocken framför en vara markerar den som levererad med dagens datum (varan stryks över).
  När alla varor är bockade är beställningen levererad. Bocken framför beställningen bockar av alla varor
  på en gång (eller av dem igen); är bara några varor levererade visar den ett streck och raden *1 av 2 levererade*.
- En levererad beställning tonas ner, fälls ihop och flyttas efter en kort stund till **Levererade** längst ner.
  **Rensa** tar bort alla levererade beställningar efter ett andra tryck.
- Fraktbolag fylls i fritt. Under fältet finns knappar med vanliga fraktbolag (PostNord, DHL, Budbee, Instabox
  med flera) som filtreras efter det man skriver. Det är egna knappar och inte en `<datalist>`, eftersom
  Safaris förslagsfönster kan få en nedtryckt tangent att upprepas i fältet.
- Datumen väljs i en datumväljare. Under varje datum står veckodag och hur långt det är dit eller sedan dess
  (t.ex. *Tisdag 3 november · om 7 dagar*). Beställd, Skickad och Redo att hämtas har en knapp **Idag**.
- Ett passerat bedömt levdatum visas i rött, idag och imorgon i blått (inte när paketet redan har kommit).
- Enter hoppar till nästa fält i samma beställning.
- Anteckningslistan i Standard Notes visar till exempel
  *1 att hämta, 1 på väg, 1 levererad: Skruvdragare +1 (att hämta Paketboxen), Vinterjacka (lev 30 okt)*.

Allt sparas som vanlig text i anteckningen, ett block per beställning med en tom rad emellan och en `Vara:`-rad
per vara, så det går att läsa även i andra editorer. En levererad vara får `✅` och datum efter namnet, och
`Levererad:` fylls i med senaste datumet när alla varor har kommit:

```
Företag: Webbutiken
Vara: Skruvdragare ✅ 2026-10-29
Vara: Bitsats
Fraktbolag: PostNord
Trackingnummer: 00370712345678901234
Beställd: 2026-10-27
Skickad:
Bedömt levdatum: 2026-11-03
Redo att hämtas: 2026-10-30
Hämtställe: Paketboxen vid stationen
Levererad:
Kommentar: Bitsatsen kommer i ett eget paket

Företag: Begagnatsajten
Vara: Vinterjacka ✅ 2026-10-28
Fraktbolag: Budbee
Trackingnummer:
Beställd: 2026-10-25
Skickad: 2026-10-26
Bedömt levdatum: 2026-10-30
Redo att hämtas:
Hämtställe:
Levererad: 2026-10-28
Kommentar:
```

Kanske-listan sparas som ett eget block med en `Kanske:`-rad per sak, efter beställningarna:

```
Kanske: Vinterdäck
Kanske: Ny lampa till hallen
```

En kommentar med flera rader sparas som en `Kommentar:`-rad per rad (tomma rader sparas inte).

Skriver man `Levererad: datum` för hand i en annan editor räknas alla varor i beställningen som levererade.

Anteckningar från tidigare versioner fungerar som de är; en anteckning från version 1 blir en beställning.

Beställningar utan något ifyllt sparas inte. Rader som inte är fält ligger kvar oförändrade, i sin beställning
om de står i ett block med fält, annars sist. Ett datum som skrivits på annat sätt än ÅÅÅÅ-MM-DD behålls och
visas under datumfältet tills ett nytt datum väljs.

## Te

*(The Tea plugin and app are in English from version 2.0.0, so this section is too.)*

A list of teas. Each tea has a **Type**, **Name**, **Temperature**, **Brew time** (western brewing), **Country**,
**Shop**, **Taste** and checkboxes for **Needs refill**, **Not tried yet** and **Good for gong fu**.

- Teas are grouped by type (green, white, yellow, oolong, black, pu-erh, dark, matcha, herbal, rooibos, then
  your own types and finally *No type*) and sorted by name within the group. Each type has its own colour as a
  stripe on the left of the row.
- **Variants** of a type don't get their own group or filter button: *Green, jasmine*, *Black, flavored*,
  *Black, smoked*, *Pu-erh (sheng)* and *Smoked black* all belong to their base type. The variant stays in the
  text, is shown first in the row (e.g. *Jasmine · China · In the Mood for Tea*) and can be searched for, e.g.
  *flavored*, *jasmine* or *sheng*. Choosing another type button keeps the variant (*Green, jasmine* → *White,
  jasmine*).
- A row shows name, country and shop, a green **Gong fu**, an orange **Refill** and a blue **Untried** badge when ticked, the
  taste on its own line below, and temperature and brew time on the right. Long rows are cut short with *…*;
  when a tea is expanded, name, country, shop and taste wrap, so the whole taste profile is visible without
  *Edit* even on a narrow screen.
- Tap a tea to expand it. It first opens without fields: the timer buttons, the *Needs refill* and *Not tried yet*
  checkboxes and the gong fu schedule. **Edit** shows the fields, the choice buttons, *Good for gong fu* and *Remove tea*, so a tap
  while scrolling can't change the type by mistake. A new tea opens straight in edit mode. **Done** collapses it.
  While a tea is expanded it stays in place even if you change its type or name; it moves to the right group
  when it is collapsed.
- **Scroll guard:** a tap on a choice button, a checkbox, *Edit* or *Remove tea* within 0.4 seconds after
  scrolling with a finger (also while the page is still gliding) is ignored. It is usually a tap to stop the
  scroll. The app's own scrolling and ordinary taps are not blocked.
- **New tea** adds a tea. A new tea that is collapsed without anything filled in disappears.
- **Remove tea** asks once more (*Tap again to remove*).
- Type, temperature, brew time and country are free text. Under the fields are buttons with common types,
  temperatures (70–100 degrees), brew times (1–5 minutes) and countries; type, temperature and brew time show the
  chosen button as selected, countries are filtered by what you type. Other spellings of the types (e.g. *green
  tea*, *puerh*, *shou*, or Swedish *grönt*) end up in the right group.
- Temperature is written as a number (`95`) or a range (`80-85`) and shown as *95 °C* or *80–85 °C*. Brew time is
  written the same way in minutes (`3`, `2-3`) and shown as *3 min* or *2–3 min*; other text (e.g. `30 sec`) is
  shown as written. Brew time is for western brewing; gong fu has its own schedule.
- **Shop:** where the tea was bought. Under the field are buttons with *In the Mood for Tea*, *The Tea Centre* and
  the shops written on other teas in the note (most teas first), so a new shop becomes a button on all other teas.
  Search plus **Refill** gives the shopping list for one shop, e.g. *tea centre*.
- **Taste:** taste words separated by commas, e.g. *honey, peach, floral*. Under the field are buttons with
  common words (floral, fruity, citrus, honey, sweet, nutty, roasted, smoky, malty, earthy, woody, grassy,
  mineral, spicy). A tap adds the word at the end, another tap removes it; words in the field are shown as
  selected. Your own words are typed straight into the field and stay.
- **Gong fu:** when ticked, a brew schedule is shown: first rinse (poured away), infusion 1–5 and +10 seconds for
  each infusion after the fifth. **White tea** (type White) has its own schedule with longer steeps (infusion 1 is
  20–30 seconds, rising to 40–50 seconds at the fifth), and the rinse can be skipped. The schedule switches as soon
  as the type changes. The schedules live in the code (`BREW_SCHEDULES` in `te.js`) and are not saved in the note.
- **Search:** the field at the top searches name, type (including variants such as *flavored*), country, shop and taste. Every word must be found in the
  tea, so *honey taiwan* finds Taiwanese teas that taste of honey. Case, accents and hyphens don't matter
  (*puerh* finds *Pu-erh*). Search combines with the filters, is cleared with the cross or Escape, and is not saved.
- **Timer:** at the top of an expanded tea are **Gong fu timer** (when gong fu is ticked) and a button with the
  tea's brew time for western brewing (e.g. *2–3 min*). You can also tap a step in the gong fu schedule to start
  there. The water temperature is shown above the ring (e.g. *90–95 °C*). The timer counts down to the shortest
  time in the range. At zero it is time to pour: sound, vibration (where the phone can) and *Pour now*. Then the
  seconds count up, green while inside the range and orange after it. In gong fu the big button starts the next
  infusion straight away (*Start infusion 2*), and after infusion 5 ten seconds are added per infusion. White tea
  follows its own schedule. The step buttons (Rinse, 1–5, 6+) and the arrows jump between steps, the bell turns the
  sound off and Escape closes the timer. Brew time can be written as `3`, `2-3`, `1.5` (minutes) or `30 sec`. The
  timer saves nothing, works in a locked note too, and only runs while the editor is open; the screen is kept on
  where the browser allows it.
  The beeps are booked in the audio system as soon as the timer starts, and an inaudible tone (40 Hz, −60 dB) keeps
  the audio system running while the timer runs. With a locked screen the phone slows JavaScript down and can
  freeze the audio clock when nothing plays; the tone prevents that, so the beeps come on time. If the audio clock
  has stood still anyway, the timer beeps as a fallback as soon as JavaScript gets there. The numbers and the
  vibration catch up when the screen turns on.
  **iPhone:** iOS silences Web Audio completely when the phone is on silent. The timer therefore asks for playback
  mode (`navigator.audioSession`) and plays a silent, built-in WAV file in an `<audio>` element while it is open, so
  the beeps are heard on silent too. The audio file also keeps sound running with a locked screen, so the beeps
  come on time then as well (tested with 1.7.4 on iPhone and Android 16).
- **Refill:** tick *Needs refill* when a tea is running low. The **Refill** filter button shows only those teas,
  like a shopping list, and the note list in Standard Notes shows how many need a refill.
- **Untried and Tried:** tick *Not tried yet* for a tea you have at home but haven't tasted. The **Untried** filter
  button shows only those teas, and unticking it after the first cup takes the tea off that list. **Tried** is the
  opposite: it hides every tea marked *Not tried yet*, so a long import of untried teas stays out of the way. Only
  one of the two can be on at a time; tapping the chosen one again shows all teas. Both buttons only appear when
  some tea is untried.
- **Filters:** the buttons under the search field (a row that scrolls sideways) show all teas or one type at a
  time. **Gong fu** shows only teas good for gong fu, **Refill** only teas that need buying and **Untried** only
  teas not tried yet, **Tried** only teas you have tried; they combine with each other, with a type and with search. Filters are saved per device.
  With a filter chosen, a new tea gets that type (and gong fu, refill or untried).
- Enter jumps to the next field in the same tea.
- The note list in Standard Notes shows, for example, *9 teas, 6 for gong fu, 2 to refill, 1 untried: 3 oolong, 2 green, …*.
- The version running on the device is shown at the bottom right, e.g. *v2.3.0*.
- **E-ink mode:** the **E-ink** button next to the version makes the app black and white for e-ink screens (e.g.
  Mudita Kompakt): black borders instead of light grey, selected buttons in black with white text, *Gong fu*
  outlined, *Refill* inverted and *Untried* with a dashed outline (so the badges differ by shape, not colour), no type colours, a black seal and no animations (they cause ghosting). The choice
  is saved per device. Without a choice it turns on by itself on Mudita phones and if the screen reports that it
  is monochrome.
- **Settings per device** (filters, Gong fu, Refill, Tried/Untried, sound and e-ink) are saved in localStorage and also in the
  plugin's data in Standard Notes, under a key for the device (model and screen size). Standard Notes on the phone
  clears the plugin's localStorage each time the note is opened; the choices are then read from there instead.
- **Narrow screen** (under 400 px): smaller margins and no arrow on the right of the rows, so the text fits.
- **茶** (*chá*, tea) is a red seal at the top left of the search field (shown when the list has at least two teas)
  and in the timer, brush-written in the Ma Shan Zheng typeface. The plugin carries only that character from the
  typeface, so it looks the same on every device.

Everything is saved as plain text in the note, one block per tea with a blank line between, so it can be read in
other editors too:

```
Type: Oolong
Name: Dong Ding
Temperature: 95
Brew time: 2-3
Country: Taiwan
Shop: In the Mood for Tea
Taste: honey, peach, floral
Gong fu: yes
Refill:
Untried:

Type: Green
Name: Sencha
Temperature: 70-80
Brew time: 1-2
Country: Japan
Shop: The Tea Centre
Taste:
Gong fu:
Refill: yes
Untried: yes
```

`Gong fu`, `Refill` and `Untried` are `yes` or empty; written by hand, `x`, `✅` and `ja` also count as yes,
`Running low: yes` or `Buy again: yes` as Refill, and `Not tried: yes` or Swedish `Ej testat: ja` as Untried. Fields written by hand with other names are recognised (e.g.
`Tea`, `Temp`, `Steep time`, `Origin`, `Bought at`, `Tasting notes`) and rewritten to the field names when the list
is saved. Teas with nothing filled in are not saved. Lines that are not fields stay unchanged, in their tea if they
are in a block with fields, otherwise at the end.

**From the Swedish version (before 2.0.0):** text with the old Swedish field names (`Sort`, `Namn`, `Temperatur`,
`Bryggtid`, `Land`, `Butik`, `Smak`, `Fyll på`) is still read. Swedish type names and variants (*Grönt* → *Green*, *Svart, smaksatt* → *Black, flavored*), countries
(*Kina* → *China*) and common taste words (*honung, blommig* → *honey, floral*) are translated, `ja` becomes `yes`,
and the note is rewritten in English as soon as it is opened. Words that aren't in the list stay as they are, and
tea names are never changed. A saved type filter carries over.

### Tea as an Android app

Tea is also a standalone Android app (the `apk/` folder), for phones without Standard Notes or to have the teas
one tap away. The app is the same Tea as the plugin, in a WebView, but the list is stored on the phone instead of
in a note. It needs no internet permission.

- **Text** in the status bar shows the whole list as text. Paste the text from the tea note in Standard Notes and
  tap **Save** (it replaces the whole list in the app), or tap **Copy all** and paste it into the note. The text of a
  Tea note is easiest to get by switching the editor to Plain Text for a moment and copying everything. Swedish
  text from before 2.0.0 is translated as described above.
- The list and settings are saved in the app straight away and survive a restart.
- The screen is kept on while the timer is open.
- **Back** closes the timer or the Text panel, collapses the tea or clears the search, and otherwise closes the app.
- The version is the same as the plugin's (e.g. *v2.3.0*), because the app is built from `te/`.

The same pages can be tried in a browser with `te/index.html?standalone=1` (the list is then stored in
localStorage).

**Building:** `apk/build.sh` builds and signs the APK with Ubuntu packages (`android-sdk-platform-23`, `aapt`,
`dalvik-exchange`, `zipalign`, `apksigner` and a JDK), without Gradle. How to create and pass the key is described at
the top of the script. Every update must be signed with the same key, otherwise it can't be installed over the old
app (and the list in the app won't carry over). The key is never put in the repo.

## Installera

1. Öppna Standard Notes → **Preferences → Plugins**.
2. Välj **Install Custom Plugin** och klistra in installationsadressen.
3. Öppna en anteckning, välj editor i menyn vid anteckningens titel och välj pluginet.

## Struktur

```
notes/
├── .nojekyll              Låter GitHub Pages servera filerna som de är
├── index.html             Översiktssida med installationsadresser
├── todo/
│   ├── ext.json
│   ├── index.html
│   ├── core.js            Textformat, datum och upprepning (utan gränssnitt)
│   ├── todo.js            Gränssnittet
│   ├── todo.css
│   └── vendor/
├── nwo/
│   ├── ext.json
│   ├── index.html
│   ├── nwo.js             Textformat och gränssnitt för beställningslistan
│   ├── nwo.css
│   └── vendor/
├── te/
│   ├── ext.json
│   ├── index.html         Gränssnittet och gong fu-schemat
│   ├── te.js              Textformat och gränssnitt för telistan
│   ├── te.css
│   ├── fonts/
│   │   ├── cha.woff2      Tecknet 茶 ur Ma Shan Zheng (bara det tecknet, 1,2 kB)
│   │   └── OFL.txt        Typsnittets licens
│   └── vendor/
├── apk/                   Tea som Android-app (se Tea as an Android app)
│   ├── AndroidManifest.xml
│   ├── src/…/MainActivity.java   WebView med bryggan TeNative (sparar i telefonen)
│   ├── res/               Ikonen (sigillet) och temat
│   ├── make_icons.py      Ritar ikonen ur te/fonts/cha.woff2
│   └── build.sh           Bygger och signerar APK:n utan Gradle
└── test-editor/
    ├── ext.json           Beskrivningsfilen som Standard Notes läser
    ├── index.html         Själva editorn
    ├── editor.css
    ├── editor.js
    └── vendor/
        ├── component-relay.js        Standard Notes kommunikationsbibliotek (v2.2.2)
        └── component-relay.LICENSE
```

Varje plugin ligger i en egen mapp med en egen `ext.json`. Ett nytt plugin läggs till som en ny mapp.

`note_type` i `ext.json` måste vara en av Standard Notes egna typer: `plain-text`, `markdown`, `rich-text`, `task`,
`code`, `spreadsheet`, `authentication`, `super` eller `unknown`. Annars kraschar editormenyn i appen
("undefined is not an object (evaluating 'e[o].push')").

Använd aldrig `plain-text` eller `super`: anteckningar med de typerna öppnas alltid i appens inbyggda
Plain Text- respektive Super-editor, så pluginet hoppar tillbaka till Plain Text när man väljer det.
Ett plugin som inte passar någon annan typ får `unknown`.

## Uppdatera ett plugin

Höj `version` i pluginets `ext.json` och `?v=` i `url` och i `index.html` när något ändras, så att appen inte visar cachade filer. Standard Notes läser `latest_url` och hämtar nya versioner.

Varje plugin visar sin version längst ner till höger (t.ex. *v1.7.2*). Den kommer från `VERSION` i pluginets
JS-fil (`todo.js`, `nwo.js`, `te.js`), alltså koden som faktiskt körs, så höj den också. Visar en enhet en äldre
version än `ext.json`: stäng anteckningen och öppna den igen, och starta annars om Standard Notes.

## Licens

`vendor/component-relay.js` kommer från [@standardnotes/component-relay](https://github.com/standardnotes/component-relay)
och är licensierad under AGPL-3.0, se `vendor/component-relay.LICENSE`.

Biblioteket är lätt ändrat: när appen har ursprunget `null` (vissa Android-versioner) skickas meddelanden
till `*` i stället för `"null"`, annars kastar webbläsaren ett fel och pluginet visar "Ej ansluten".
Ändringen står som kommentar överst i filen. Pluginet använder inga `<form>`-element, eftersom editorns
iframe kan sakna tillåtelse att skicka formulär.

`te/fonts/cha.woff2` är tecknet 茶 ur typsnittet [Ma Shan Zheng](https://github.com/googlefonts/mashanzheng)
(Copyright 2018 The Ma Shan Zheng Project Authors), utskuret med fontTools. Typsnittet är licensierat under
SIL Open Font License 1.1, se `te/fonts/OFL.txt`.
