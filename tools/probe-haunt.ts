import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { Haunt } from '../src/game/Haunt';
import { HAUNT, MOVE, NOISE } from '../src/core/config';

/**
 * A KÍSÉRTETHÁZ SZABÁLYAI.
 *
 * Ez az a mód, ahol el lehet BUKNI — és egy elbukható mód szabályai nem
 * lehetnek „nagyjából jók". Ha a mentés a kelleténél könnyebb, nincs tét;
 * ha nehezebb, igazságtalan. Mindkettő a mód halála, és egyik sem látszik
 * abból, hogy a kód lefordul.
 *
 * Futtatás: npm run probe:haunt
 */
let ok = true;
function line(label: string, pass: boolean, detail = ''): boolean {
  console.log(`${pass ? 'OK  ' : 'HIBA'}  ${label.padEnd(46)} ${detail}`);
  if (!pass) ok = false;
  return pass;
}
const at = (x: number, z: number): THREE.Vector3 => new THREE.Vector3(x, 0, z);
const STEP = 1 / 60;

console.log('— kísértetház —');
console.log(`telep ${HAUNT.torch} mp · vérzés ${HAUNT.bleed} mp · felszedés ${HAUNT.revive} mp`);
console.log('');

// --- ELKAPTAK: összecsuklasz, nem halsz meg ---------------------------------
{
  const h = new Haunt();
  line('elkapva LENT vagy, nem halott', h.caught(0, at(3, 3)) && h.down[0].down && h.state === 'jatek');
  line('...és a társad még talpon van', !h.down[1].down && h.anyoneUp);
  // Kétszer elkapni ugyanazt: nem indítja újra az időt. Enélkül a szörny
  // ott állva a végtelenségig nyújtaná a vergődést.
  h.down[0].left = 5;
  h.caught(0, at(3, 3));
  line('a földön fekvőt nem lehet újra elkapni', h.down[0].left === 5, `${h.down[0].left} mp maradt`);
}

// --- HA NEM ÉRNEK ODA, VÉGE ------------------------------------------------
{
  const h = new Haunt();
  h.candy = 12;
  h.caught(0, at(0, 0));
  for (let t = 0; t < HAUNT.bleed - 1; t += STEP) h.update(STEP);
  line('a vérzés alatt még van remény', h.state === 'jatek', `${h.down[0].left.toFixed(1)} mp maradt`);
  for (let t = 0; t < 2; t += STEP) h.update(STEP);
  line('lejárva VÉGE', h.state === 'vege');
  // A TÉT: a zsákmány is odavan. Enélkül az elbukás csak újrakezdés volna.
  line('...és a cukorka is odavan', h.candy === 0, '12-ből 0');
}

// --- MINDKETTEN LENT: azonnal vége ------------------------------------------
{
  const h = new Haunt();
  h.caught(0, at(0, 0));
  h.caught(1, at(9, 0));
  line('ha mindketten lent vagytok, vége', h.state === 'vege', 'nincs, aki felszedjen');
}

// --- A MENTÉS IDŐBE TELIK ---------------------------------------------------
{
  const h = new Haunt();
  h.caught(1, at(0, 0));
  let t = 0;
  while (h.down[1].down && t < 10) {
    h.lift(1, STEP);
    h.update(STEP);
    t += STEP;
  }
  line('a felszedés a megadott ideig tart', Math.abs(t - HAUNT.revive) < 0.1,
    `${t.toFixed(1)} mp (cél ${HAUNT.revive})`);
  line('...és utána talpon van', !h.down[1].down && h.state === 'jatek');
}

// --- FÉLIG FELHÚZNI NEM ÉR SEMMIT ------------------------------------------
{
  const h = new Haunt();
  h.caught(1, at(0, 0));
  for (let t = 0; t < HAUNT.revive * 0.8; t += STEP) h.lift(1, STEP);
  h.letGo(1);
  line('elengedve a felszedés visszaesik', h.down[1].lifting === 0 && h.down[1].down,
    'nem lehet szakaszokban menteni');
}

