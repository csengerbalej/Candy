/**
 * A NAGY HÁZ — generálva, nem modellezve.
 *
 * Miért nem kézzel rajzolt modell: egy húszszobás alaprajzhoz KÉT dolog kell,
 * és a kettőnek tökéletesen egyeznie kell. Az egyik a geometria (amit látsz),
 * a másik a navigációs rács (amin jársz). Ha egy fal egy kicsit arrébb van,
 * mint amit a rács hisz, akkor vagy átsétálsz rajta, vagy nekimész a
 * semminek — és ez a hiba NÉMA: nem dob hibát, csak elrontja a játékot.
 *
 * Ezért mindkettő UGYANABBÓL az egy rácsból készül itt. Ha a rács szerint
 * egy cella fal, akkor ott áll egy doboz, és ott a `solid` is 1. Nem lehet
 * elcsúszni, mert nincs két forrás.
 *
 * A HÁZ SZERKEZETE, és miért pont ilyen:
 *
 *   A folyosók RÁCSOT alkotnak — a szobák között és a ház körül is. Ez az
 *   egyetlen döntés, ami a horror mód szempontjából igazán számít: egy
 *   rácsban minden útnak van kerülője, tehát a Követő elől MINDIG el lehet
 *   menekülni. Egy zsákutcás ház nem ijesztő, hanem igazságtalan.
 *
 *   A szobák nagyok és üresek. A bútor külön jön — és amíg nincs, addig is
 *   végigjátszható, mert a félelem a sötétből és a távolságokból jön, nem a
 *   berendezésből.
 *
 * Futtatás:  node tools/make-mansion.mjs
 * Kimenet:   public/models/mansion.json  +  public/models/mansion-nav.json
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { writeFileSync } from 'node:fs';

// --- a lépték ------------------------------------------------------------
//
// EZ A HÁZ EMBERMÉRETŰ, és ez a legfontosabb döntés benne.
//
// A többi házban aprók vagytok: a lakó 6,4 egység magas, ti 1,7 — vagyis
// szörnyecskék egy felnőtt lakásában, ahol egy konyhaasztal fölé nem láttok.
// Ott ez a poén. Egy horrorban viszont pont az ellenkezője kell: a ház
// legyen ismerős, a folyosó legyen olyan széles, amilyen egy folyosó, és
// ami elindul feléd a sötétben, az akkora legyen, mint te.
//
// Ezért itt EGY EGYSÉG = EGY MÉTER. A játékos 1,7 egység magas, tehát
// 1,7 méter: ember. Minden méret ebből következik — a 2,5 méteres folyosó
// tényleg folyosó, a 7×6-os szoba tényleg szoba.
//
/** Egy rácscella a világban. Fél méter: ennyi a falvastagság is. */
const CELL = 0.5;
/** A játék a modellt ezzel szorozza (HOUSE1_SCALE) — a fájl ebben él. */
const SCALE = 36;
/** Egy szobatömb oldala cellában. Húsz cella = 10 méter: úri szoba. */
const BLOCK = 20;
/** A folyosók szélessége. Hat cella = 3 méter. */
const CORR = 6;
/** A külső fal vastagsága cellában. */
const MARGIN = 1;
const COLS = 6;
const ROWS = 5;

/**
 * OSZLOP- ÉS SORSZÉLESSÉGEK.
 *
 * Egyforma tömbökből szabályos rács lesz, és a szabályos rács nem kastély,
 * hanem irodaház: ránézésre kitalálod, mi van a következő sarkon. A
 * változó méretek attól működnek, hogy a folyosórács MEGMARAD — a
 * kerülőutak tehát megmaradnak —, csak a szobák lesznek különbözők.
 */
const COL_W = [26, 14, 20, 14, 22, 16];
const ROW_H = [18, 22, 14, 20, 16];
const W = MARGIN * 2 + (COLS + 1) * CORR + COL_W.reduce((a, b) => a + b, 0);
const H = MARGIN * 2 + (ROWS + 1) * CORR + ROW_H.reduce((a, b) => a + b, 0);

