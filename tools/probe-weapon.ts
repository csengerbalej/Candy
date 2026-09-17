import * as THREE from 'three';
import { Weapon, type Target } from '../src/game/Weapon';
import { WEAPON, SIM, CAPTURE } from '../src/core/config';
import { Capture, type Corner } from '../src/game/Capture';

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
function line(name: string, pass: boolean, detail = ''): void {
  console.log(`${pass ? 'OK  ' : 'HIBA'}  ${name.padEnd(42)} ${detail}`);
  if (!pass) ok = false;
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

// --- TALÁLAT ÉS IRÁNY -------------------------------------------------------
{
  const w = new Weapon();
  // Előre néz (heading 0 = +Z), a célpont előtte.
  const elott = w.fire(at(0, 0), 0, [target(0, 8)]);
  line('szemben álló célpontot eltalál', elott?.hit?.id === 'tars', `${elott?.hit ? 'talált' : 'nem talált'}`);

  tick(w, WEAPON.cooldown);
  // A HÁTA MÖGÖTT állót nem: a fegyver nem lő visszafelé.
  const mogott = w.fire(at(0, 0), 0, [target(0, -8)]);
  line('a háta mögé nem lő', mogott?.hit === null, `${mogott?.hit ? 'eltalálta' : 'elment'}`);

  tick(w, WEAPON.cooldown);
  // OLDALRA kitérve elkerülhető — enélkül a lövés kikerülhetetlen lenne.
  const mellette = w.fire(at(0, 0), 0, [target(3, 8)]);
  line('oldalra kitérve elkerülhető', mellette?.hit === null, '3 egységgel oldalra');

  tick(w, WEAPON.cooldown);
  const kozel = w.fire(at(0, 0), 0, [target(1.2, 8)]);
  line('szűken mellette még talál', kozel?.hit?.id === 'tars', `1,2 egység (sugár ${WEAPON.radius})`);
}

// --- HATÓTÁV ----------------------------------------------------------------
{
  const w = new Weapon();
  const messze = w.fire(at(0, 0), 0, [target(0, WEAPON.range + 4)]);
  line('a hatótávon túl nem talál', messze?.hit === null, `${WEAPON.range + 4} > ${WEAPON.range} egység`);

  tick(w, WEAPON.cooldown);
  const hatar = w.fire(at(0, 0), 0, [target(0, WEAPON.range - 1)]);
  line('a hatótávon belül talál', hatar?.hit?.id === 'tars', `${WEAPON.range - 1} egység`);
}

// --- FAL --------------------------------------------------------------------
{
  const w = new Weapon();
  const fal = w.fire(at(0, 0), 0, [target(0, 8)], () => true);
  line('falon át nem lő', fal?.hit === null, 'a takarás számít');
}

// --- A LEGKÖZELEBBI NYER ----------------------------------------------------
{
  const w = new Weapon();
  const ketto = w.fire(at(0, 0), 0, [target(0, 16, 'hatso'), target(0, 6, 'elso')]);
  line('a közelebbit találja el', ketto?.hit?.id === 'elso', `${ketto?.hit?.id}`);
}

// --- AZ ÁRA: LŐSZER, ÚJRATÖLTÉS, ÜTEM ---------------------------------------
{
  const w = new Weapon();
  line('tele tárral indul', w.ammo === WEAPON.magazine, `${w.ammo} lövés`);

  // Ütem: két lövés között várni kell. Enélkül egy képkockán kiürülne a tár.
  w.fire(at(0, 0), 0, []);
  const azonnal = w.fire(at(0, 0), 0, []);
  line('nem lehet képkockánként lőni', azonnal === null, `a szünet ${WEAPON.cooldown} mp`);

  tick(w, WEAPON.cooldown);
  line('a szünet után újra lőhet', w.ready, `${w.ammo} lövés maradt`);

  // A tár kiürítése, és hogy MAGÁTÓL töltsön: az üres fegyver a legrosszabb
  // pillanatban ne néma gomb legyen.
  const u = new Weapon();
  for (let i = 0; i < WEAPON.magazine; i++) {
    u.fire(at(0, 0), 0, []);
    tick(u, WEAPON.cooldown);
  }
  line('a tár elfogy', u.ammo === 0, `${u.ammo} lövés`);
  line('üres tár magától tölt', u.reloading > 0, `${u.reloading.toFixed(1)} mp van hátra`);

  const kozben = u.fire(at(0, 0), 0, [target(0, 6)]);
  line('töltés közben nem lő', kozben === null, '');

  tick(u, WEAPON.reload + 0.1);
  line('töltés után van lőszer', u.ammo > 0, `${u.ammo} lövés, tartalék ${u.reserve}`);

  // ...de csak annyi, amennyi tartalék van. Végtelen lőszer esetén a fegyver
  // ára nulla, és a mód gombnyomkodás.
  const ures = new Weapon();
  ures.reserve = 0;
  for (let i = 0; i < WEAPON.magazine + 2; i++) {
    ures.fire(at(0, 0), 0, []);
    tick(ures, WEAPON.cooldown + 0.05);
  }
  tick(ures, WEAPON.reload + 0.5);
  line('tartalék nélkül nem tölt újra', ures.ammo === 0, `${ures.ammo} lövés, tartalék ${ures.reserve}`);

  ures.pickUp();
  ures.reload();
  tick(ures, WEAPON.reload + 0.1);
  line('felszedett lőszerrel megint lő', ures.ammo === WEAPON.pack, `${ures.ammo} lövés`);
}

// --- A ZAJ ------------------------------------------------------------------
{
  const w = new Weapon();
  const s = w.fire(at(4, 9), 0, []);
  line('a lövés zajt hagy a csővégnél', !!s && s.noiseAt.distanceTo(at(4, 9)) < 0.001,
    `${WEAPON.noiseRadius} egység sugárral`);
  line('a lövés zaja a futásnál nagyobb, a csínynél kisebb',
    WEAPON.noiseRadius > 13 && WEAPON.noiseRadius < 70,
    `${WEAPON.noiseRadius} (futás 13, csíny 70)`);
}

// --- NEM ÖL -----------------------------------------------------------------
{
  // Ez nem kód-kérdés, hanem a mód szabálya: a hatás idő és zsákmány, nem
  // kiesés. Egy kiütött játékos ül és vár — kétfős estén ez a legrosszabb.
  line('a hatás bénítás, nem kiesés', WEAPON.stun > 0 && WEAPON.stun < 3,
    `${WEAPON.stun} mp bénítás, ${WEAPON.drop} cukorka esik`);
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

console.log('');
console.log(ok ? 'MIND OK — a puska és a rablás szabályai állnak' : 'VAN BUKÓ TESZT');
process.exit(ok ? 0 : 1);