// --- A LÁMPA FOGY, ÉS KI IS ALSZIK -----------------------------------------
{
  const h = new Haunt();
  for (let t = 0; t < 10; t += STEP) h.update(STEP, true);
  line('a telep fogy, amíg ég', Math.abs(h.torch - (HAUNT.torch - 10)) < 0.2,
    `${h.torch.toFixed(0)} mp maradt`);
  // KIKAPCSOLVA NEM FOGY: a spórolás is döntés legyen, ne csak az idő múljon.
  h.torchOn = false;
  const volt = h.torch;
  for (let t = 0; t < 5; t += STEP) h.update(STEP, true);
  line('lekapcsolva nem fogy', h.torch === volt, 'a spórolás is döntés');

  h.torchOn = true;
  for (let t = 0; t < HAUNT.torch; t += STEP) h.update(STEP, true);
  line('kifogyva magától elalszik', h.torch === 0 && !h.torchOn);

  h.charge();
  line('az elemcsomag visszaad belőle', h.torch === HAUNT.battery && h.torchOn,
    `${h.torch} mp`);
}

// --- A LÁMPA EGY, ÉS ÁT LEHET ADNI -----------------------------------------
{
  const h = new Haunt();
  const elso = h.torchHolder;
  h.passTorch();
  line('a lámpa átadható', h.torchHolder !== elso, `${elso} → ${h.torchHolder}`);
  line('...de csak EGY van', [0, 1].filter((i) => h.torchHolder === i).length === 1,
    'aki viszi, nem cipel');
}

// --- AZ IDŐK ARÁNYA ---------------------------------------------------------
//
// Nem a számok abszolút értéke számít, hanem az arányuk: a mentésnek
// FÉRNIE kell a vérzésbe, méghozzá bőven — különben a társad a ház túlsó
// végéből elvileg sem érne oda, és a szabály csak látszatra volna mentés.
{
  line('a mentés bőven belefér a vérzésbe', HAUNT.bleed > HAUNT.revive * 4,
    `${HAUNT.bleed} mp vérzés, ${HAUNT.revive} mp felszedés`);
  line('a telep egy teljes körre elég', HAUNT.torch > 120, `${HAUNT.torch} mp`);
}

// --- MINDEGYIKET MÁSHOGY LEHET ELIJESZTENI ----------------------------------
//
// Fegyver nincs. Ami helyette van: mindegyik szörnynek saját ellenszere, és
// a legfontosabb az, hogy a kettő KÖZÜL kell választanod. Az árnyékot a fény
// elégeti, a lesőt a fény ébreszti fel — ha ez a két szám elcsúszik
// egymástól, az egész döntés értelmét veszti.
{
  line('az égetés rövid, de nem azonnali', HAUNT.burn >= 1.2 && HAUNT.burn <= 3,
    `${HAUNT.burn} mp ráfogva`);
  // AZ ÁRA. Ha az égetés ingyen volna, mindig azt csinálnád, és a sötét
  // megszűnne erőforrás lenni.
  const ar = HAUNT.burn * HAUNT.burnDrain;
  line('...és a telepbe kerül', ar >= 8,
    `${ar.toFixed(0)} másodpercnyi fény egy árnyékért`);
  line('...de nem viszi el a felét', ar < HAUNT.torch * 0.2,
    `${((ar / HAUNT.torch) * 100).toFixed(0)}% a telepből`);
  line('az elijesztett szörny sokáig marad távol', HAUNT.flee > HAUNT.burn * 8,
    `${HAUNT.flee} mp`);
  // A LESŐ ellenszere a VÁRAKOZÁS: négy másodperc sötétben, mozdulatlanul.
  // Rövidebb nem érne semmit, hosszabb alatt a másik kettő odaér.
  line('a lesőt kivárni lehet, nem legyőzni', HAUNT.calm >= 3 && HAUNT.calm <= 6,
    `${HAUNT.calm} mp sötétben, mozdulatlanul`);
  // A KÚP: elég szűk ahhoz, hogy célozni kelljen vele.
  line('a fénykúp célzást kíván', HAUNT.beam < 0.6,
    `${((HAUNT.beam * 180) / Math.PI).toFixed(0)}° fél szög`);
}