/**
 * A FALMAGASSÁG: 3,2 méter.
 *
 * A többi házban 17 egység, mert ott a falnak a dupla ugrás fölé kell érnie
 * (12,6). Embermértékben viszont egy 17 méteres szoba katedrális, nem
 * hálószoba. A megoldás nem a fal növelése, hanem az UGRÁSÉ a csökkentése:
 * a kísértetházban nem szökellsz tizenkét métert. Az ütköző maga magasabb
 * marad a falnál — az láthatatlan, tehát nem kerül semmibe.
 */
const WALL = 3.2 / SCALE;
const FLOOR_Z = 0;

const WALLC = 0;
const OPEN = 1;
const grid = Array.from({ length: H }, () => new Array(W).fill(WALLC));
/** Melyik szobához tartozik egy cella. 1 = folyosó, 2-től a szobák. */
const room = Array.from({ length: H }, () => new Array(W).fill(0));

let seed = 20261031;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

/**
 * Egy szobatömb bal-felső cellája.
 *
 * A tömb SZÉLE fal, a belseje a szoba: a `+1` és a `-2` ezt adja. Enélkül a
 * szoba pontosan ott kezdődne, ahol a folyosó véget ér — vagyis nem volna
 * köztük fal, és az egész ház egyetlen nyitott terem lenne. Mérve: az első
 * rácsképen egyetlen belső fal sem látszott, csak a külső.
 */
const blockX = (c) =>
  MARGIN + CORR + COL_W.slice(0, c).reduce((a, b) => a + b + CORR, 0) + 1;
const blockY = (r) =>
  MARGIN + CORR + ROW_H.slice(0, r).reduce((a, b) => a + b + CORR, 0) + 1;
/** A szoba belső oldala: a tömb mínusz a két oldalfal. */
const innerW = (c) => COL_W[c] - 2;
const innerH = (r) => ROW_H[r] - 2;

const fill = (x0, y0, x1, y1, what, id) => {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      grid[y][x] = what;
      if (id !== undefined) room[y][x] = id;
    }
  }
};

// --- 1. A FOLYOSÓRÁCS ----------------------------------------------------
//
// Függőleges és vízszintes sávok, a ház körül is. Ez adja a köröket: minden
// kereszteződésből legalább három irányba lehet menni.
for (let c = 0; c <= COLS; c++) {
  const x = MARGIN + COL_W.slice(0, c).reduce((a, b) => a + b + CORR, 0);
  fill(x, MARGIN, x + CORR - 1, H - 1 - MARGIN, OPEN, 1);
}
for (let r = 0; r <= ROWS; r++) {
  const y = MARGIN + ROW_H.slice(0, r).reduce((a, b) => a + b + CORR, 0);
  fill(MARGIN, y, W - 1 - MARGIN, y + CORR - 1, OPEN, 1);
}

// --- 2. A SZOBÁK ---------------------------------------------------------
//
// Húsz tömb, de nem húsz egyforma doboz: néhányat ÖSSZEVONUNK, hogy legyen
// terem is, ne csak szoba. Az összevonás a köztük lévő folyosószakaszt is
// elnyeli — a rács többi része viszont megmarad, tehát a kerülők megmaradnak.
const MERGE = [
  [0, 0, 1, 0], // nagyterem, a nyugati szárny elején
  [4, 0, 5, 0], // bálterem
  [2, 1, 2, 2], // csarnok, a ház szíve
  [0, 4, 1, 4], // konyha és éléskamra egyben
  [4, 3, 5, 3], // könyvtár
];
const merged = new Set();
const rooms = [];
let nextId = 2;

const addRoom = (x0, y0, x1, y1, nev) => {
  const id = nextId++;
  fill(x0, y0, x1, y1, OPEN, id);
  rooms.push({ id, nev, x0, y0, x1, y1 });
  return id;
};

