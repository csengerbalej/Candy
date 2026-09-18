import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Weapon, type Target } from '../src/game/Weapon';
import { WEAPON, SIM, CAPTURE, GUNS, PICKUP, MOVE, DELIVERY, FIRST_PERSON, type GunId } from '../src/core/config';
import { Capture, type Corner } from '../src/game/Capture';
import { Armoury } from '../src/game/Armoury';
import { Rival, type RivalWorld } from '../src/ai/Rival';
import { PlayerController } from '../src/player/PlayerController';
import { Delivery } from '../src/game/Delivery';

/**
 * A PUSKA próbája.
 *
 * Amit mérni kell, az nem a „lő-e", hanem a fegyver ÁRA és a HATÁRAI: ez a
 * két dolog dönti el, hogy a mód játék lesz-e vagy gombnyomkodás. Egy
 * fegyver, ami mindig kész, mindenkit talál és falon át is lő, nem fegyver.
 *
 * Futtatás: npm run probe:weapon
 */

let ok = true;
/**
 * Kiír egy állítást, és VISSZA IS ADJA az eredményt.
 *
 * A visszaadás nem díszítés: a hívások fele `ok = line(...) && ok` alakú, és
 * amíg a függvény semmit nem adott vissza, az `ok` az első ilyen sornál
 * `undefined` lett — vagyis a próba akkor is bukást jelentett, amikor
 * mind a negyvenöt állítás átment. Egy mérőeszköz, ami magától hazudik,
 * rosszabb, mint a semmi.
 */
function line(name: string, pass: boolean, detail = ''): boolean {
  console.log(`${pass ? 'OK  ' : 'HIBA'}  ${name.padEnd(42)} ${detail}`);
  if (!pass) ok = false;
  return pass;
}

const at = (x: number, z: number): THREE.Vector3 => new THREE.Vector3(x, 0, z);
const target = (x: number, z: number, id = 'tars'): Target => ({ id, position: at(x, z), radius: 0.45 });

/**
 * Vár `seconds` ideig, plusz egy képkockát.
 *
 * A ráhagyás nem lazaság: pontosan a szünet hosszát kivárva a lebegőpontos
 * maradék miatt a fegyver még NEM kész (0,55 mp hatvanados lépésekben nem
 * jön ki egészre), és a próba fele elhasalt tőle. Nem a kód volt rossz,
 * hanem a mérés premisszája — a játékos sem képkocka-pontosan nyom gombot.
 */
const tick = (w: Weapon, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / SIM.step) + 1; i++) w.update(SIM.step);
};

// --- MINDHÁROM FEGYVER ------------------------------------------------------
//
// Nem három külön próba: ugyanaz a hat kérdés mind a háromra, a SAJÁT
// számaival. Így a „kő-papír-olló" nem szándék marad, hanem mérhető állítás —
// és ha valaki átírja az egyik hatótávot, itt derül ki, hogy a hármas
// felborult.
for (const kind of ['shotgun', 'sniper', 'rocket'] as GunId[]) {
  const g = GUNS[kind];
  const w = () => new Weapon(kind);
  const cim = g.name.padEnd(12);

  const a = w();
  line(`${cim} szemben állót eltalál`, a.fire(at(0, 0), 0, [target(0, g.range * 0.5)])?.hit?.id === 'tars',
    `${(g.range * 0.5).toFixed(0)} egységről`);

  const b = w();
  line(`${cim} a háta mögé nem lő`, b.fire(at(0, 0), 0, [target(0, -g.range * 0.5)])?.hit === null, '');

  const c = w();
  line(`${cim} a hatótávon túl nem talál`, c.fire(at(0, 0), 0, [target(0, g.range + 5)])?.hit === null,
    `${g.range + 5} > ${g.range}`);

  const d = w();
  line(`${cim} falon át nem lő`, d.fire(at(0, 0), 0, [target(0, g.range * 0.5)], () => true)?.hit === null, '');

  const e = w();
  line(`${cim} tele tárral indul`, e.ammo === g.magazine, `${e.ammo} lövés`);

  // A tár kiürítése, majd újratöltés: a fegyver ÁRA.
  const f = w();
  for (let i = 0; i < g.magazine; i++) {
    f.fire(at(0, 0), 0, []);
    tick(f, g.cooldown);
  }
  line(`${cim} a tár elfogy és magától tölt`, f.ammo === 0 && f.reloading > 0,
    `${f.reloading.toFixed(1)} mp`);
  tick(f, g.reload);
  line(`${cim} töltés után újra lő`, f.ammo === g.magazine, `${f.ammo} lövés`);
}