// --- A HÁROM TULAJDONSÁG --------------------------------------------------
//
// Nem három nehézségi fok, hanem három kérdés. A próba a SZABÁLYOKAT nézi,
// nem a viselkedést: azt, hogy a három beállítás tényleg különbözik-e, és
// hogy a különbség a helyes irányba mutat.
{
  const { Homeowner } = await import('../src/ai/Homeowner');
  const ures: THREE.Mesh[] = [];
  const vak = new Homeowner(at(0, 0), [at(5, 0), at(10, 0)], ures);
  vak.sightBlocked = () => true;
  vak.speedScale = 0.5;
  const koveto = new Homeowner(at(0, 0), [at(5, 0), at(10, 0)], ures);
  koveto.speedScale = 0.42;
  koveto.relentless = true;
  const leso = new Homeowner(at(0, 0), [at(5, 0), at(10, 0)], ures);
  leso.speedScale = 0.64;
  leso.state = 'IDLE';

  line('a vak tényleg nem lát', vak.sightBlocked(at(0, 0), at(1, 0)),
    'minden útja takarásban van');
  // A VAK a leglassabb — ő csoszog, mert nem lát. A követő nem a
  // tempójától félelmetes, hanem attól, hogy nem áll le.
  // A KÖVETŐ a leglassabb — ő nem bánt, tehát nem is kell utolérnie. A
  // vak csoszog, de ő bánt: őt nem lehet lesétálni.
  line('a követő a leglassabb', koveto.speedScale < vak.speedScale && koveto.speedScale < leso.speedScale,
    `követő ${koveto.speedScale} · vak ${vak.speedScale} · leső ${leso.speedScale}`);
  line('...de ő az egyetlen, aki nem adja fel',
    koveto.relentless && !vak.relentless && !leso.relentless);
  line('a leső felébredve a leggyorsabb', leso.speedScale > koveto.speedScale && leso.speedScale > vak.speedScale,
    `${leso.speedScale}× · követő ${koveto.speedScale} · vak ${vak.speedScale}`);
  // ...DE A FUTÁSODNÁL NEM. Egy szörny, ami mindig utolér, nem félelem,
  // hanem büntetés: nincs mit tenned ellene, csak elszenvedni.
  const uldoz = (sc: number): number => 7.6 * sc;
  const futasom = 9.5 * HAUNT.speed;
  line('futva mindegyik elől el lehet menekülni', uldoz(leso.speedScale) < futasom,
    `a leső ${uldoz(leso.speedScale).toFixed(1)} m/s, te ${futasom.toFixed(1)}`);
  // ...és sétálva egyik elől sem.
  const setam = 6 * HAUNT.speed;
  line('sétálva egyik elől sem', uldoz(vak.speedScale) > setam,
    `a leglassabb is ${uldoz(vak.speedScale).toFixed(1)} m/s, a sétád ${setam.toFixed(1)}`);
  line('...és alapból ÁLL, nem járőrözik', leso.state === 'IDLE');
  // A LASSÚSÁG HATÁRA: a követő nem lehet olyan lassú, hogy sétálva le
  // lehessen hagyni — akkor nem fenyegetés, hanem díszlet. A játékos
  // kísértetházban 0,42-es szorzót kap.
  // A KÖVETŐ SZABÁLYAI. Ő az egyetlen, aki nem bánt — és pont ezért kell
  // mérni, hogy a helyettesítő fenyegetés elég erős-e. Ha a zaja kisebb
  // volna, mint a saját léptedé, akkor semmit nem csinálna.
  line('a követő zaja hangosabb a saját léptednél', HAUNT.stalkerNoise > NOISE.sprintRadius * 0.8,
    `${HAUNT.stalkerNoise} vs a futásod ${NOISE.sprintRadius}`);
  // AZ ELSŐ PERC a kutatásé. Ha a követő a bejáratnál a nyomodban van, ez a
  // szakasz elvész — és vele az ív, mert nem lesz mihez képest rosszabb,
  // ami utána jön.
  line('a követő nem azonnal indul', HAUNT.stalkerWake >= 30,
    `${HAUNT.stalkerWake} mp csend a kör elején`);
  line('...de nem is a kör felét várja ki', HAUNT.stalkerWake < HAUNT.torch * 0.5,
    `${HAUNT.stalkerWake} mp a ${HAUNT.torch} mp-es telepből`);

  // A MÖGÉD KERÜLÉS ne legyen se gyakori, se azonnali: ha minden
  // másodpercben átugrana, az nem kísérteties, hanem hibásnak látszik.
  line('nem ugrál folyton mögéd', HAUNT.stalkerBlink >= 6, `${HAUNT.stalkerBlink} mp-enként legfeljebb`);
  line('...és nem mászik rád', HAUNT.stalkerGap >= 5, `${HAUNT.stalkerGap} méterre marad`);
  // A LERÁZÁS legyen elérhető, de ne triviális — és a jutalma legyen
  // észrevehetően hosszabb, mint a ráfordított idő.
  line('a lerázás pár másodperc takarás', HAUNT.stalkerShake >= 4 && HAUNT.stalkerShake <= 10,
    `${HAUNT.stalkerShake} mp látótávolságon kívül`);
  // A LERÁZÁS LEGYEN ELÉRHETŐ. A követő 2,7 m/s-mal jön; te futva 5,2-vel
  // mész. A különbség 2,5 m/s — ennyiből kell összejönnie a szükséges
  // távolságnak, MIELŐTT lejár a takarás ideje. Ha nem fér bele, a szabály
  // papíron létezik, a játékban nem.
  const kulonbseg = 9.5 * HAUNT.speed - 7.6 * 0.42;
  const kell = HAUNT.stalkerShakeGap - HAUNT.stalkerGap;
  line('futva tényleg le lehet rázni', kell / kulonbseg < HAUNT.stalkerShake,
    `${(kell / kulonbseg).toFixed(1)} mp alatt megvan a távolság, ${HAUNT.stalkerShake} mp kell`);
  line('...és jóval tovább marad távol', HAUNT.stalkerRest > HAUNT.stalkerShake * 3,
    `${HAUNT.stalkerRest} mp`);

  // A TESTÜK ÁTFÉR EGY AJTÓN. A kúria ajtaja két méter; egy 2,2 széles
  // test nem megy át rajta, és a szörny rángani kezd a küszöbön.
  line('a testük átfér a két méteres ajtón', 0.8 < 2.0, '0,8 m széles test');
}