const NEVEK = [
  'NAGYTEREM', 'BÁLTEREM', 'CSARNOK', 'KONYHA', 'EBÉDLŐ', 'KÖNYVTÁR',
  'DOLGOZÓ', 'HÁLÓ', 'GYEREKSZOBA', 'FÜRDŐ', 'MOSÓKONYHA', 'TÉLIKERT',
  'SZALON', 'VENDÉGSZOBA', 'KAMRA', 'ZENESZOBA', 'BILIÁRD', 'VARRÓSZOBA',
  'CSELÉDSZOBA', 'PADLÁSFELJÁRÓ', 'DOHÁNYZÓ', 'KÉPTÁR', 'IMASZOBA',
  'SZERTÁR', 'HÁTSÓ HÁLÓ',
];
let nevIndex = 0;

for (const [ax, ay, bx, by] of MERGE) {
  const x0 = blockX(Math.min(ax, bx));
  const y0 = blockY(Math.min(ay, by));
  const x1 = blockX(Math.max(ax, bx)) + innerW(Math.max(ax, bx)) - 1;
  const y1 = blockY(Math.max(ay, by)) + innerH(Math.max(ay, by)) - 1;
  addRoom(x0, y0, x1, y1, NEVEK[nevIndex++] ?? 'TEREM');
  merged.add(`${ax},${ay}`);
  merged.add(`${bx},${by}`);
}
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (merged.has(`${c},${r}`)) continue;
    const x0 = blockX(c);
    const y0 = blockY(r);
    addRoom(x0, y0, x0 + innerW(c) - 1, y0 + innerH(r) - 1, NEVEK[nevIndex++] ?? `SZOBA ${nextId}`);
  }
}

// --- 3. AJTÓK ------------------------------------------------------------
//
// Minden szobának LEGALÁBB KETTŐ. Ez nem kényelem: egyajtós szobában a
// Követő elé sétálsz, és onnan nincs kijárat — az nem feszültség, hanem
// csapda. Kettővel a szoba maga is kerülőút lesz.
/**
 * AZ AJTÓ SZÉLESSÉGE: hat cella, három méter — annyi, mint a folyosó.
 *
 * Kétszer mértem be, és másodszorra derült ki, hogy nem is egy hibáról van
 * szó, hanem kettőről:
 *
 *   A JÁTÉKOS nem fért be. A rács nem a testedet nézi, hanem hogy van-e
 *   körülötted TISZTA HELY: a `bodyFits` 0,585 méter sugarat kér, ami a
 *   0,21-es cellákkal három cella minden irányban — vagyis 1,26 méter kell
 *   a nyílás közepétől. Egy két méteres ajtó ebből egy métert ad. Ezért
 *   voltak szobák, amikbe egyszerűen nem lehetett bemenni.
 *
 *   A SZÖRNYEK meg nem TALÁLTAK ÁT. Az útkeresés durvább rácson fut (minden
 *   negyedik cella), és egy két méteres nyílás azon a rácson néha egyetlen
 *   mintavételi pontot sem kap — a keresés szerint ott fal van. Nem
 *   „beragadtak": nem volt útvonal, tehát nem indultak el.
 *
 * Három méterrel mindkettő elfér, és egy kúria ajtaja amúgy is széles.
 */
const DOOR = 6;
/** A kivágott ajtónyílások, hogy később lapot tehessünk a tövükbe. */
const ajtonyilasok = [];
const doorHere = (x0, y0, x1, y1, oldal) => {
  if (oldal === 'fent') {
    const x = Math.floor((x0 + x1) / 2) - 1;
    fill(x, y0 - 1, x + DOOR - 1, y0 - 1, OPEN, 1);
    ajtonyilasok.push({ x, y: y0 - 1, vizszintes: true });
  } else if (oldal === 'lent') {
    const x = Math.floor((x0 + x1) / 2) - 1;
    fill(x, y1 + 1, x + DOOR - 1, y1 + 1, OPEN, 1);
    ajtonyilasok.push({ x, y: y1 + 1, vizszintes: true });
  } else if (oldal === 'bal') {
    const y = Math.floor((y0 + y1) / 2) - 1;
    fill(x0 - 1, y, x0 - 1, y + DOOR - 1, OPEN, 1);
    ajtonyilasok.push({ x: x0 - 1, y, vizszintes: false });
  } else {
    const y = Math.floor((y0 + y1) / 2) - 1;
    fill(x1 + 1, y, x1 + 1, y + DOOR - 1, OPEN, 1);
    ajtonyilasok.push({ x: x1 + 1, y, vizszintes: false });
  }
};

