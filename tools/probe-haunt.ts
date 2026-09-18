import * as THREE from 'three';
import { Haunt } from '../src/game/Haunt';
import { HAUNT } from '../src/core/config';

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

console.log('');
console.log(ok ? 'MIND OK — a kísértetház szabályai állnak' : 'VAN BUKÓ TESZT');
process.exit(ok ? 0 : 1);