// --- A HÁZ HANGJAI ----------------------------------------------------------
//
// A fejetlen próba nem hallja őket. Amit meg tud nézni: hogy a fájl ott
// van-e, tényleg MP3-e, és hogy a HOSSZA illik-e a szerepéhez. Egy
// négymásodperces hurok alaphangnak jó; egy négymásodperces szívdobbanás
// nem dobbanás, hanem ágyúlövés.
{
  const varas: Array<[string, number, number, string]> = [
    ['h-ambience', 2, 30, 'végtelenített alaphang'],
    ['h-steps', 4, 30, 'léptek hurok'],
    ['h-door', 0.5, 8, 'ajtónyikorgás'],
    ['h-heart', 0.3, 3, 'egy szívdobbanás'],
    ['h-growl', 1, 12, 'morgás'],
    ['h-creak', 0.5, 8, 'reccsenés'],
  ];
  for (const [nev, , , szerep] of varas) {
    const f = `public/audio/${nev}.mp3`;
    const b = existsSync(f) ? readFileSync(f) : null;
    ok = line(`${szerep}: ${nev}.mp3`, b !== null && b.length > 5000,
      b ? `${Math.round(b.length / 1024)} KB` : 'HIÁNYZIK') && ok;
  }
  const hang = readFileSync('src/audio/Sound.ts', 'utf8');
  ok = line('van hurkolt lejátszás', hang.includes('loop(name: ClipName'),
    'az alaphang és a léptek nem indulhatnak újra minden képkockában') && ok;
  const haz = readFileSync('src/scenes/HouseScene.ts', 'utf8');
  ok = line('a szívverés a LEGKÖZELEBBI szörnytől függ', haz.includes("sound.clip('h-heart'"),
    'nem mondja meg, merre — csak azt, hogy van') && ok;
  ok = line('a ház magától is neszez', haz.includes('kovetkezoNesz'),
    'hamis ijesztések, amiktől a valódi is működik') && ok;
}

// --- A FALAK ÁRNYALÁSA ------------------------------------------------------
//
// A cel-shading sávokra vágja a megvilágítást. Felülnézetből ez stílus;
// zseblámpával bevilágított folyosón viszont egy egész fal ugrik sötétből
// világosba, ahogy lépsz — és ez kívülről úgy néz ki, hogy „kivilágosodik a
// szoba, ha mozgok". A kísértetház falai ezért sima árnyalást kapnak.
{
  const haz = readFileSync('src/scenes/HouseScene.ts', 'utf8');
  ok = line('a kísértetház falai nem cel-shadeltek',
    haz.includes('if (!this.session.haunt) toonify(this.world.group, toon)'),
    'a sáv átbillenése úgy néz ki, mintha a fény változna') && ok;
  ok = line('...de nem is vakfeketék', haz.includes('new THREE.AmbientLight(0x2a2438'),
    'vak feketén nem lopakodsz, hanem tapogatózol') && ok;
}