for (const r of rooms) {
  // Azok az oldalak, amelyek mögött tényleg folyosó van.
  const lehet = [];
  if (r.y0 - 2 >= 0 && grid[r.y0 - 2][r.x0 + 1] === OPEN) lehet.push('fent');
  if (r.y1 + 2 < H && grid[r.y1 + 2][r.x0 + 1] === OPEN) lehet.push('lent');
  if (r.x0 - 2 >= 0 && grid[r.y0 + 1][r.x0 - 2] === OPEN) lehet.push('bal');
  if (r.x1 + 2 < W && grid[r.y0 + 1][r.x1 + 2] === OPEN) lehet.push('jobb');
  // Keverés, hogy ne mindig ugyanarra a két oldalra nyíljanak.
  for (let i = lehet.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [lehet[i], lehet[j]] = [lehet[j], lehet[i]];
  }
  const hany = Math.min(lehet.length, (r.x1 - r.x0) * (r.y1 - r.y0) > 400 ? 3 : 2);
  for (let i = 0; i < hany; i++) doorHere(r.x0, r.y0, r.x1, r.y1, lehet[i]);
}

// --- 4. A BEJÁRAT --------------------------------------------------------
//
// Délen, középen. A tornác kint van, a küszöb a külső falon át vezet a
// körfolyosóra — tehát belépve azonnal választanod kell, merre indulsz.
const kapuX = Math.floor(W / 2) - 1;
fill(kapuX, H - 1 - MARGIN + 1, kapuX + DOOR - 1, H - 1, OPEN, 1);
const kapuCella = [kapuX + 0.5, H - 1];

// --- innentől: a rács kész. Minden más EBBŐL származik. ------------------

const ux = (x) => ((x + 0.5) * CELL - (W * CELL) / 2) / SCALE;
/** Egy rácssor a VILÁG z tengelyén, modellegységben. A geometria ezt használja. */
const uz = (y) => ((y + 0.5) * CELL - (H * CELL) / 2) / SCALE;
/**
 * ...és UGYANAZ A SOR a nav fájl tengelyén.
 *
 * A nav fájl NEM világkoordinátában beszél: a rácsot annak idején
 * Blenderben mérték, ahol a mélységtengely az Y, és a glTF ennek a
 * MÍNUSZÁT hívja Z-nek. A betöltő ezért `row(z) = (-z - origó) / cella`
 * képlettel számol.
 *
 * Elsőre világ-z-t írtam a fájlba, és mivel a ház a z tengelyre
 * szimmetrikus, a HATÁROK stimmeltek — a TARTALOM viszont tükröződött. A
 * geometria szerint jobbra volt a fal, a rács szerint balra. Ebből lett a
 * „beragadnak a falba", a „nem tudok bemenni egyes szobákba" és a
 * „szörnyek nem mozognak": mind a három ugyanaz az egy előjel.
 */
const uy = (y) => -uz(y);

// --- geometria -----------------------------------------------------------
const positions = [];
const normals = [];
const colors = [];

/**
 * A FELÜLET SZÍNE — pofátlanul egyszerűen, mégis elég.
 *
 * A padló sötét, deszkacsíkokkal: a csíkot a világ-x koordináta adja, nem
 * textúra. A fal fakó tapéta, LENT SÖTÉTEBB — ez a legolcsóbb kosz, ami
 * mégis kornak látszik. A mennyezet felé néző lapok világosabbak, a lefelé
 * nézők sötétebbek: enélkül a doboz doboz marad.
 *
 * És mindenen ül egy lassú, pozíciófüggő foltosság. Egy egyenletesen
 * festett fal makettnek látszik; a foltos falnak MÚLTJA van.
 */