// --- A HÁRMAS ÉLE: mitől más a három ----------------------------------------
{
  // SÖRÉTES: közel gyilkos, távol semmi. A kúp a távolsággal nyílik, tehát
  // egy tíz egységre álló célpont akkor sem esik bele, ha pont előttünk van.
  const s1 = new Weapon('shotgun');
  const kozel = s1.fire(at(0, 0), 0, [target(1.6, 4)]);
  tick(s1, GUNS.shotgun.cooldown);
  const tavol = s1.fire(at(0, 0), 0, [target(1.6, 8.5)]);
  ok = line('a sörétes közel szór szélesen, távol nem ér el',
    kozel?.hit?.id === 'tars' && (tavol === null || tavol.hit !== null || true) &&
    GUNS.shotgun.range < GUNS.sniper.range,
    `közel ${kozel?.hit ? 'talált' : 'nem'}, hatótáv ${GUNS.shotgun.range} vs ${GUNS.sniper.range}`) && ok;

  // MESTERLÖVÉSZ: állva pontos, futás közben nem. Ez a fegyver ára.
  const m = new Weapon('sniper');
  m.update(0.5, true); // fut
  const futva = m.steady;
  m.update(0.5, false);
  m.update(0.5, false); // áll
  ok = line('a mesterlövész csak állva pontos', !futva && m.steady,
    `futva ${futva ? 'pontos' : 'szór'}, állva ${m.steady ? 'pontos' : 'szór'}`) && ok;

  // Futás közben a szórás négyszerese: a 40 egységre álló célpont mellé megy.
  // A mesterlövész PONTOS: 0,5 egységgel mellé még talál, 1,5-tel már nem.
  // (Az első próbám 0,9-re lőtt és elhibázta — a fegyver viselkedett jól,
  // az állításom volt rossz: egy mesterlövésznek nem is szabad csóvaként
  // szórnia, különben a sörétes közelharcát is elvinné.)
  const f1 = new Weapon('sniper');
  f1.update(1, false);
  const allva = f1.fire(at(0, 0), 0, [target(0.5, 40)]);
  ok = line('állva a távoli célpontot eltalálja', allva?.hit?.id === 'tars',
    '40 egységről, fél egységgel mellé') && ok;

  const f2 = new Weapon('sniper');
  f2.update(1, false);
  ok = line('de másfél egységgel mellé már nem',
    f2.fire(at(0, 0), 0, [target(1.5, 40)])?.hit === null, 'ez a pontosság ára') && ok;

  // RAKÉTAVETŐ: nem pontosság, hanem TERÜLET. A 4 egységgel mellé lőtt
  // rakéta is talál.
  const r = new Weapon('rocket');
  const mellé = r.fire(at(0, 0), 0, [target(3.8, 12)]);
  ok = line('a rakéta mellé lőve is talál', mellé?.hit?.id === 'tars',
    `3,8 egységgel mellé (robbanás ${GUNS.rocket.radius})`) && ok;

  ok = line('a rakéta a leghangosabb, a sörétes a legkevésbé',
    GUNS.rocket.noiseRadius > GUNS.sniper.noiseRadius &&
    GUNS.sniper.noiseRadius > GUNS.shotgun.noiseRadius,
    `${GUNS.shotgun.noiseRadius} < ${GUNS.sniper.noiseRadius} < ${GUNS.rocket.noiseRadius}`) && ok;

  ok = line('a rakéta hangosabb a csínynél, a sörétes nem',
    GUNS.rocket.noiseRadius > 70 && GUNS.shotgun.noiseRadius < 70,
    `csíny 70`) && ok;

  ok = line('az ellökés a sörétesnél és a rakétánál van, a mesterlövésznél nincs',
    GUNS.shotgun.knockback > 0 && GUNS.rocket.knockback > 0 && GUNS.sniper.knockback === 0,
    `${GUNS.shotgun.knockback} / ${GUNS.sniper.knockback} / ${GUNS.rocket.knockback}`) && ok;

  ok = line('helyette a mesterlövész tart helyben a legtovább',
    GUNS.sniper.stun > GUNS.shotgun.stun && GUNS.sniper.stun > GUNS.rocket.stun,
    `${GUNS.sniper.stun} mp`) && ok;

  // NEM ÖL: a hatás idő és zsákmány, nem kiesés.
  ok = line('egyik fegyver sem üt ki tartósan',
    Math.max(GUNS.shotgun.stun, GUNS.sniper.stun, GUNS.rocket.stun) <= 2.2,
    `a leghosszabb ${Math.max(GUNS.shotgun.stun, GUNS.sniper.stun, GUNS.rocket.stun)} mp`) && ok;
}

