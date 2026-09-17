/**
 * A falu átfestése halloween-hangulatra.
 *
 * Miért így, és miért nem anyagonként: a falu EGY mesh, EGY anyaggal és EGY
 * 4096-os atlasszal. Nincs mit anyagonként színezni — a „tégla", az „üveg" és
 * a „tető" ezen a modellen nem külön anyag, hanem az atlasz különböző
 * részei. Ami marad, és ami valójában többet is ér: magát az atlaszt
 * átfesteni.
 *
 * A besorolás MÉRT, nem tippelt (lásd tools/village-atlas.mjs): a falu
 * lényegében szürkésbézs, 7–26% telítettséggel, egyetlen zöld fürttel. Tehát
 * nem finomhangolni kell, hanem osztályozni:
 *
 *   · zöld (60–150° árnyalat, telített)  → lomb: hidegebb, mélyebb zöld
 *   · sötét (világosság < 0,34)          → tető és árnyék: mély lila-fekete
 *   · közép (0,34–0,56)                  → TÉGLA: meleg, égetett vörösbarna
 *   · világos (> 0,56)                   → vakolat: csontszín, lila derengéssel
 *
 * A határok a fenti mérésből jönnek: a négy tartomány nagyjából a 30/24/30/16
 * százalékos fürtöket választja szét.
 *
 * A színpaletta nem szabadon választott: a szörnyek narancsához (#ff7a29) és
 * lilájához (#9d5cff) hangolva — a város így NEM versenyzik a szereplőkkel,
 * hanem ugyanabból a két árnyalatból épül fel, sötétebben.
 *
 * Megosztott tónus: a mélyek hidegek, a csúcsfények melegek. Ez az egy trükk
 * teszi, hogy egy éjszakai kép éjszakainak látsszon, és nem pedig egy nappali
 * képnek, amit lesötétítettek.
 *
 *   node tools/village-paint.mjs <in.glb> <out.glb>
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const [input, output, mode = 'classify'] = process.argv.slice(2);

/**
 * Két festési mód, és a különbség nem finomhangolás.
 *
 * `classify` — a TEREPHEZ. A falu alapja egy szürkésbézs, textúra nélküli
 *   massza volt: ott nincs mit megőrizni, tehát a képpontokat osztályokba
 *   soroljuk (lomb, tető, úttest, tégla, vakolat) és átfestjük őket.
 *
 * `gentle` — a HÁZAKHOZ. Itt van mit elrontani, és el is rontottam: a házak
 *   saját, tiszta, lapos színekkel és éles fehér ablakkeretekkel érkeznek, az
 *   osztályozás viszont képpontonként dönt. Egy ablakkeret és a fal közti
 *   ÁTMENETI képpont középvilágos — vagyis „tégla" —, tehát narancsra
 *   festődik. Minden élre jutott egy rozsdacsík, a fehér keretek beszürkültek,
 *   és a ház piszkosnak látszott ahelyett, hogy éjszakainak.
 *
 *   Ez a mód ezért NEM sorol be semmit. Megtartja az eredeti árnyalatot, és
 *   csak azt teszi, amit egy éjszaka tesz: sötétít, kissé fakít, a mélyeket
 *   hidegre, a csúcsfényeket melegre húzza. Az élek sértetlenek maradnak,
 *   mert nincs olyan döntés, ami két szomszédos képpontot más vödörbe tenne.
 */
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);

const textures = doc.getRoot().listTextures();

/**
 * Az ALAPSZÍN textúrája, nem „a legnagyobb".
 *
 * A falunál a kettő ugyanaz volt — egyetlen anyag, egyetlen térkép. A házak
 * viszont három térképet hoznak (alapszín, normál, fém-érdesség), és miután a
 * sütés mindhármat 1024-re méretezi, a „legnagyobb bájtban" választás
 * bármelyiket eltalálhatja. Egy átfestett normáltérkép nem hibázik: némán
 * elrontja a felületet, és a színen semmi nem változik.
 */
const atlas = (() => {
  for (const material of doc.getRoot().listMaterials()) {
    const base = material.getBaseColorTexture();
    if (base) return base;
  }
  return textures.reduce((a, b) => (b.getImage().length > a.getImage().length ? b : a));
})();

const src = sharp(Buffer.from(atlas.getImage()));
const meta = await src.metadata();
const { data, info } = await src.raw().toBuffer({ resolveWithObject: true });