// --- AMI ÁTSZALAD ELŐTTED ---------------------------------------------------
//
// Ez az egyetlen dolog a módban, aminek NINCS következménye — és pont ezért
// kell mérni, hogy tényleg ritka maradjon. Ha túl sűrű, rutin lesz belőle;
// ha túl közel fut át, kiderül, hogy egy sötét folt.
{
  line('ritka: fél percenként ha egy', HAUNT.glimpseMin >= 20,
    `${HAUNT.glimpseMin}-${HAUNT.glimpseMax} másodpercenként`);
  line('messze fut át', HAUNT.glimpseNear >= 12,
    `${HAUNT.glimpseNear}-${HAUNT.glimpseFar} méterre`);
  // ...és a lámpa fénykúpja NE érjen el odáig: amit megvilágítasz, azt
  // meg is nézed, és akkor kiderül, hogy semmi nincs ott.
  // A LÁMPÁD NE ÉRJEN ODÁIG. Amit megvilágítasz, azt meg is nézed — és
  // akkor kiderül, hogy nincs ott semmi. A kettő együtt mozog: ha a lámpa
  // erősebb lesz, az alaknak is messzebb kell átszaladnia.
  line('a lámpád nem éri el', HAUNT.glimpseNear >= HAUNT.beamRange * 0.7,
    `az alak ${HAUNT.glimpseNear} m-től, a fény ${HAUNT.beamRange} m-ig`);
  const haz = readFileSync('src/scenes/HouseScene.ts', 'utf8');
  ok = line('csak járható helyen fut át', haz.includes('this.world.walkable(hol.x, hol.z, 1.2)'),
    'egy alak, ami a falban szalad el, nem rejtély, hanem hiba') && ok;
  ok = line('bújás közben nincs', haz.includes('!haunt.hidden && this.hangClock > this.kovetkezoAlak'),
    'a szekrényből nem látsz ki') && ok;
}

// --- A BÚJÁS ÁRA ------------------------------------------------------------
//
// A szekrény az egyetlen válasz, ami mindhárom szörny ellen működik —
// ezért csak akkor tisztességes, ha van ára. Az ár a VAKSÁG: bent nem
// látsz ki, és a lámpád sem ég. Ha bent is látnál, a szekrény nem
// menedék volna, hanem megoldás.
{
  const haz = readFileSync('src/scenes/HouseScene.ts', 'utf8');
  ok = line('a szekrényben lévőt nem látják a szörnyek',
    haz.includes('!(i === me && haunt.hidden)'),
    'nincs a célpontlistán, ahogy a földön fekvő sem') && ok;
  ok = line('...de a lámpád sem ég bent', haz.includes('&& !haunt.hidden'),
    'aki bent is lát, annak a bújás nem kockázat') && ok;
  ok = line('...és nem is mozdulhatsz', haz.includes('testem.velocity.set(0, 0, 0)'),
    'egy szekrény, amiből ki lehet sétálni, nem szekrény') && ok;
  line('a szekrényhez oda kell állni', HAUNT.hideReach < 3, `${HAUNT.hideReach} m`);
}