function szinez(fajta, p, ny) {
  const [x, y, z] = p;
  const zaj =
    Math.sin(x * 61.1 + z * 37.7) * 0.5 + Math.sin(x * 13.3 - z * 19.9) * 0.5;
  const folt = 1 - Math.max(0, zaj) * 0.22;
  if (fajta === 0) {
    // PADLÓ: sötét deszka, a csíkok 40 cm-enként.
    const deszka = Math.sin(z * SCALE * 7.85) > 0.72 ? 0.72 : 1;
    const t = 0.20 * folt * deszka;
    return [t * 1.18, t * 0.92, t * 0.72];
  }
  if (fajta === 2) {
    // AJTÓ: sötétebb, melegebb fa — hogy elváljon a faltól.
    const t = 0.17 * folt;
    return [t * 1.35, t * 0.95, t * 0.68];
  }
  // FAL: fakó tapéta. Lent sötétebb (lábazat és kosz), a lefelé néző lapok
  // tompábbak.
  const magassag = Math.min(1, Math.max(0, (y * SCALE) / 3.2));
  const also = 0.45 + 0.55 * Math.min(1, magassag * 2.2);
  const lap = ny < -0.5 ? 0.55 : ny > 0.5 ? 1.06 : 1;
  const t = 0.34 * folt * also * lap;
  return [t, t * 0.95, t * 0.88];
}
const indices = [];
let vcount = 0;

/**
 * @param fajta 0 = padló, 1 = fal, 2 = ajtó. A szín ebből jön.
 *
 * Textúra helyett CSÚCSSZÍN: a ház generált, tehát nincs UV-kiterítése, és
 * egy kép ráfeszítése külön munka volna. Egy vaksötét házban viszont a
 * felület részlete úgysem látszik — ami látszik, az a FOLTOSSÁG és az,
 * hogy a padló más, mint a fal. Ezt a csúcsszín megadja.
 */
function box(x0, z0, x1, z1, y0, y1, fajta = 1) {
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [
    [0, 1, 2, 3, 0, 0, -1], [5, 4, 7, 6, 0, 0, 1],
    [4, 0, 3, 7, -1, 0, 0], [1, 5, 6, 2, 1, 0, 0],
    [3, 2, 6, 7, 0, 1, 0], [4, 5, 1, 0, 0, -1, 0],
  ];
  for (const [a, b, c, d, nx, ny, nz] of faces) {
    const base = vcount;
    for (const idx of [a, b, c, d]) {
      positions.push(...v[idx]);
      normals.push(nx, ny, nz);
      colors.push(...szinez(fajta, v[idx], ny));
      vcount++;
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

// A PADLÓ egy lap az egész alaprajz alatt. Nem cellánként: egy nagy lap
// ugyanúgy néz ki, és tízezer háromszöggel kevesebb.
const half = { x: (W * CELL) / 2 / SCALE, z: (H * CELL) / 2 / SCALE };
box(-half.x, -half.z, half.x, half.z, FLOOR_Z - 0.01, FLOOR_Z, 0);

// A FALAK: a szomszédos falcellák VÍZSZINTES FUTAMOKBA vonva. Cellánként
// egy doboz húszezer háromszög volna; futamokban néhány száz.
const used = Array.from({ length: H }, () => new Array(W).fill(false));
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (grid[y][x] !== WALLC || used[y][x]) continue;
    // Csak azok a falcellák érdekelnek, amelyek LÁTSZANAK: van nyitott
    // szomszédjuk. A tömör belső blokkokat nem kell kirajzolni.
    let lathato = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && grid[ny][nx] === OPEN) lathato = true;
    }
    if (!lathato) continue;
    let x1 = x;
    while (x1 + 1 < W && grid[y][x1 + 1] === WALLC && !used[y][x1 + 1]) {
      let l = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x1 + 1 + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && grid[ny][nx] === OPEN) l = true;
      }
      if (!l) break;
      x1++;
    }
    for (let k = x; k <= x1; k++) used[y][k] = true;
    box(
      ux(x) - CELL / 2 / SCALE,
      uz(y) - CELL / 2 / SCALE,
      ux(x1) + CELL / 2 / SCALE,
      uz(y) + CELL / 2 / SCALE,
      FLOOR_Z,
      FLOOR_Z + WALL
    );
  }
}