/** A négy célszín, lineáris 0..1-ben. */
const PAINT = {
  //            sötét         közép (tégla)   világos (vakolat)  lomb
  dark:   [0.13, 0.09, 0.19],
  brick:  [0.44, 0.17, 0.12],
  // A vakolat HIDEG csontszín, nem meleg. Az első hangolásomban meleg volt
  // (0.74/0.66/0.70), és mivel a képpontok fele ebbe a sávba esik, az egész
  // falut rózsaszínre húzta — lemérve: nyolc fürtből hat a 346–360 fokos
  // árnyalaton állt. Egy éjszakai falu nem lehet egyszínű, és pláne nem
  // rózsaszín.
  // A vakolat CSONTSZÍN, nem fehér. A második renderen a házak előtti
  // betonlapok világítottak ki — ugyanabba a sávba esnek, mint a fehér
  // házfalak, tehát színből nem lehet szétválasztani őket. Nem is kell: ha a
  // sáv egésze csontszínű a fehér helyett, a lapok elcsendesednek, a fehér
  // ház pedig továbbra is a legvilágosabb ÉPÜLET marad.
  plaster:[0.43, 0.41, 0.51],
  leaf:   [0.10, 0.22, 0.17],
  /**
   * Az ÚTTEST külön osztály, és ez volt a legfontosabb tanulság.
   *
   * Az első változatban nem volt az: a burkolat világos és fakó, tehát a
   * „vakolat" sávba esett, és halvány levendulára festődött. A renderen ez
   * azonnal látszott — az úttest lett a kép LEGVILÁGOSABB eleme, fényesebb
   * minden háznál. Ami nemcsak csúnya, hanem működési hiba is: éjszaka a
   * szem oda néz, ahol a legtöbb fény van, és a játékos figyelme így a
   * semmire kerül a házak helyett.
   *
   * Jele: nagyon fakó ÉS közepesen világos. A fehér házfalak ennél sokkal
   * világosabbak, a tetők sokkal sötétebbek — a sáv tisztán elválik.
   */
  //
  // A szám nem a „legszebb aszfalt", hanem a legsötétebb, amin még VEZETNI
  // lehet. 0,17-tel az atlasz 42 százaléka 23 százalékos világosságra esett,
  // és a burkolat a játék holdfényében gyakorlatilag feketévé vált volna —
  // az úttest pedig az az egy felület, aminek éjszaka is olvashatónak kell
  // maradnia, különben nincs mit vezetni.
  road:   [0.27, 0.25, 0.33],
};

/** Mennyire nyomja el az eredetit a célszín. 1 = teljesen átfestve. */
const STRENGTH = { dark: 0.82, brick: 0.66, plaster: 0.86, leaf: 0.88, road: 0.88 };

/**
 * Megosztott tónus: a mélyek hidegek, a csúcsfények melegek.
 *
 * A csúcsfény melege VISSZAFOGOTT. Erősebben az egész képet a vörös felé
 * húzta, és pont azt a hangulatot vitte el, amiért az egész csinálódik:
 * halloween-narancs a HOLD hidegje MELLETT, nem helyette.
 */
const SHADOW_TINT = [0.40, 0.36, 0.78];
const HIGHLIGHT_TINT = [0.96, 0.86, 0.66];
const SPLIT = 0.30;

/** Éjszaka van. A falu legyen összességében sötétebb, mint amit sütöttek. */
const NIGHT = 0.92;

function toHsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2, d = mx - mn;
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = ((h * 60) + 360) % 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h, s, l];
}

const out = Buffer.alloc(data.length);
const tally = { dark: 0, brick: 0, plaster: 0, leaf: 0, road: 0 };

/**
 * Megosztott tónus: a mélyek hidegek, a csúcsfények melegek.
 *
 * Ez az egy trükk teszi, hogy egy éjszakai kép éjszakainak látsszon, és ne egy
 * nappalinak, amit lesötétítettek. Mindhárom mód használja.
 */
function splitTone(c, l, amount) {
  const t = Math.min(1, Math.max(0, (l - SPLIT) / (1 - SPLIT)));
  return c.map((v, k) => {
    const tint = SHADOW_TINT[k] + (HIGHLIGHT_TINT[k] - SHADOW_TINT[k]) * t;
    return v * (1 - amount) + v * tint * 2 * amount;
  });
}

function write(i, c) {
  out[i] = Math.min(255, Math.max(0, Math.round(c[0] * NIGHT * 255)));
  out[i + 1] = Math.min(255, Math.max(0, Math.round(c[1] * NIGHT * 255)));
  out[i + 2] = Math.min(255, Math.max(0, Math.round(c[2] * NIGHT * 255)));
  if (info.channels === 4) out[i + 3] = data[i + 3];
}

