# Notes_MJ

Osobní plánovač v duchu Things 3: úkoly, kalendář, interaktivní přehled,
zápisník a plánovač dárků na Vánoce či narozeniny. Desktopová aplikace pro
Windows 11, kompletně v češtině. Data zůstávají v počítači.

**Autor:** Michal Jašek · **© 2026**

Všechno, co do Notes_MJ napíšete, zůstává v jednom souboru SQLite ve vašem počítači.
Žádný účet, žádné předplatné, žádná telemetrie, žádný server, kterému by se
cokoliv hlásilo.

Jediné spojení, které aplikace naváže, je dotaz na GitHub, jestli nevyšla novější
verze — a i ten jde vypnout. Neodesílá při něm nic o vás ani o vašich datech.
Podrobně v [Aktualizace](#aktualizace).

```
┌─ Přehled ────────┐
│ Kalendář         │   zachyť → zařaď → naplánuj → udělej → archivuj
├──────────────────┤
│ Doručené         │
│ Dnes             │
│ Nadcházející     │
│ Kdykoli          │
│ Někdy            │
│ Dokončené        │
├─ Plánovač ───────┤
│ Zápisník         │
│ Události a dárky │
└──────────────────┘
```

---

## Rychlý start

Potřebujete [Node.js 18+](https://nodejs.org), [Rust](https://rustup.rs)
a na Windows komponentu **Desktop development with C++** z Visual Studio
Build Tools. Pak stačí **jeden příkaz**:

```powershell
npm run first-run
```

Ten zkontroluje předpoklady, vytvoří `.env` z `.env.example`, založí složku
s daty, nainstaluje závislosti a spustí aplikaci. První spuštění kompiluje
Rust backend, což trvá pár minut; další už jsou okamžitá.

Další spuštění během vývoje: `npm run app`.

### Instalační balíček

```powershell
npm run app:build
```

Vytvoří instalátor `Notes_MJ_<verze>_x64-setup.exe` v
`src-tauri\target\release\bundle\nsis\`. Instaluje se pro aktuálního uživatele,
bez práv správce. Nainstalovaná aplikace už Node ani Rust nepotřebuje a umí se
sama aktualizovat.

---

## Co Notes_MJ umí

**Zachycení** — klávesa `N` kdekoli otevře jednořádkové okno. Přímo v textu lze
psát `#štítek`, `!1`–`!3` pro prioritu a `@dnes` / `@pátek` / `@2026-09-20` pro
termín zahájení. `Ctrl+Enter` uloží a nechá okno otevřené pro další úkol.

**Pohledy** — Doručené, Dnes, Nadcházející, Kdykoli, Někdy, Dokončené.
Do Dneška spadne všechno, čemu nastal den zahájení, plus všechno po termínu,
ať je to zařazené kdekoli.

**Struktura** — oblasti (trvalé části života), projekty (víc než jeden krok),
štítky, poznámky, priorita, datum zahájení, termín, podúkoly a přílohy.

**Opakování** — denní, týdenní, měsíční, roční a libovolné kombinace: každý
druhý týden v pondělí a ve čtvrtek, poslední pátek v měsíci, třetí pondělí,
29. února. Dva režimy: podle pevného rozvrhu (nájem se neposune, i když
zaplatíte pozdě) nebo od dokončení (kytky zaléváte tři dny od chvíle, kdy jste
je zalili naposled). Editor opakování ukazuje skutečné příští termíny
spočítané backendem, ne jejich odhad.

**Soustředění** — klávesa `F` otevře jeden úkol přes celou obrazovku
s odpočtem. Na konci přijde systémové oznámení; když nejde doručit, Notes_MJ to
řekne přímo v okně.

**Přehled (dashboard)** — klikací rozcestník, ne jen report: kolik je hotovo
dnes a za týden, co je po termínu, sloupcový graf zátěže na příštích 7 dní,
postup projektů, blížící se události, připnuté poznámky a série dní v řadě.
Úkoly se dají odškrtnout přímo z karty. Které karty se zobrazí a v jakém
pořadí, si nastavíte.

**Kalendář** — měsíční mřížka s čísly týdnů. Úkol se objeví v den zahájení
i v den termínu (barevně odlišeno). Kliknutím vyberete den, dvojklikem do něj
rovnou přidáte úkol. Vpravo je detail dne s odškrtáváním a posunem o den dál.

**Zápisník** — poznámky, které nejsou úkoly: nápady, seznamy, výpisky.
Připínání nahoru, štítky sdílené s úkoly, hledání v nadpisu i v textu.

**Události a dárky** — Vánoce, narozeniny, výročí. Ke každé události odpočet,
rozpočet a seznam dárků seskupený podle obdarovaného: co koupit, pro koho, za
kolik, odkaz do e-shopu a stav (nápad → rozhodnuto → koupeno → zabaleno →
předáno). Peníze se počítají v haléřích jako celá čísla, takže tři položky po
899,99 dají přesně 2 699,97 Kč. U narozenin klidně zadejte rok narození —
Notes_MJ spočítá nejbližší výskyt, včetně 29. února v nepřestupném roce.

**Oznámení na cokoli** — ke každé akci v aplikaci si můžete zapnout vlastní
systémové oznámení: přidání úkolu, dokončení, zařazení do projektu, naplánování
do kalendáře, nastavení termínu, nová poznámka, koupený dárek, překročený
rozpočet, hotová i nepovedená záloha. Každé zvlášť, viz níže.

**Hledání** — jedno pole. Slova hledají v názvu i poznámkách, klíče je zúží:

| Klíč | Příklad |
|---|---|
| `štítek:` `#` | `štítek:domov`, `#domov` |
| `projekt:` | `projekt:"Auto papíry"` |
| `oblast:` | `oblast:Osobní` |
| `seznam:` | `seznam:někdy` |
| `stav:` | `stav:hotové`, `stav:vše` |
| `priorita:` | `priorita:vysoká`, `priorita:2` |
| `termín:` | `termín:dnes`, `termín:prošlé`, `termín:>=2026-10-01`, `termín:žádný` |
| `začátek:` | `začátek:týden` |

Fungují i anglické klíče (`tag:`, `due:`, …) a varianty bez diakritiky
(`stitek:`, `termin:`). Hotové hledání lze uložit jako filtr do postranního
panelu.

**Zpět** — `Ctrl+Z` / `Ctrl+Shift+Z`. Funguje na všechno: úpravy, mazání,
překlopení opakovaného úkolu na další výskyt i celý import.

**Archiv** — nic se nemaže. Každý dokončený výskyt opakovaného úkolu zůstává
samostatným záznamem v Dokončených.

### Klávesové zkratky

| | |
|---|---|
| `N`, `Ctrl+N` | nový úkol |
| `Ctrl+K` | hledat |
| `1`–`6` | přepnout pohled |
| `↑` `↓` / `J` `K` | pohyb v seznamu |
| `Enter` | otevřít detail |
| `Mezerník` | dokončit / znovu otevřít |
| `F` | soustředěná práce |
| `T` | naplánovat na dnes |
| `Delete` | smazat |
| `D` | přehled |
| `C` | kalendář |
| `Z` | zápisník |
| `U` | události a dárky |
| `Ctrl+Z` / `Ctrl+Shift+Z` | zpět / znovu |
| `Esc` | zavřít panel nebo dialog |

### Místní nabídka (pravé tlačítko)

Notes_MJ nahrazuje anglickou nabídku prohlížeče vlastní, českou. Pravým
tlačítkem lze kliknout kamkoli:

| Kde | Co nabídne |
|---|---|
| úkol v seznamu, v přehledu i v kalendáři | otevřít, dokončit, soustředit se, naplánovat na dnes / zítra / příští pondělí, odložit, kopírovat název, **smazat úkol** |
| projekt v postranním panelu | otevřít, přejmenovat, dokončit celý projekt, **smazat projekt** |
| oblast v postranním panelu | otevřít, přejmenovat, **smazat oblast** |
| uložený filtr | spustit hledání, kopírovat dotaz, **smazat filtr** |
| poznámka v zápisníku | otevřít, připnout / odepnout, kopírovat nadpis i text, **smazat poznámku** |
| událost (i v kalendáři) | otevřít, zobrazit v kalendáři, **smazat událost** |
| dárek | označit jako koupené, otevřít odkaz, kopírovat, **smazat dárek** |
| jakékoli textové pole | vyjmout, kopírovat, vložit, vybrat vše |

V nabídce se dá chodit šipkami a potvrzovat klávesou `Enter`, `Esc` ji zavře.
Mazání se ptá na potvrzení, dokud ho nevypnete v **Nastavení → Obecné →
Ptát se před smazáním**; smazaný záznam jde vrátit tlačítkem **Zpět**
v hlášce nebo klávesou `Ctrl+Z`.

Smazání projektu ani oblasti nemaže úkoly uvnitř — jen jim zruší zařazení,
takže se dál objevují v pohledu **Kdykoli** (nebo tam, kam je posílá jejich
vlastní datum). Nic se tím neztratí.

---

## Nastavení

**Nastavení a data** (dole v postranním panelu, nebo klávesa `?`) má osm karet:

| Karta | Co v ní je |
|---|---|
| **Vzhled** | motiv světlý/tmavý/podle systému, barva zvýraznění, hustota seznamů, velikost písma, počty v panelu, nápovědy zkratek, omezení animací |
| **Chování** | co zobrazit po spuštění, začátek týdne, výchozí řazení, potvrzování mazání, dokončené v seznamech, velikost stránky archivu, skrývání starých dokončených, chování Dneška a Nadcházejících |
| **Kalendář** | víkendy, čísla týdnů, dokončené úkoly, události |
| **Soustředění** | výchozí délka, délka přestávky, rychlá tlačítka, oznámení, automatické dokončení |
| **Připomínky a aplikace** | hlavní vypínač, tichý režim, ranní přehled, předstihy — a samostatný přepínač pro každé jednotlivé oznámení, po kategoriích |
| **Přehled** | pozdrav, výběr a pořadí karet dashboardu |
| **Dárky** | měna, skrytí cen |
| **Data** | umístění dat, export, import, zálohy, obnovení výchozích hodnot |

Každá změna se ukládá okamžitě. Backend hodnoty ověří a ořízne do použitelného
rozsahu, takže velikost písma 4000 % ani prázdný seznam předvoleb aplikaci
nerozbije — panel vždy ukazuje to, co se opravdu uložilo.

Tři volby (počet záloh, rozestup záloh, limit přílohy) jsou zároveň v `.env`.
Hodnota z `.env` je **výchozí**; co nastavíte v aplikaci, má přednost.
Tlačítkem „Podle .env“ se vrátíte zpět.

Nastavení **není** součástí historie Zpět. Ctrl+Z po odškrtnutí úkolu by
neměl zároveň přepnout motiv.

## Oznámení

Nastavení → **Připomínky a aplikace**. Stránka začíná verzí aplikace
a tlačítkem na kontrolu aktualizací (viz [Aktualizace](#aktualizace)),
pod tím jsou tři části:

1. **Oznámení celkem** — hlavní vypínač a čtyři řádky stavu, které říkají, co
   se opravdu stane: jestli Windows oznámení povoluje, jestli je zapnutý hlavní
   vypínač, jestli právě neběží tichý režim a kolik z jednotlivých oznámení je
   zapnutých. Tlačítko **Vyzkoušet oznámení** pošle zkušební zprávu.
2. **Tichý režim** — rozmezí, ve kterém se nepošle nic. Rozmezí přes půlnoc
   (22:00–07:00) funguje.
3. **Jednotlivá oznámení** — seznam po kategoriích, každé s vlastním
   přepínačem, plus „zapnout / vypnout vše“ pro kategorii i pro celou stránku.

| Kategorie | Oznámení |
|---|---|
| **Úkoly** | vytvoření, dokončení, znovuotevření, smazání, zařazení, další výskyt opakování |
| **Projekty a oblasti** | vytvoření projektu, dokončení projektu, vytvoření oblasti |
| **Kalendář a termíny** | naplánování, přesunutí na jiný den, nastavení termínu, dnešní termíny, úkoly po termínu |
| **Zápisník** | vytvoření a smazání poznámky |
| **Události a dárky** | vytvoření události, blížící se událost, přidání dárku, koupení dárku, překročení rozpočtu |
| **Soustředěná práce** | začátek a konec odpočtu |
| **Data a zálohy** | hotová záloha, neúspěšná záloha, hotový export, hotový import |
| **Aplikace a aktualizace** | nalezená aktualizace, připravená aktualizace, neúspěšná aktualizace |

Výchozí nastavení je záměrně tiché u věcí, které děláte desetkrát denně
(vytvoření a dokončení úkolu), a hlasité u těch, které byste jinak přehlédli
(neúspěšná záloha, konec odpočtu, úkoly po termínu). Cokoli z toho lze
přepnout.

**Jak se rozhoduje, co se pošle.** Oznámení projde jen tehdy, když je zapnutý
hlavní vypínač, není tichý režim a daná položka je zapnutá. To rozhodnutí je
v jedné funkci (`isEventEnabled` na frontendu, `Settings::notification_enabled`
v Rustu), takže se nemůže rozejít mezi místy, odkud se oznámení posílají.

**Když Windows oznámení nezobrazí** (blokovaná oprávnění, chybějící služba),
zpráva se objeví jako lišta přímo v okně — pokud jste si ji vyžádali. Vypnutá
položka žádnou náhradu nemá; to je ten rozdíl mezi „nechci to vědět“
a „nepovedlo se to doručit“.

**Katalog oznámení je v backendu** (`src-tauri/src/notifications.rs`) a stránka
nastavení se z něj vykresluje. Přidat další oznámení znamená jednu položku
v tom souboru — nikde jinde se seznam neopakuje. Neznámé klíče se
z uloženého nastavení zahodí a nově přidaná oznámení se doplní ve své výchozí
hodnotě, takže se nastavení nerozejde s kódem ani po aktualizaci.

## Aktualizace

Notes_MJ se umí aktualizovat samo. Zdrojem je vždycky release na GitHubu:

https://github.com/myspulin24/Notes_MJ/releases

**Jak to probíhá**

1. Pár vteřin po otevření okna se aplikace zeptá GitHubu, jestli je novější verze.
   Odesílá se jen ten dotaz — žádné údaje o vás, o úkolech ani o počítači.
2. Když nějaká je, stáhne se na pozadí. Můžete dál normálně pracovat.
3. Nahoře se objeví proužek **„Verze X je stažená a připravená“** s tlačítkem
   **Restartovat**. Do té doby se nic neinstaluje.
4. Kliknete na Restartovat, aplikace se zavře, instalátor proběhne bez ptaní
   a Notes_MJ se otevře v nové verzi.

Ručně kdykoliv: **Nastavení a data → Připomínky a aplikace → Zkontrolovat
aktualizace**. Tamtéž je vidět nainstalovaná verze a dají se vypnout obě
automatiky (hledání po spuštění i stahování na pozadí).

**Vaše data zůstávají**. Aktualizace vymění program, ne databázi. Ta leží jinde
(viz [Kde jsou vaše data](#kde-jsou-vaše-data)) a aktualizace se jí nedotkne. Pokud
nová verze potřebuje jiné schéma, povýší si ho při startu sama a předtím udělá zálohu.

**Proč tomu jde věřit**

Každý instalátor je podepsaný soukromým klíčem, který nikdy neopustí trezor
tajemství. V aplikaci je zapečený odpovídající veřejný klíč a instalátor, jehož
podpis nesedí, se odmítne dřív, než se spustí jediný jeho bajt. I kdyby někdo
ovládl release stránku a podstrčil tam cizí `.exe`, nainstalovaným kopiím ho
nepodstrčí.

**Proč jen jeden druh instalátoru**

Notes_MJ se vydává jako `.exe` (NSIS), ne jako `.msi`. Důvod je praktický:
NSIS instaluje jen pro přihlášeného uživatele a neptá se na práva správce,
takže aktualizace proběhne bez jediného kliknutí navíc. MSI by chtělo UAC
a instalovalo by se pro celý počítač — vedle stávající instalace, ne přes ni.

**Když to nejde**

Bez internetu, při výpadku GitHubu nebo když podpis nesedí, se nestane nic —
aplikace jen zůstane na stávající verzi. Kontrola na pozadí selže tiše, ručně
spuštěná řekne proč. Novou verzi jde vždycky doinstalovat i tak, že si ze stránky
s releasy stáhnete `Notes_MJ_<verze>_x64-setup.exe` a spustíte ho.

> Aktualizace fungují jen v **nainstalované** aplikaci. Když spustíte holé
> `Notes_MJ.exe` ze složky `build/`, kontrola proběhne, ale instalace by neměla
> co přepsat. Použijte instalátor.

### Vydání nové verze

Verzi drží tři soubory a musí se shodovat, takže na to je příkaz:

```powershell
npm run version:set 1.1.1
git commit -am "1.1.1"
git tag v1.1.1
git push --follow-tags
```

Push tagu spustí workflow `.github/workflows/release.yml`: na GitHubu se pustí
testy, postaví se instalátor, podepíše se a vyvěsí jako release i s `latest.json`,
což je soubor, na který se ptají nainstalované aplikace. Podpisový klíč je uložený
jako repository secret, v kódu nikde není.

---

## Kde jsou vaše data

Výchozí umístění je `%USERPROFILE%\.notes_mj\userdata`, tedy obvykle
`C:\Users\<vy>\.notes_mj\userdata`. Změnit ho lze proměnnou `T3_DATA_DIR`
v `.env`.

> **Přejmenování z T3.** Kdo aplikaci používal pod původním názvem, má data
> ve složce `.t3\userdata`. Notes_MJ ji používá dál — pokud v ní najde
> databázi a v nové složce žádná není, otevře tu starou. Nemusíte nic
> přesouvat a o nic nepřijdete. Nová instalace na čistém počítači rovnou
> použije `.notes_mj`.
>
> Soubor databáze se dál jmenuje `t3.db`, aby existující zálohy a postup
> obnovy níže zůstaly platné.

> Oprávnění pro otevírání složek (`src-tauri/capabilities/default.json`) je
> záměrně omezené na výchozí cestu. Pokud si `T3_DATA_DIR` přesunete jinam,
> aplikace bude fungovat normálně, jen tlačítka „Zobrazit v Průzkumníku“
> mohou přestat reagovat. Cestu si pak rozšiřte v souboru s oprávněními.

```
userdata\
  t3.db            databáze SQLite - jediný zdroj pravdy
  t3.db-wal        write-ahead log (dočasný)
  attachments\     jeden soubor na přílohu
  backups\         automatické zálohy, nejnovější poslední
```

`t3.db` je běžná databáze SQLite. Otevřete ji čímkoli (DB Browser for SQLite,
`sqlite3`, Python). Data jsou vaše.

Aktuální cestu, velikost databáze a výsledek kontroly integrity najdete
v **Nastavení a data**.

### Zálohy

Notes_MJ udělá kopii celé databáze při každém spuštění (nejvýše jednou za
`T3_BACKUP_MIN_INTERVAL_MINUTES`) a vždy před destruktivní operací, například
před importem v režimu „Nahradit vše“. Uchovává posledních
`T3_BACKUP_KEEP` záloh.

Zálohy se pořizují příkazem `VACUUM INTO`, takže výsledek je konzistentní
i během zápisu a je to plnohodnotná databáze.

**Obnovení zálohy:**

1. Zavřete Notes_MJ.
2. Otevřete `%USERPROFILE%\.t3\userdata\backups\`.
3. Zkopírujte vybraný soubor `t3-RRRRMMDD-HHMMSS.db` o složku výš.
4. Smažte `t3.db`, `t3.db-wal` a `t3.db-shm`.
5. Přejmenujte zkopírovaný soubor na `t3.db`.
6. Spusťte Notes_MJ.

Ruční zálohu vyvoláte tlačítkem **Zálohovat teď** v Nastavení.

Kromě téhle rotace vzniká ještě jedna kopie, která se **nikdy nemaže**:
těsně předtím, než nová verze poprvé upraví schéma databáze, se udělá
snímek `notes_mj-pred-migraci-v<číslo>-<datum>.db`. Do rotace nepatří
schválně — zrovna tuhle kopii by bylo nejhorší ztratit. Když ji není kam
zapsat, migrace se neprovede a aplikace to řekne, místo aby schéma změnila
napůl a bez zálohy.

### Export a import

**Nastavení a data → Export** nabízí dvě možnosti:

* **Exportovat JSON** — jeden čitelný soubor se vším kromě obsahu příloh.
* **Exportovat vše** — složka s tímto souborem *a* kopií příloh.

Formát je zdokumentovaný pole po poli v [`docs/EXPORT-FORMAT.md`](docs/EXPORT-FORMAT.md)
a přesně se vrací zpět: export → import do prázdné databáze → export dá stejný
obsah. Ověřuje to end-to-end test.

Import má dva režimy. **Sloučit** ponechá vše, co máte, a doplní, co chybí
(opakovaný import téhož souboru tedy nic nezduplikuje). **Nahradit vše** nejdřív
udělá zálohu, pak vše smaže a nahraje soubor — a i tak je to jediné `Ctrl+Z`.

---

## Architektura

```
┌──────────────────────────────────────────────┐
│  React + TypeScript  (src/)                  │   okno WebView2
│  ─ zustand store, jeden zdroj stavu UI       │
│  ─ komponenty jsou jen zobrazení             │
└───────────────────┬──────────────────────────┘
                    │  Tauri IPC (invoke)
                    │  typované příkazy, chyby s druhem a zprávou
┌───────────────────▼──────────────────────────┐
│  Rust  (src-tauri/src/)                      │
│  ─ commands*.rs  tenká IPC vrstva            │
│  ─ store.rs      dotazy, validace, mutace    │
│  ─ recur.rs      engine opakování            │
│  ─ planner.rs    zápisník, události, dárky   │
│  ─ insights.rs   dashboard a kalendář        │
│  ─ settings.rs   typované nastavení          │
│  ─ db.rs         schéma, migrace, žurnál Zpět│
│  ─ transfer.rs   export a import JSON        │
│  ─ backup.rs     automatické zálohy          │
│  ─ paths.rs      cesty a bezpečné názvy      │
└───────────────────┬──────────────────────────┘
                    │
              SQLite (t3.db)
```

Několik rozhodnutí, která stojí za vysvětlení:

**Veškerá logika je v Rustu.** `commands.rs` jen zamkne úložiště, zavolá jednu
metodu a vrátí výsledek. Díky tomu end-to-end test spouští úplně stejný kód
jako aplikace, jen bez okna.

**Opakování je jádro.** `recur.rs` je čistá funkce nad kalendářem: pravidlo
plus stav série dá další datum. Nic jiného v aplikaci o datech nerozhoduje.
Měsíční aritmetika ořezává, ne přeskakuje (31. den padne na 28. února a
v březnu se vrátí na 31.); *n*-tý den v týdnu naopak měsíc přeskočí, když
v něm takový den není.

**Zpět je snímek řádků, ne inverzní operace.** Příkaz nahlásí, kterých řádků
se dotkne; žurnál si uloží jejich stav před a po jako JSON. Zpět zapíše zpátky
stav „před“. Nová funkce tak funguje se Zpět, aniž by o něm věděla. Cizí klíče
jsou během obnovy odložené, takže na pořadí nezáleží, a zápis používá `UPSERT`
místo `INSERT OR REPLACE` — ten totiž řádek nejdřív smaže, čímž by spustil
`ON DELETE SET NULL` a zahodil odkaz, který Zpět právě obnovilo.

**Peníze jsou celá čísla v haléřích.** Ceny jako `f64` jsou způsob, jak
se dostat k součtu 2 699,9700000000003. Frontend částky jen formátuje a parsuje;
sčítá je vždy backend.

**Nastavení je jeden objekt JSON s výchozími hodnotami u každého pole.**
Přidat volbu je tak jednoduché jako přidat řádek do struktury: databáze
zapsaná starší verzí dostane u nové položky výchozí hodnotu místo chyby.
Poškozený blok se čte jako výchozí — nemoci aplikaci otevřít kvůli předvolbě
by byla mnohem horší porucha.

**Datum je kalendářní den, ne časové razítko.** „Termín v úterý“ je úterý bez
ohledu na časové pásmo. Frontend posílá backendu svůj vlastní lokální den.

**Oprávnění jsou co nejmenší.** `src-tauri/capabilities/default.json` povoluje
jen oznámení, systémové dialogy pro výběr souboru a otevření složky s daty.
Žádné HTTP, žádné spouštění příkazů, žádný filesystem plugin. Veškerý přístup
na disk jde přes Rust a `paths::ensure_within` hlídá, že cesta neuteče mimo
složku s daty.

### Aktualizace a bezpečnost

Updater je jediná cesta ven ze sandboxu webview a jediné síťové spojení v celé
aplikaci. Stahování i ověření podpisu běží v Rustu, ne v okně — stránka nemá
žádné oprávnění samu od sebe kamkoliv sáhnout (`connect-src` v CSP zůstává
`'self'`). Instalace se nikdy nespustí sama: `relaunch()` zavolá až kliknutí na
Restartovat.

### Oprávnění, která si aplikace vyžádá

| Oprávnění | K čemu | Bez něj |
|---|---|---|
| Systémová oznámení | konec soustředěné práce | Notes_MJ zprávu ukáže v okně |
| Dialog pro výběr souboru | přílohy, export, import | tyto akce nelze spustit |
| Otevření složky | tlačítka „Zobrazit v Průzkumníku“ | tlačítko nic neudělá |

Žádné z nich není povinné a Notes_MJ si o ně řekne až ve chvíli, kdy je poprvé
potřebuje. Stav oznámení a jejich opětovné vyžádání najdete v Nastavení.

### Bezpečnost a odolnost

* Vstupy se validují v backendu (délky, rozsahy, roky 1900–2200, priorita 0–3)
  a chyba se vrací jako věta, kterou lze ukázat uživateli.
* Názvy souborů příloh procházejí `paths::safe_filename`: odstraní se cesty,
  řídicí a zakázané znaky, vyhrazené názvy Windows (`CON`, `LPT1`), koncové
  tečky a mezery; výsledek se zkrátí na hranici znaku a zachová příponu.
  Na disku dostane soubor ještě náhodný prefix, takže dva `scan.pdf` nekolidují.
* Úklid osiřelých příloh maže **jen** soubory, které zapsalo samo Notes_MJ
  (rozpozná je podle prefixu). Cizí soubor ve složce se nikdy nesmaže.
* Import odmítne soubor, který není export z Notes_MJ, má vyšší verzi formátu nebo
  je nesmyslně velký — a nic přitom nezmění.
* Když není k dispozici volitelné API (oznámení, dialogy, Průzkumník),
  aplikace pokračuje dál a řekne, co se nepovedlo.

---

## Testy

```powershell
npm test
```

Spustí obojí. Jednotlivě:

```powershell
npm run test:rs     # cargo test --manifest-path src-tauri/Cargo.toml
npm run test:ts     # vitest run
npm run typecheck   # tsc --noEmit
```

Co se testuje:

* **Engine opakování** (`src-tauri/src/recur.rs`) — jádrová transformace.
  Denní, týdenní s více dny a intervalem, měsíční podle dne i podle *n*-tého
  dne v týdnu, roční; ořezávání 31. dne, přestupné roky, pátý pátek, konce
  série, oba režimy ukotvení.
* **Žurnál Zpět** (`src-tauri/src/db.rs`) — vložení, úprava, smazání, více
  kroků, zahození větve „znovu“, obnova vzájemně provázaných řádků a regrese
  na zmíněný problém s `INSERT OR REPLACE`.
* **Bezpečné názvy souborů** (`src-tauri/src/paths.rs`) — traversal, zakázané
  a řídicí znaky, vyhrazená jména, zkrácení na hranici znaku.
* **Zálohy** (`src-tauri/src/backup.rs`) — čitelnost kopie, ořezávání počtu,
  omezení frekvence, a že se databáze před migrací schématu zkopíruje stranou,
  že se u nové databáze žádná taková kopie nedělá a že ji rotace nesmaže.
* **End-to-end** (`src-tauri/tests/e2e.rs`) —
  `happy_path_capture_to_archive` projde celý cyklus: zachycení do Doručených,
  zařazení do oblasti a projektu se štítky a termínem, podúkoly, příloha,
  naplánování, Dnes, soustředění, dokončení, překlopení opakování, archiv,
  Zpět i Znovu, hledání, uložený filtr, export, záloha a import do čisté
  databáze. Vedle toho ~20 dalších testů na pohledy, validaci a import.
* **Zápisník, události a dárky** (`src-tauri/src/planner.rs`) — výpočet
  nejbližšího výskytu (včetně 29. února), kontrola odkazů a částek.
* **Dashboard a kalendář** (`src-tauri/src/insights.rs`) — série dní v řadě
  (i to, že ji dnešek bez odškrtnutí nezruší), umístění opakující se události.
* **Nastavení** (`src-tauri/src/settings.rs`) — výchozí hodnoty, ořezávání
  nesmyslů, kompatibilita se staršími databázemi, rozhodování o oznámeních
  a tichý režim včetně přechodu přes půlnoc.
* **Katalog oznámení** (`src-tauri/src/notifications.rs`) — jedinečnost klíčů,
  úplnost kategorií, rozumnost výchozích hodnot.
* **Odesílání oznámení** (`src/__tests__/notify.test.ts`) — že vypnutá položka
  nepošle nic, že zapnutá při selhání systému spadne do okna, a že se obě
  implementace tichého režimu (TS i Rust) shodnou na hraničních časech.
* **Plánovač end-to-end** (`src-tauri/tests/planner_e2e.rs`) —
  `happy_path_christmas_planning` projde celé Vánoce: založení události,
  rozpočet, seznam dárků, nákup, sledování peněz, Zpět, zobrazení
  v kalendáři a smazání i s obnovou. Plus export/import verze 2 a migrace.
* **Migrace** (`src-tauri/tests/smoke_live.rs`) — kopie skutečné databáze
  z tohoto počítače se povýší na nové schéma a nové funkce na ní fungují.
  Pokud databáze neexistuje, test se přeskočí.
* **Místní nabídka** (`src/__tests__/menus.test.ts`, `contextmenu.test.ts`) —
  že každý typ záznamu má ve své nabídce mazání a že je označené jako
  nebezpečné, že v nabídkách nezůstal anglický popisek, že potvrzovací dotaz
  jde vypnout i odmítnout, a nad tím geometrie: překlopení nabídky u okraje
  obrazovky, pohyb šipkami přes oddělovače a vypnuté položky, vkládání textu
  přes výběr.
* **Aktualizace** (`src/__tests__/updater.test.ts`) — skládání průběhu
  stahování z událostí pluginu: server, který neřekne velikost souboru, server,
  který ji řekne špatně (ukazatel nesmí přeskočit 100 %), záporný přírůstek,
  druhé stahování po prvním, a čtení časového razítka, které není ISO.
* **TypeScript** (`src/__tests__/`) — parser dotazů, práce s daty a českým
  skloňováním, parser rychlého zachycení, formátování a parsování peněz,
  mřížka kalendáře včetně ISO čísel týdnů.

---

## Co v Notes_MJ záměrně není

Ne kvůli času, ale proto, že by to změnilo, co Notes_MJ je:

* **Účty, platby, telemetrie, analytika, cloud.** Nic z toho aplikace nemá.
  Po síti chodí jedna jediná věc: dotaz „je novější verze?“ na GitHub, který
  neodesílá žádná data a dá se vypnout.
* **Sdílení, přiřazování lidem, komentáře.** Notes_MJ je nástroj pro jednoho
  člověka. Jakmile má úkol vlastníka, potřebuje oprávnění, notifikace,
  synchronizaci — a je z toho jiný produkt.
* **Obousměrná synchronizace s kalendářem nebo e-mailem.** Obousměrná
  synchronizace znamená řešení konfliktů, tokeny a tichý únik dat z počítače.
* **Nativní mobilní aplikace.** Notes_MJ je desktopová aplikace pro Windows.

---

## Struktura projektu

```
t3/
├─ src/                    frontend
│  ├─ App.tsx              layout, routování, klávesové zkratky
│  ├─ components/          UI (seznamy, kalendář, přehled, zápisník, dárky)
│  ├─ lib/                 api, typy, data, dotazy, peníze, kalendář, vzhled
│  ├─ state/store.ts       zustand store
│  └─ __tests__/           testy vitest
├─ src-tauri/              backend
│  ├─ src/                 viz Architektura
│  ├─ tests/               end-to-end testy
│  └─ capabilities/        oprávnění Tauri
├─ .github/workflows/     release: build, podpis, vyvěšení na GitHub
├─ scripts/bootstrap.mjs   `npm run first-run`
├─ scripts/set-version.mjs `npm run version:set 1.2.3`
├─ docs/EXPORT-FORMAT.md   formát JSON pole po poli
└─ .env.example            konfigurace (žádná hesla nejsou potřeba)
```

Komentáře v kódu a technická dokumentace formátu jsou v angličtině;
uživatelské rozhraní, hlášky a tato příručka v češtině.

## Autor a licence

Napsal **Michal Jašek**, 2026. Aplikace je osobní nástroj, ne produkt:
nemá účty ani telemetrii a po síti si říká jen o to, jestli nevyšla nová verze.

## Konfigurace

Vše volitelné, vše má rozumnou výchozí hodnotu. Viz [`.env.example`](.env.example).

| Proměnná | Výchozí | Význam |
|---|---|---|
| `T3_DATA_DIR` | `%USERPROFILE%\.t3\userdata` | kde leží data |
| `T3_BACKUP_KEEP` | `20` | kolik záloh uchovat |
| `T3_BACKUP_MIN_INTERVAL_MINUTES` | `60` | minimální rozestup záloh |
| `T3_MAX_ATTACHMENT_MB` | `64` | limit velikosti přílohy |
| `T3_DEBUG` | `0` | podrobnější výpisy |

`.env` je v `.gitignore` a nikdy se nekomituje. Notes_MJ nepotřebuje žádné
přihlašovací údaje; soubor existuje proto, aby případné budoucí tajemství
(třeba podpisový klíč pro instalátor) mělo jedno bezpečné místo.