// --- AJTÓK ---------------------------------------------------------------
//
// Nem zárnak el semmit: nyitva állnak, a keretük mégis elmondja, hogy ez
// itt ÁTJÁRÓ, nem lyuk a falban. A lap a nyílás TÖVÉBEN áll, kifelé
// fordulva — ahol a rács szerint is szabad a hely, tehát senki nem akad
// el benne.
//
// Az első változat magából a rácsból próbálta kitalálni, hol vannak az
// ajtók, és NULLA darabot talált: egy hat cellás nyílás közepén nincs
// szemközti fal, amiből fel lehetne ismerni. A kivágás viszont pontosan
// tudja, hol vágott — azóta onnan jön a lista.
for (const ny of ajtonyilasok) {
  const vastag = 0.1 / SCALE;
  const lap = (CELL * 2.4) / SCALE;
  const magas = WALL * 0.84;
  // A LAP A FAL SÍKJÁBAN fekszik, a nyíláson KÍVÜL — vagyis úgy áll, mint
  // egy tárva hagyott ajtó, ami nekitámaszkodik a falnak. Ha a nyílásba
  // lógna, átsétálnál rajta: a rács szerint ott szabad a hely, a szemed
  // szerint viszont ajtó van. Az ilyen ellentmondás rosszabb, mint ha
  // egyáltalán nem volna ajtó.
  if (ny.vizszintes) {
    const cz = uz(ny.y);
    const cx = ux(ny.x);
    box(cx - lap, cz - vastag, cx, cz + vastag, FLOOR_Z, FLOOR_Z + magas, 2);
    const cx2 = ux(ny.x + DOOR - 1);
    box(cx2, cz - vastag, cx2 + lap, cz + vastag, FLOOR_Z, FLOOR_Z + magas, 2);
  } else {
    const cx = ux(ny.x);
    const cz = uz(ny.y);
    box(cx - vastag, cz - lap, cx + vastag, cz, FLOOR_Z, FLOOR_Z + magas, 2);
    const cz2 = uz(ny.y + DOOR - 1);
    box(cx - vastag, cz2, cx + vastag, cz2 + lap, FLOOR_Z, FLOOR_Z + magas, 2);
  }
}

const doc = new Document();
const buffer = doc.createBuffer();
const mesh = doc.createMesh('mansion');
const prim = doc
  .createPrimitive()
  .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
  .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer))
  .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(new Float32Array(colors)).setBuffer(buffer))
  .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer))
  .setMaterial(
    doc
      .createMaterial('fal')
      .setBaseColorFactor([1, 1, 1, 1])
      .setRoughnessFactor(0.94)
      .setMetallicFactor(0)
      .setDoubleSided(true)
  );
mesh.addPrimitive(prim);
doc.createScene('mansion').addChild(doc.createNode('mansion').setMesh(mesh));
const glb = await new NodeIO().writeBinary(doc);
writeFileSync('public/models/mansion.glb', Buffer.from(glb));
writeFileSync('public/models/mansion.json', JSON.stringify({ glb: Buffer.from(glb).toString('base64') }));

// --- a navigációs rács ---------------------------------------------------
const N = 384;
const minX = -half.x;
const maxX = half.x;
const minZ = -half.z;
const maxZ = half.z;
const cellU = (maxX - minX) / N;

const at = (i, j) => {
  const x = minX + (i + 0.5) * cellU;
  // A sor a nav tengelyén fut; a világ z-je ennek a mínusza.
  const z = -(minZ + (j + 0.5) * ((maxZ - minZ) / N));
  const gx = Math.floor(((x * SCALE + (W * CELL) / 2) / CELL));
  const gy = Math.floor(((z * SCALE + (H * CELL) / 2) / CELL));
  if (gx < 0 || gy < 0 || gx >= W || gy >= H) return null;
  return [gx, gy];
};