/** Osztályba sorolt képpont átfestése a célszínre. */
function repaint(i, rgb, l, key) {
  const target = PAINT[key];
  const k = STRENGTH[key];
  // A célszín VISZI a színt, de az eredeti világossága marad a RAJZOLAT: a
  // téglák közti fuga, a tetőcserép éle, az ablakkeret mind ebben van. Ha a
  // célszínt laposan ráöntenénk, pont az veszne el, amitől felületnek látszik.
  //
  // A szorzó nem mehet 1 fölé. Enélkül (0.55 + l*0.9) egy 0,95 világosságú
  // képpont 1,41-et kapott, ami a sötétre hangolt célszínt VISSZAVILÁGOSÍTOTTA
  // — ezért maradtak vakítóan fehérek a betonlapok akkor is, amikor a vakolat
  // célszínét csontszínre vittem. A renderen a két beállítás közt alig volt
  // különbség; a szorzó ette meg.
  const shade = Math.min(1.05, 0.55 + l * 0.9);
  write(i, splitTone(rgb.map((v, c) => v * (1 - k) + target[c] * shade * k), l, 0.30));
  tally[key]++;
}

for (let i = 0; i < data.length; i += info.channels) {
  const rgb = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
  const [h, s, l] = toHsl(rgb[0], rgb[1], rgb[2]);

  if (mode === 'gentle') {
    // Nem sorol be semmit: megtartja az árnyalatot, és csak azt teszi, amit
    // egy éjszaka tesz. A HÁZAKHOZ való, ahol van mit elrontani — az
    // osztályozás ott az ablakkeret és a fal közti ÁTMENETI képpontot
    // „téglának" vette, tehát minden élre jutott egy rozsdacsík.
    const grey = (rgb[0] + rgb[1] + rgb[2]) / 3;
    const SAT = 0.72;
    write(i, splitTone(rgb.map((v) => grey + (v - grey) * SAT), l, 0.22));
    tally.plaster++;
    continue;
  }

  if (mode === 'terrain') {
    // Az ÜRES TELKES térképhez, és a szükségességét megmértem.
    //
    // Ennek az atlasza NEM választható szét világosság szerint: a fű, az
    // aszfalt, a burkolat és a faalapzat is 50 és 62 százalék közé esik. A
    // `classify` ezért 58 százalékát „téglának" sorolta volna és vörösre
    // festi, a `gentle` pedig 9 százalékos telítettségre szürkítette (a
    // forrás eleve fakó: 1–26%).
    //
    // Ami ELVÁLASZTJA őket, az az ÁRNYALAT: a fű 79 fokon ül, az aszfalt
    // gyakorlatilag telítetlen, a faalapzat 26 fokon és 26 százalékon. Tehát
    // azt kell kérdezni, ami különbözik.
    let key;
    if (h > 58 && h < 160 && s > 0.09) key = 'leaf';
    else if (s < 0.07) key = l >= 0.66 ? 'plaster' : 'road';
    else if (h < 50 && s > 0.17) key = 'brick';
    else if (l >= 0.66) key = 'plaster';
    else key = 'road';
    repaint(i, rgb, l, key);
    continue;
  }

  // `classify` — a régi, világosság szerinti terep-besorolás.
  let key;
  if (h > 55 && h < 155 && s > 0.16) key = 'leaf';
  else if (l < 0.34) key = 'dark';
  else if (s < 0.15 && l >= 0.50 && l < 0.78) key = 'road';
  else if (l < 0.56) key = 'brick';
  else key = 'plaster';
  repaint(i, rgb, l, key);
}

const painted = await sharp(out, {
  raw: { width: info.width, height: info.height, channels: info.channels },
})
  .webp({ quality: 90 })
  .toBuffer();

atlas.setImage(new Uint8Array(painted)).setMimeType('image/webp');

// A tégla és a vakolat MATT, nem műanyag. Egyetlen anyag van, tehát egyetlen
// érték — de a régi alapértelmezés (0,5 körüli) egy éjszakai jelenetben
// csillogó műanyagot csinál a házfalból.
for (const material of doc.getRoot().listMaterials()) {
  material.setRoughnessFactor(0.92);
  material.setMetallicFactor(0.0);
}

await io.write(output, doc);

const total = Object.values(tally).reduce((a, b) => a + b, 0);
console.log(`atlasz ${meta.width}×${meta.height} → ${(painted.length / 1e6).toFixed(2)} MB`);
for (const [key, n] of Object.entries(tally)) {
  console.log(`  ${key.padEnd(8)} ${((n / total) * 100).toFixed(1).padStart(5)}%`);
}