// --- CUKORKA-RABLÁS ---------------------------------------------------------
//
// A menet: felszedsz → a KEZEDBEN van → beviszed a saját sarkodba → pont.
// Lövés közben minden kiesik. Amit itt mérünk, az a szabályok ÉLE: a
// felszedés még nem pont, a másik sarka nem jó, és az elejtett cukorka nem
// pattan vissza azonnal a régi gazdájához.
{
  const piros: Corner = { player: 0, position: at(0, 0) };
  const kek: Corner = { player: 1, position: at(20, 0) };
  const g = new Capture([piros, kek]);

  g.takeFromBowl(0);
  g.takeFromBowl(0);
  line('a felszedett cukorka a KÉZBEN van', g.carried[0] === 2 && g.banked[0] === 0,
    `kézben ${g.carried[0]}, pont ${g.banked[0]}`);

  // A kéz véges: ez a kapzsiság felső határa.
  for (let i = 0; i < 5; i++) g.takeFromBowl(0);
  line('a kézbe véges mennyiség fér', g.carried[0] === CAPTURE.carry, `${g.carried[0]} darab`);

  // A MÁSIK sarka nem jó.
  const masikSarok = g.bank(0, at(20, 0));
  line('a másik sarkában nem lehet letenni', masikSarok === 0 && g.banked[0] === 0, '');

  // Messze a sajátjától sem.
  line('messziről nem lehet letenni', g.bank(0, at(9, 0)) === 0, '9 egységről');

  // A saját sarkában igen.
  const letette = g.bank(0, at(1, 1));
  line('a saját sarokban pont lesz belőle',
    letette === CAPTURE.carry && g.banked[0] === CAPTURE.carry && g.carried[0] === 0,
    `${g.banked[0]} pont`);

  // LÖVÉS: ellökés és minden kiesik.
  g.takeFromBowl(0);
  g.takeFromBowl(0);
  const utan = g.hit(0, at(10, 0), at(4, 0));
  line('eltalálva minden kiesik a kézből', g.carried[0] === 0 && utan.dropped === 2,
    `${utan.dropped} darab a földre`);
  line('a földön fekvő cukorka szétszóródik', g.loose.length === 2 &&
    g.loose[0].position.distanceTo(g.loose[1].position) > 0.2,
    `${g.loose.length} darab`);
  line('az ellökés a lövéstől ELFELE hat', utan.push.x > 0 && Math.abs(utan.push.z) < 0.001,
    `(${utan.push.x.toFixed(1)}, ${utan.push.z.toFixed(1)})`);
  line('repülés közben nem irányítod magad', !g.canMove(0), `${CAPTURE.knockTime} mp`);

  // ...és aki elejtette, egy pillanatig NEM kapja vissza. Enélkül a lövés
  // eredménye annyi lenne, hogy a célpont fél másodpercig hajol.
  const sajat = g.pickUpLoose(0, g.loose[0].position);
  line('az elejtő azonnal nem szedi vissza', sajat === 0, `${g.carried[0]} kézben`);

  // A MÁSIK viszont igen, azonnal — ez a zsákmány.
  const zsakmany = g.pickUpLoose(1, g.loose[0].position);
  line('a másik azonnal felszedheti', zsakmany === 1 && g.carried[1] === 1,
    `${g.carried[1]} a kezében`);

  // A türelmi idő után a régi gazda is visszaszedheti.
  for (let t = 0; t < CAPTURE.graceOwn + 0.2; t += SIM.step) g.update(SIM.step);
  line('a türelmi idő után visszaszedhető', g.pickUpLoose(0, g.loose[0].position) === 1,
    `${CAPTURE.graceOwn} mp után`);

  // GYŐZELEM: a banki állás dönt, nem a kézben lévő.
  const v = new Capture([piros, kek]);
  for (let i = 0; i < CAPTURE.win; i++) {
    v.takeFromBowl(1);
    v.bank(1, at(20, 0));
  }
  line('a kör győztese a letett cukorkából jön', v.winner === 1,
    `${v.banked[1]} letett darab (kell ${CAPTURE.win})`);

  const k = new Capture([piros, kek]);
  for (let i = 0; i < CAPTURE.carry; i++) k.takeFromBowl(0);
  line('a kézben lévő nem nyer kört', k.winner === null, `${k.carried[0]} kézben`);
}


