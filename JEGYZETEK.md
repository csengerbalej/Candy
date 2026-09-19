# JEGYZETEK — mi hiányzik, mi rossz, mitől lenne jobb

Élő lista. Minden sor mellett ott van, **mire alapozom** — mérés, nem
benyomás —, és hogy melyik fajta:

- **HIBA** — valami nem azt csinálja, amire készült. Nem ízlés kérdése.
- **HANGOLÁS** — működik, de a számok rosszak. Olcsó javítani.
- **HIÁNYZIK** — nincs meg, és a teljes élményhez kellene. Drága.

A saját körömből származó megfigyelések alább. A tieid (amiket játék
közben küldesz) a „Csenger jegyzetei" alá kerülnek, és a kettőt a végén
összevetjük: ami mindkettőnknek feltűnik, az biztosan valódi.

Mérési környezet: kísértetház mód, egyedül, asztali gép, 1024×768, 59 fps.

---

## 1. HIBA — a kísértetházban a MÁSIK MÓD kijelzője fut

Mérve, a játékban, a kísértetház közben:

| amit a képernyő mutat | miért hibás |
|---|---|
| `SUSPICIOUS · 0 csíny · 0 lebukás` alsó sáv | a kísértetházban nincs lakó, akit gyanakvóvá lehetne tenni, nincs csíny, és nincs „lebukás" |
| `csíny / cukorka` a gombsúgóban | csíny nincs a módban |
| `a társad talpon` | egyedül játszva nincs társ |
| `KÓD: DDNX · kattints: meghívó link másolása` | egyedül játszva nincs kit meghívni |

Ez a négy egyszerre van a képernyőn, és együtt azt üzenik, hogy ez egy
másik játék kölcsönkért felülete. Horrorban ez különösen sokat ront: a
feszültséget az tartja, hogy minden, amit látsz, erről a házról szól.

**Javítás:** a kísértetházban ezek a sávok ne jelenjenek meg; a
cukorkaszámláló és a lámpa maradjon. Olcsó.

---

## 2. HIBA — a karakterválasztás nagyrészt hazudik ebben a módban

A kártyák ezt ígérik, és mérve ennyi igaz belőlük a kísértetházban:

| karakter | amit ígér | igaz-e |
|---|---|---|
| VÁMPÍR | „gyors és **halk**" | a gyorsaság igen; a halkság **nem**: a kísértetház fix 7 méteres zajt kelt lépésenként, a karakter `noise` értéke nincs beleszorozva |
| VÉRFARKAS | „a lebukás kevésbé viseli meg" | `stun` csak a fogó módban számít, itt nincs lebukás |
| ZOMBI | „azonnal talpra áll" | ugyanaz: `stun` itt nem fut |
| SZELLEM | „átlebeg a szellőzőrácsokon" | a kúriában nincsenek kapuk, amiken átlebeghetne |

Vagyis öt tulajdonságból egyetlenegy (`speed`) hat. A választás
**látszatdöntés**, ami még rosszabb, mint ha nem is lenne választás.

A lábléc ráadásul azt írja: *„Csenger vezet elsőnek, a társad navigál —
az R bármikor cserél"* — a kísértetházban nincs vezetés és nincs
navigátor.

**Javítás, kétféleképpen:**
- olcsón: a kísértetházban más kártyaszöveg, ami az igazat mondja;
- rendesen: a `noise` és a `stun` kapjon szerepet itt is (a Vak hallja a
  halkabb karaktert később, az elkapás után a Zombi hamarabb áll fel).
  Ez adna valódi okot a választásra.

---

## 3. HANGOLÁS — a kvóta megöli a kapzsiság-döntést

Mérve a körben: a házban **10 cukorka** van, a kvóta **8**.

Az eligazítás azt ígéri: *„kimenni bármikor ki lehet — akár kevesebbel
is. Minden felvett darab után eldöntitek: kifelé most, vagy még egyért?"*

Csakhogy 10-ből 8 mellett **nincs mit eldönteni**: háromról lemaradni
bukás, tehát mindent be kell gyűjteni. A döntés, amire az egész mód
épül, papíron van csak.