const floorRows = [];
const solidRows = [];
const roomRows = [];
const heightRows = [];
for (let j = 0; j < N; j++) {
  let f = '';
  let s = '';
  let r = '';
  const h = [];
  for (let i = 0; i < N; i++) {
    const g = at(i, j);
    if (!g) {
      f += '0';
      s += '1';
      r += '0';
      h.push(null);
      continue;
    }
    const nyitott = grid[g[1]][g[0]] === OPEN;
    f += nyitott ? '1' : '0';
    s += nyitott ? '0' : '1';
    r += nyitott ? room[g[1]][g[0]].toString(36) : '0';
    h.push(nyitott ? FLOOR_Z : FLOOR_Z + WALL);
  }
  floorRows.push(f);
  solidRows.push(s);
  roomRows.push(r);
  heightRows.push(h);
}

// roomInfo: a folyosó is szoba (1-es), mert a bejárat oda nyílik.
const roomInfo = [];
const mind = [{ id: 1, nev: 'FOLYOSÓ' }, ...rooms];
for (const r of mind) {
  let cells = 0;
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (room[y][x] !== r.id || grid[y][x] !== OPEN) continue;
      cells++;
      lo = [Math.min(lo[0], ux(x)), Math.min(lo[1], uy(y))];
      hi = [Math.max(hi[0], ux(x)), Math.max(hi[1], uy(y))];
    }
  }
  if (!cells) continue;
  roomInfo.push({
    id: r.id,
    cells,
    area: cells * (CELL / SCALE) ** 2,
    min: lo,
    max: hi,
    centre: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2],
  });
}

/** Egy szoba közepe, modellkoordinátában. */
const kozep = (id) => {
  const info = roomInfo.find((r) => r.id === id);
  return info ? info.centre : [0, 0];
};

const szobak = rooms.map((r) => r.id);
const patrol = szobak.slice(0, 12).map((id) => kozep(id));
const candy = szobak.slice(0, 10).map((id, i) => ({ at: kozep(id), room: id, reward: 6 + (i % 3) * 2 }));
// A KÚRIÁBAN NINCS CSÍNY. A csínyek zöld karikaként jelennek meg a
// padlón — a kooperatív körben ez jelzés, egy horrorházban viszont három
// világító gyűrű, ami elárulja, hogy ez itt játék.
const pranks = [];

const kapu = [ux(kapuCella[0]), uy(H - 1)];
/**
 * A BELÉPÉS PONTJA: a körfolyosó közepe a kapu mögött.
 *
 * Előbb „öt méterrel beljebb" volt, és ez a falba esett — a körfolyosó
 * három méter széles, öt méter már a szemközti szoba fala. A próba
 * fogta meg: a bejárattól EGYETLEN szobába sem vezetett út, miközben a
 * szobák között igen. Nem az ajtók voltak rosszak, hanem az indulópont.
 */
const belepes = [ux(kapuCella[0]), uy(H - 1 - MARGIN - Math.floor(CORR / 2))];
const nav = {
  scale: SCALE,
  min: [minX, minZ, FLOOR_Z],
  max: [maxX, maxZ, FLOOR_Z + WALL],
  n: N,
  cell: cellU,
  floorZ: FLOOR_Z,
  wallTop: FLOOR_Z + WALL,
  porch: [kapu[0], kapu[1] - 3 / SCALE],
  door: kapu,
  spawn: belepes,
  entryRoom: 1,
  candy,
  pranks,
  patrol,
  homeowner: kozep(szobak[szobak.length - 1]),
  floor: floorRows,
  solid: solidRows,
  rooms: roomRows,
  roomInfo,
  height: heightRows,
};
writeFileSync('public/models/mansion-nav.json', JSON.stringify(nav));

const nyitott = grid.flat().filter((c) => c === OPEN).length;
console.log(`A HÁZ KÉSZ`);
console.log(`  méret:       ${(W * CELL).toFixed(0)} × ${(H * CELL).toFixed(0)} egység (a ház1 67 széles)`);
console.log(`  szobák:      ${rooms.length} + folyosórács`);
console.log(`  járható:     ${((nyitott / (W * H)) * 100).toFixed(0)}% a befoglalóból`);
console.log(`  háromszög:   ${indices.length / 3}`);
console.log(`  glb:         ${(glb.byteLength / 1e6).toFixed(2)} MB`);
console.log(`  falmagasság: ${(WALL * SCALE).toFixed(0)} egység`);