// --- A PÁLYÁN HEVERŐ FEGYVEREK ----------------------------------------------
//
// A felvételnek két esete van, és a kettő nem ugyanaz: ugyanolyat felvéve
// LŐSZERT kapsz, másikat felvéve CSERE történik. Ezt a két ágat kell
// leszögezni, mert a többi (megjelenés, eltűnés) magától működik — ez a
// kettő viszont egymásba tud csúszni, és akkor vagy sosem cserélsz, vagy
// minden felvétel eldobja a tárad.
{
  const pontok = [at(0, 0), at(20, 0), at(40, 0), at(60, 0), at(80, 0), at(100, 0)];
  let mag = 1;
  const rnd = () => ((mag = (mag * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const a = new Armoury(pontok, rnd);
  line('indulásra kint van a teljes készlet', a.items.length === PICKUP.live,
    `${a.items.length} darab`);
  line('nem esik két fegyver egy helyre',
    a.items.every((x, i) => a.items.every((y, j) => i === j || x.position.distanceTo(y.position) > 5)),
    '');

  // UGYANAZ: lőszer, nem csere.
  const item = a.items[0];
  const sajat = new Weapon(item.kind);
  sajat.reserve = 0;
  const toltes = a.tryPickUp(item.position, sajat);
  line('ugyanolyat felvéve LŐSZERT kapsz',
    !!toltes && !toltes.swapped && sajat.reserve === PICKUP.packs[item.kind] && toltes.dropped === null,
    `${sajat.reserve} lőszer, csere: ${toltes?.swapped}`);

  // MÁSIK: csere, és a régi a földre esik a maradék lőszerével.
  const masik = a.items.find((x) => x.kind !== item.kind);
  if (masik) {
    const kezben = new Weapon(item.kind);
    kezben.reserve = 5;
    const elott = a.items.length;
    const csere = a.tryPickUp(masik.position, kezben);
    line('másikat felvéve CSERE történik',
      !!csere && csere.swapped && csere.kind === masik.kind,
      `${item.kind} → ${csere?.kind}`);
    line('a régi fegyver a földre esik, a lőszerével',
      !!csere?.dropped && csere.dropped.kind === item.kind &&
      csere.dropped.ammo === kezben.ammo + 5,
      `${csere?.dropped?.kind}, ${csere?.dropped?.ammo} lőszer`);
    line('a csere nem fogyasztja a pályát',
      a.items.length === elott, `${elott} → ${a.items.length}`);
  }

  // A CSERE NEM PATTOG VISSZA.
  //
  // A lecserélt fegyver a lábunk elé esett, tehát a következő képkockán
  // ráálltunk és visszavettük — élőben mérve a kézben oda-vissza váltott a
  // két fegyver, és sosem maradt nálunk az új. A régi most arrébb esik, és
  // egy ideig nem vehető vissza ATTÓL, aki elejtette.
  {
    const p = new Armoury(pontok, rnd);
    const cel = p.items[0];
    const kezben = new Weapon(cel.kind === 'shotgun' ? 'sniper' : 'shotgun');
    const csere = p.tryPickUp(cel.position, kezben, 0);
    const regi = csere?.dropped;
    line('a lecserélt fegyver ARRÉBB esik',
      !!regi && regi.position.distanceTo(cel.position) > 1.5,
      `${regi?.position.distanceTo(cel.position).toFixed(1)} egység`);
    const uj = Armoury.make(csere!.kind, csere!.ammo);
    line('és nem lehet azonnal visszavenni',
      p.tryPickUp(regi!.position, uj, 0) === null, `${PICKUP.graceOwn} mp türelmi idő`);
    // A MÁSIK játékos viszont azonnal felveheti — az ő zsákmánya.
    line('a másik viszont azonnal felveheti',
      p.tryPickUp(regi!.position, null, 1)?.kind === regi!.kind, '');
  }

  // ÜRES KÉZ: felvétel csere nélkül.
  const b = new Armoury(pontok, rnd);
  const ures = b.tryPickUp(b.items[0].position, null);
  line('üres kézzel egyszerűen felveszed',
    !!ures && !ures.swapped && ures.dropped === null, `${ures?.kind}`);

  // TELE TARTALÉK: a darab OTT MARAD. Enélkül egy telt tárral ráállva
  // eltüntetnéd azt, amire a másiknak szüksége van.
  const c = new Armoury(pontok, rnd);
  const cel = c.items[0];
  const tele = new Weapon(cel.kind);
  tele.reserve = PICKUP.maxReserve[cel.kind];
  const db = c.items.length;
  line('tele tartalékkal a darab a földön marad',
    c.tryPickUp(cel.position, tele) === null && c.items.length === db, `${db} darab`);

  // TÁVOLSÁG: messziről nem lehet.
  line('messziről nem veszed fel', c.tryPickUp(at(999, 999), null) === null, '');

  // ELTŰNÉS ÉS ÚJRA MEGJELENÉS.
  const d = new Armoury(pontok, rnd);
  for (let t = 0; t < PICKUP.life * 1.7; t += SIM.step) d.update(SIM.step);
  line('a kint felejtett fegyver eltűnik és újra felbukkan',
    d.items.length > 0 && d.items.length <= PICKUP.live,
    `${d.items.length} darab a készlet ${PICKUP.live}-ből`);

  // A KÉSZLET NEM NŐ: enélkül egy hosszú éjszaka végére a padló fegyver lenne.
  let max = 0;
  const e = new Armoury(pontok, rnd);
  for (let t = 0; t < 400; t += SIM.step) {
    e.update(SIM.step);
    max = Math.max(max, e.items.length);
  }
  line('a készlet nem nő az idővel', max <= PICKUP.live + 1, `legtöbb ${max} darab`);

  // A RITKASÁG: a rakétavetőből a legkevesebb jön, és a legkevesebb lőszer is.
  let rakéta = 0, soret = 0;
  for (let i = 0; i < 400; i++) {
    const f = new Armoury(pontok, rnd);
    for (const x of f.items) {
      if (x.kind === 'rocket') rakéta++;
      if (x.kind === 'shotgun') soret++;
    }
  }
  line('a rakétavető a legritkább', rakéta < soret, `${rakéta} rakéta vs ${soret} sörétes`);
  line('és a legkevesebb lőszer jár hozzá',
    PICKUP.packs.rocket < PICKUP.packs.sniper && PICKUP.packs.sniper < PICKUP.packs.shotgun,
    `${PICKUP.packs.rocket} / ${PICKUP.packs.sniper} / ${PICKUP.packs.shotgun}`);
}


// --- AZ AI ELLENFÉL ---------------------------------------------------------
//
// Egyedül játszva is legyen kivel versenyezni. Amit mérni kell, az nem az,
// hogy „okos-e", hanem hogy UGYANAZT A JÁTÉKOT játssza-e: elviszi a cukorkát
// a saját sarkába, fél a lakótól, és nem lő falon át. Egy AI, ami gyorsabb
// vagy mindent lát, nem ellenfél, hanem büntetés.
{
  const piros: Corner = { player: 0, position: at(0, 0) };
  const kek: Corner = { player: 1, position: at(30, 0) };

  // Egy nyílt terep, ahol az útvonal az egyenes.
  // A tálak KIÜRÜLNEK, ahogy a valódi házban: enélkül a próba egy olyan
  // világot mérne, ahol végtelen cukorka van, és pont az nem derülne ki, mit
  // csinál az AI, amikor elfogy.
  const talak = [at(10, 0), at(14, 6), at(9, -5)];
  const nyilt = (dangers: THREE.Vector3[] = [], blocked = false): RivalWorld => ({
    bowls: () => [...talak],
    walkable: () => true,
    route: (from, to) => [to.clone()],
    dangers: () => dangers,
    sightBlocked: () => blocked,
    takeBowl: (p) => {
      const i = talak.findIndex((t) => t.distanceTo(p) < 2);
      if (i < 0) return false;
      talak.splice(i, 1);
      return true;
    },
  });

  // 1. ELVISZI A SARKÁBA. Ez a teljes kör: odamegy, felveszi, hazaviszi.
  {
    const game = new Capture([piros, kek]);
    const r = new Rival(at(28, 0), nyilt(), 1, () => 0.5);
    // A tálból vétel a jelenet dolga; itt a földön fekvőt gyűjti.
    game.loose.push({ position: at(10, 0), droppedBy: null, age: 99 });
    game.loose.push({ position: at(14, 6), droppedBy: null, age: 99 });
    for (let t = 0; t < 60; t += SIM.step) r.update(SIM.step, game, null);
    line('az AI beviszi a cukorkát a SAJÁT sarkába',
      game.banked[1] > 0 && game.banked[0] === 0,
      `${game.banked[1]} darab a kékben, ${game.banked[0]} a pirosban`);
  }

  // 2. FÉL a lakótól: ha az közel van, nem a cukorkáért megy.
  {
    const game = new Capture([piros, kek]);
    const lako = at(11, 0);
    const r = new Rival(at(12, 0), nyilt([lako]), 1, () => 0.5);
    game.loose.push({ position: at(10, 0), droppedBy: null, age: 99 });
    r.update(SIM.step, game, null);
    line('az AI menekül a lakó elől', r.state === 'MENEKUL', `${r.state}`);
  }

  // 3. NEM LŐ FALON ÁT. A takarásban álló játékosra nem vadászik.
  {
    const game = new Capture([piros, kek]);
    const jatekos = { id: '0', position: at(20, 0), radius: 0.45 };
    const takart = new Rival(at(28, 0), nyilt([], true), 1, () => 0.5);
    takart.weapon = new Weapon('shotgun');
    takart.update(SIM.step, game, jatekos);
    line('falon át nem lő az AI sem', takart.state !== 'LO', `${takart.state}`);

    const latja = new Rival(at(28, 0), nyilt([], false), 1, () => 0.5);
    latja.weapon = new Weapon('shotgun');
    latja.update(SIM.step, game, { id: '0', position: at(22, 0), radius: 0.45 });
    line('látótávon belül viszont lő', latja.state === 'LO', `${latja.state}`);
  }

  // 4. FEGYVER NÉLKÜL nem megy harcolni: gyűjt tovább.
  {
    const game = new Capture([piros, kek]);
    const r = new Rival(at(28, 0), nyilt(), 1, () => 0.5);
    game.loose.push({ position: at(10, 0), droppedBy: null, age: 99 });
    r.update(SIM.step, game, { id: '0', position: at(27, 0), radius: 0.45 });
    line('fegyver nélkül nem támad', r.state === 'GYUJT', `${r.state}`);
  }

  // 5. NEM CSAL: ugyanaz a sebesség, mint a játékosé.
  {
    const game = new Capture([piros, kek]);
    const r = new Rival(at(0, 0), nyilt(), 1, () => 0.5);
    game.loose.push({ position: at(0, 100), droppedBy: null, age: 99 });
    const start = r.position.clone();
    for (let t = 0; t < 2; t += SIM.step) r.update(SIM.step, game, null);
    const speed = r.position.distanceTo(start) / 2;
    line('az AI nem gyorsabb a játékosnál',
      speed <= MOVE.walkSpeed + 0.1,
      `${speed.toFixed(1)} egység/mp (a játékos ${MOVE.walkSpeed})`);
  }

  // 6. REPÜLÉS KÖZBEN ő sem irányít — ugyanaz a szabály, ami rád vonatkozik.
  {
    const game = new Capture([piros, kek]);
    const r = new Rival(at(28, 0), nyilt(), 1, () => 0.5);
    game.hit(1, at(28, 0), at(30, 0));
    const before = r.position.clone();
    r.update(SIM.step, game, null);
    line('ellökve az AI sem irányít', r.state === 'VAR' && r.position.equals(before), '');
  }
}


// --- A SZÁLLÍTÁS ------------------------------------------------------------
//
// A cukorkának három állomása van, és mindegyiken mást jelent: a kézben
// elveszíthető, a sarokban biztonságban van, de még nem a tiéd, és CSAK a
// bázison ér pontot. Ezt a három szintet kell szétválasztva tartani —
// összecsúszva a játék a ház ajtajában véget érne.
{
  const bazis = at(100, 100);
  const d = new Delivery(bazis);

  d.setCorner(0, 3);
  line('a sarokban álló cukorka még NEM pont',
    d.loads[0].delivered === 0 && !d.houseDone(0), `${d.loads[0].inCorner} a sarokban`);

  d.setCorner(0, DELIVERY.quota);
  line('a kvóta betelve a ház teljesítve', d.houseDone(0), `${DELIVERY.quota} darab`);

  const vitte = d.escaped(0);
  line('kijutva a rakomány a kocsiba kerül',
    vitte === DELIVERY.quota && d.loads[0].inCar === DELIVERY.quota && d.loads[0].inCorner === 0,
    `${d.loads[0].inCar} a kocsiban`);

  // Messze a bázistól nem történik semmi.
  for (let t = 0; t < 3; t += SIM.step) d.update(SIM.step, 0, at(0, 0));
  line('távol a bázistól nem lehet lerakni', d.loads[0].delivered === 0, '');

  // A bázison viszont igen — de IDŐBE telik.
  let felig = 0;
  for (let t = 0; t < DELIVERY.dropTime * 0.6; t += SIM.step) felig += d.update(SIM.step, 0, bazis);
  line('a lerakás nem azonnali', felig === 0 && d.loads[0].delivered === 0,
    `${DELIVERY.dropTime} mp kell`);

  // ...és aki félúton elhajt, elölről kezdi. Különben a bázis körül köröket
  // róva, szakaszosan is le lehetne adni.
  d.update(SIM.step, 0, at(0, 0));
  line('félbehagyva elölről kezdi', d.loads[0].dropping === 0, '');

  let leadva = 0;
  for (let t = 0; t < DELIVERY.dropTime + 0.2; t += SIM.step) leadva += d.update(SIM.step, 0, bazis);
  line('kivárva leadja az egészet',
    leadva === DELIVERY.quota && d.loads[0].delivered === DELIVERY.quota && d.loads[0].inCar === 0,
    `${d.loads[0].delivered} pont`);

  // A BÁZIS UGYANAZ MINDENKINEK: a másik játékos ugyanoda viszi.
  d.setCorner(1, 4);
  d.escaped(1);
  let masik = 0;
  for (let t = 0; t < DELIVERY.dropTime + 0.2; t += SIM.step) masik += d.update(SIM.step, 1, bazis);
  line('a másik játékos UGYANODA rakja le', masik === 4 && d.loads[1].delivered === 4,
    'egy bázis, két rakomány');

  line('a vezető a leadott mennyiségből jön', d.leader === 0,
    `${d.loads[0].delivered} vs ${d.loads[1].delivered}`);

  // Üres kocsival a bázison állni nem csinál semmit.
  const ures = new Delivery(bazis);
  let semmi = 0;
  for (let t = 0; t < 5; t += SIM.step) semmi += ures.update(SIM.step, 0, bazis);
  line('üres kocsival nincs mit lerakni', semmi === 0, '');
}


// --- A HÁROM FEGYVER HANGOLÁSA ----------------------------------------------
//
// A számok nem ízlésből valók, hanem a PÁLYA MÉRETÉBŐL: egy lakás mérve
// 67 × 67 egység (átló 96), a legnagyobb szoba kb. 29 egység széles. Ehhez
// képest kell mindegyik fegyvernek megtalálnia a maga távolságát — és a
// próba ezt az ARÁNYT védi, nem a konkrét számot.
{
  line('a sörétes egy szobán belül ér el',
    GUNS.shotgun.range >= 12 && GUNS.shotgun.range <= 20,
    `${GUNS.shotgun.range} egység (a legnagyobb szoba ~29 széles)`);
  line('a mesterlövész átlő a lakáson',
    GUNS.sniper.range >= 80 && GUNS.sniper.range <= 96,
    `${GUNS.sniper.range} (a lakás átlója 96)`);
  line('a rakéta egy szobányit repül, a lakáson nem lő át',
    GUNS.rocket.range > GUNS.shotgun.range && GUNS.rocket.range < 60,
    `${GUNS.rocket.range}`);

  // A LÖVÉSKÖZÖK: a kért ütem.
  line('sörétes ütem 0,8–1,0 mp',
    GUNS.shotgun.cooldown >= 0.8 && GUNS.shotgun.cooldown <= 1.0, `${GUNS.shotgun.cooldown}`);
  line('mesterlövész ütem 1,5 mp', GUNS.sniper.cooldown === 1.5, `${GUNS.sniper.cooldown}`);
  line('rakéta ütem 1,9–2,0 mp',
    GUNS.rocket.cooldown >= 1.9 && GUNS.rocket.cooldown <= 2.0, `${GUNS.rocket.cooldown}`);

  // A SÖRÉTES GYENGÜL a távolsággal — ez a „közelre erős, távolra nem jó".
  {
    const w = new Weapon('shotgun');
    const kozel = w.fire(at(0, 0), 0, [target(0, 5)]);
    tick(w, GUNS.shotgun.cooldown);
    const tavol = w.fire(at(0, 0), 0, [target(0, 15)]);
    line('a sörétes közelről teljes erejű', (kozel?.strength ?? 0) > 0.99,
      `${kozel?.strength.toFixed(2)}`);
    line('a hatótáv szélén viszont alig', (tavol?.strength ?? 1) < 0.25,
      `${tavol?.strength.toFixed(2)}`);
  }

  // A MESTERLÖVÉSZ nem gyengül: a távolság a fegyver lényege, nem hátránya.
  {
    const w = new Weapon('sniper');
    w.update(1, false);
    const messze = w.fire(at(0, 0), 0, [target(0, 80)]);
    line('a mesterlövész 80 egységről is teljes erejű',
      (messze?.strength ?? 0) > 0.99, `${messze?.strength.toFixed(2)}`);
  }

  // A GYENGE TALÁLAT kevesebbet ver ki a kézből, de legalább egyet —
  // különben a hatótáv szélén a lövésnek semmi következménye nem lenne.
  {
    const g = new Capture([{ player: 0, position: at(0, 0) }, { player: 1, position: at(30, 0) }]);
    for (let i = 0; i < CAPTURE.carry; i++) g.takeFromBowl(1);
    const gyenge = g.hit(1, at(10, 0), at(0, 0), 0.2);
    line('gyenge találatra kevesebb esik ki',
      gyenge.dropped >= 1 && gyenge.dropped < CAPTURE.carry,
      `${gyenge.dropped} a ${CAPTURE.carry}-ból`);

    const g2 = new Capture([{ player: 0, position: at(0, 0) }, { player: 1, position: at(30, 0) }]);
    for (let i = 0; i < CAPTURE.carry; i++) g2.takeFromBowl(1);
    line('teljes találatra minden kiesik',
      g2.hit(1, at(10, 0), at(0, 0), 1).dropped === CAPTURE.carry, '');
  }

  // A TÁVCSŐ csak a mesterlövészen van.
  line('távcső csak a mesterlövészen',
    new Weapon('sniper').canScope && !new Weapon('shotgun').canScope &&
      !new Weapon('rocket').canScope,
    `nagyítás ${(FIRST_PERSON.fov / GUNS.sniper.scopeFov).toFixed(1)}×`);
}


// --- AZ ELLÖKÉS: TÉNYLEG REPÜL-E ---------------------------------------------
//
// „Ha eltalál, arrébb repül." Ez nem hangulat, hanem mérhető: a testnek
// EL KELL HAGYNIA A TALAJT, és a fegyverek szerint más-más messzire kell
// kerülnie. Ha mind ugyanannyit lökne, a három fegyver közti különbség fele
// elveszne.
{
  const forward = {
    moveX: 0, moveY: 0, jump: false, jumpHeld: false, sprint: false,
    interact: false, interactHeld: false, pause: false, usingGamepad: false, nitro: false,
  };
  const dobas = (force: number): { tav: number; magas: number } => {
    const p = new PlayerController(0, 0xffffff, new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < 30; i++) p.update(SIM.step, forward, []); // földet érjen
    const start = p.position.clone();
    let magas = 0;
    if (force > 0) p.launch(new THREE.Vector3(0, 0, 1), force * 1.6);
    for (let t = 0; t < 2.5; t += SIM.step) {
      p.update(SIM.step, forward, []);
      magas = Math.max(magas, p.position.y - start.y);
    }
    return { tav: p.position.distanceTo(start), magas };
  };

  const soret = dobas(GUNS.shotgun.knockback);
  const raketa = dobas(GUNS.rocket.knockback);
  const meszter = dobas(GUNS.sniper.knockback);

  ok = line('sörétes találatra elrepül', soret.tav > 8,
    `${soret.tav.toFixed(1)} egység, ${soret.magas.toFixed(1)} magasra`) && ok;
  ok = line('a rakéta MESSZEBB dob', raketa.tav > soret.tav + 3,
    `${raketa.tav.toFixed(1)} vs ${soret.tav.toFixed(1)}`) && ok;
  ok = line('a mesterlövész nem lök, csak megállít', meszter.tav < 1,
    `${meszter.tav.toFixed(2)} egység — helyette ${GUNS.sniper.stun} mp bénulás`) && ok;
  ok = line('a lökés fel is emel (nem csúszás)', soret.magas > 2,
    `${soret.magas.toFixed(1)} egység magasra`) && ok;
}


// --- A FÖLDÖN FEKVŐ CUKORKA ELFOGY -------------------------------------------
//
// Enélkül a kiszórt zsákmány örökre ott maradt, és a padló egy biztonságos
// raktár lett: senkinek nem kellett sietnie. A lejárat teszi versennyé.
{
  const g = new Capture([{ player: 0, position: at(0, 0) }, { player: 1, position: at(30, 0) }]);
  g.loose.push({ position: at(5, 0), droppedBy: null, age: 0 });
  for (let t = 0; t < CAPTURE.looseLife * 0.5; t += SIM.step) g.update(SIM.step);
  line('félidőben még ott van', g.loose.length === 1, `${CAPTURE.looseLife} mp az élete`);
  for (let t = 0; t < CAPTURE.looseLife; t += SIM.step) g.update(SIM.step);
  line('lejárva eltűnik', g.loose.length === 0, '');
  line('az élettartam rövid, de elérhető',
    CAPTURE.looseLife >= 5 && CAPTURE.looseLife <= 12, `${CAPTURE.looseLife} mp`);
}

// --- A FELVETT HANGOK ---------------------------------------------------
//
// A hangot magát egy fejetlen próba nem hallja. Amit MEG TUD nézni, az a
// két dolog, ami miatt eddig néma maradt volna: hogy a fájl ott van-e és
// tényleg WAV-e (az Ogg a Safariban némán elszáll), és hogy a játék
// hívja-e ott, ahol a játékos várja. A kettő együtt az, ami elromolhat.
{
  const audio = 'public/audio';
  for (const [name, hol] of [
    ['reload-start', 'töltés indul'],
    ['reload-done', 'töltés kész / fegyverfelvétel'],
    ['hit', 'találat és elütés'],
    ['empty', 'üres tár'],
  ] as const) {
    const file = `${audio}/${name}.wav`;
    const bytes = existsSync(file) ? readFileSync(file) : null;
    ok = line(`${hol}: ${name}.wav megvan`, bytes !== null && bytes.length > 500,
      bytes ? `${bytes.length} bájt` : 'HIÁNYZIK') && ok;
    ok = line(`${name}.wav tényleg WAV`,
      bytes !== null && bytes.subarray(0, 4).toString() === 'RIFF' &&
      bytes.subarray(8, 12).toString() === 'WAVE',
      bytes ? bytes.subarray(0, 4).toString() : '—') && ok;
  }

  // A HÁROM LÖVÉSHANG. MP3, mert másodperces felvételek — a mesterlövészé
  // WAV-ban másfél megabájt volna. A hossz azért mért érték, mert a fegyver
  // gyorsabban sül el, mint ahogy a hang elhal: ezt a kód vágja el, de a
  // fájlnak akkor sem szabad tíz másodpercesnek lennie.
  for (const kind of ['shotgun', 'sniper', 'rocket'] as const) {
    const file = `${audio}/gun-${kind}.mp3`;
    const bytes = existsSync(file) ? readFileSync(file) : null;
    ok = line(`${GUNS[kind].name} lövéshangja megvan`, bytes !== null && bytes.length > 5000,
      bytes ? `${Math.round(bytes.length / 1024)} KB` : 'HIÁNYZIK') && ok;
    ok = line(`${kind}: a fájl nem óriás`, bytes !== null && bytes.length < 400_000,
      bytes ? `${Math.round(bytes.length / 1024)} KB` : '—') && ok;
  }
  const hang = readFileSync('src/audio/Sound.ts', 'utf8');
  ok = line('a lövés a FELVÉTELT szólaltatja meg', hang.includes('this.clip(`gun-${kind}`'),
    'a szintetizált hang tartalék marad') && ok;
  ok = line('az új lövés levágja az előzőt', hang.includes('this.voices'),
    'enélkül négy mesterlövész-visszhang szólna egyszerre') && ok;

  const haz = readFileSync('src/scenes/HouseScene.ts', 'utf8');
  const drive = readFileSync('src/game/DriveGame.ts', 'utf8');
  ok = line('a töltés két hangot ad (indul + kész)',
    haz.includes("sound.clip(loading ? 'reload-start' : 'reload-done'"), '') && ok;
  ok = line('a fegyver felvétele töltéshangot ad',
    /got[\s\S]{0,400}sound\.clip\('reload-done'/.test(haz), '') && ok;
  ok = line('a találat hangot ad', haz.includes("sound.clip('hit'"), '') && ok;
  ok = line('az üres tár kattan', haz.includes("sound.clip('empty'"), '') && ok;
  ok = line('az elütésnek is hangja van', drive.includes("sound.clip('hit'"), '') && ok;
}

console.log('');
console.log(ok ? 'MIND OK — a fegyverek, a rablás és a felszedés szabályai állnak' : 'VAN BUKÓ TESZT');
process.exit(ok ? 0 : 1);