A távolságok a kezdőpontomtól (méter): 2, 31, 35, 39, 42, 48, 48, 49,
59, 62. Nyolc összeszedése bőven 250–350 méter járás, oda-vissza a
házon át.

**Javítás:** vagy sokkal több cukorka (18–20) ugyanezzel a 8-as
kvótával — akkor lesz mit otthagyni —, vagy a kvóta le 5-re. Az elsőt
javaslom: a keresés így is marad, de a kapzsiság végre valódi.

---

## 4. HANGOLÁS — a lámpa 150 másodperce egy 78×64 méteres házhoz

Mérve: a telep **143 másodpercet** bír (a beállítás 150), egy pót elem
45 másodpercet ad, és **8 elem** van a pályán. Összesen ~500 másodperc
fény.

Ez önmagában nem rossz — a sötétben tapogatózás a mód lényege. De a
3. ponttal együtt kegyetlen: mindent be kell gyűjteni egy hatalmas
házban, miközben a fény nagy részében nincs fény.

**Javítás:** ha a cukorka sűrűbb lesz (3. pont), ez magától megoldódik.
Külön nyúlni hozzá nem kell.

---

## 5. HIBA (megmaradt) — közelről a fénykúp közepe kiég

Mérve, fal előtt állva: a kép közepe **219/255**, a kép 1 százaléka
teljesen kiégett, és a kőfal mintázata eltűnik a fehérben. Szűk
folyosón és ajtóban ez folyamatos, nem ritka helyzet.

Ez a maradéka annak, amit „elsötétül"-ként jeleztél: a sötétség javult
(a kép 37 helyett 68 százaléka kap fényt), de a közeli túlvilágítás
megmaradt.

**Javítás:** nem tudtam rendesen megmérni, mert a játék minden
képkockán felülírja a lámpa erősségét, és a próbálkozásaim ezen
elvéreztek. Ehhez a hurkot kell megfogni, nem a beállítást.

---

## 6. HIÁNYZIK — a kistérkép elárulja a házat, és kiszól a hangulatból

A jobb felső kistérkép a **teljes alaprajzot** mutatja, zöld-kék-lila
szobákkal, élénk színekben. Két baja van:

1. Horrorban az eltévedés a félelem fele. Egy teljes térkép ezt elveszi.
2. A színei egy vidám puzzle-játékból valók — mellette a sötét kőfal
   olcsónak látszik.

**Javítás:** a kísértetházban vagy ne legyen térkép, vagy csak az
legyen rajta, amerre **már jártál**, sötét, egyszínű rajzban. A
felfedezés így jutalom lesz, nem kötelező olvasmány.

---

## 7. HANGOLÁS — az eligazítás 308 szó, és nem fér ki

Mérve: 308 szó, 1702 karakter, 907 képpont magas egy 768-as
képernyőn — **görgetni kell**, hogy a végét lásd.

Egy horrorjáték nem tud rémisztő lenni, ha egy szabályzattal kezdődik.
De a szörnyek ellenszerét tényleg tudni kell (ezt korábban jól
kérted), szóval nem kidobni kell, hanem **elosztani**:

**Javítás:** a kör elején csak az kerüljön ki, ami az első percben kell
(lámpa, cukorka, kijárat — három sor). Minden szörny leírása akkor
villanjon fel egyszer, **amikor először találkozol vele** — fél
másodperc alatt olvasható, két sor. A H továbbra is előhozza az
egészet.

---

## 8. HIÁNYZIK — a cukorkát nem lehet észrevenni

Mérve: a legközelebbi cukorka 2,2 méterre volt tőlem, a padlón
(y = 0,2), és a képernyőn nem vettem észre. A lámpa előre néz, a
cukorka lent van.

**Javítás:** vagy magasabbra (asztalra, polcra), vagy kapjon halk,
közelre szóló hangot — a sötétben a fül hamarabb talál, mint a szem, és
ez illik is a módhoz.

---

## Csenger jegyzetei

_(ide kerülnek a te megfigyeléseid játék közben)_