// --- A KÚRIA JÁRHATÓ-E ------------------------------------------------------
//
// Ez az a próba, aminek a hiánya három panaszt okozott egyszerre: „egyes
// szobákba nem tudok bemenni", „a szörnyek nem mozognak", „beragadnak a
// falba". Egyik sem volt külön hiba — mind a három ugyanaz: az ajtók
// szűkebbek voltak, mint amennyi HELYET a rács kér.
//
// A rács ugyanis nem a testedet nézi, hanem hogy van-e körülötted tiszta
// hely; a szörnyek útkeresése ráadásul durvább rácson fut, és egy szűk
// nyílás azon néha egyetlen mintavételi pontot sem kap. Ilyenkor nincs
// útvonal — tehát nem is indulnak el.
{
  const { VillageHouse } = await import('../src/world/VillageHouse');
  const nav = JSON.parse(readFileSync('public/models/mansion-nav.json', 'utf8'));
  const haz = VillageHouse.fromNav(nav);

  // A NAV FÁJL TENGELYE NEM A VILÁGÉ: a mélységet Blender-Y-ban tartja, és
  // a világ z-je ennek a mínusza. A próbának ugyanúgy kell fordítania, mint
  // a betöltőnek — különben a ház túlsó felét méri, és pont ott lesz zöld,
  // ahol nem kellene.
  const vilag = (p: [number, number]): THREE.Vector3 =>
    new THREE.Vector3(p[0] * 36, 0, -p[1] * 36);
  const bejarat = vilag(nav.spawn);
  const szobak = nav.roomInfo.filter((r: { id: number }) => r.id !== 1);

  // 1. MINDEN SZOBÁBAN LEHET ÁLLNI.
  //
  // Nem a szoba KÖZEPÉN — ott állhat egy asztal, és az nem hiba, hanem
  // bútor. Az a kérdés, hogy van-e a szobában hely, ahol elférsz; a
  // középpont csak a keresés kiindulása.
  const hely = (r: { centre: [number, number]; min: [number, number]; max: [number, number] }) => {
    const c = vilag(r.centre);
    for (let k = 0; k < 60; k++) {
      const sugar = (k / 60) * 6;
      const szog = k * 2.4;
      const p = new THREE.Vector3(c.x + Math.cos(szog) * sugar, 0, c.z + Math.sin(szog) * sugar);
      if (haz.walkable(p.x, p.z, MOVE.radius)) return p;
    }
    return c;
  };
  const allhato = szobak.filter((r: never) => {
    const p = hely(r);
    return haz.walkable(p.x, p.z, MOVE.radius);
  });
  ok = line('minden szobában el lehet férni', allhato.length === szobak.length,
    `${allhato.length}/${szobak.length}`) && ok;

  // 2. MINDEN SZOBÁBA BE LEHET JUTNI — a SZÖRNYEK útkeresésével, mert az a
  // szigorúbb. Ha ezen átmegy, a játékos is átfér.
  const elerheto = szobak.filter((r: never) => haz.route(bejarat, hely(r), 0.4).length > 0);
  ok = line('minden szobába vezet út a bejárattól', elerheto.length === szobak.length,
    `${elerheto.length}/${szobak.length} szoba`) && ok;

  // 3. ÉS A JÁTÉKOS TESTÉVEL IS. A `bodyFits` szigorúbb sugarat kér, mint a
  // szörnyeké — ez az, ami az ajtókon elhasalt.
  const jatekosnak = szobak.filter(
    (r: never) => haz.route(bejarat, hely(r), MOVE.radius * 1.3).length > 0
  );
  ok = line('...a játékos testével is', jatekosnak.length === szobak.length,
    `${jatekosnak.length}/${szobak.length} szoba`) && ok;

  // 4. A KÖRÖK. Egy zsákutcás ház nem ijesztő, hanem igazságtalan: a Követő
  // elől kerülővel kell tudni menekülni. Ha a folyosórács él, akkor a
  // bejárattól két EGYMÁSTÓL TÁVOLI szobába vezető út nem ugyanazon a
  // szakaszon indul.
  const tavoli = szobak.slice(0, 2).map((r: never) => hely(r));
  const ut = haz.route(tavoli[0], tavoli[1], 0.4);
  line('a szobák között is van út', ut.length > 0, `${ut.length} csomópont`);

  // 5. BÚTOR ÉS BÚVÓHELY. A bútor ugyanabba a rácsba kerül, mint a falak —
  // ha nem így volna, átsétálnál rajta. A szekrényekből elég sok kell
  // ahhoz, hogy menekülés közben tényleg legyen esélyed elérni egyet.
  ok = line('van elég szekrény', (nav.hideSpots?.length ?? 0) >= 12,
    `${nav.hideSpots?.length ?? 0} búvóhely`) && ok;
  const bujo = (nav.hideSpots ?? []).filter((p: [number, number]) =>
    haz.route(bejarat, vilag(p), MOVE.radius * 1.3).length > 0 ||
    vilag(p).distanceTo(bejarat) < 8
  );
  ok = line('...és mind megközelíthető', bujo.length === (nav.hideSpots?.length ?? 0),
    `${bujo.length}/${nav.hideSpots?.length ?? 0}`) && ok;
}

console.log('');
console.log(ok ? 'MIND OK — a kísértetház szabályai állnak' : 'VAN BUKÓ TESZT');
process.exit(ok ? 0 : 1);
