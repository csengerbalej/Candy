/** A kutya rigjének mérése: klipek, méret, és merre van az ELŐRE. */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
// A GLTFLoader böngészőt vár; a textúrák betöltéséhez elég egy üres URL.
(globalThis as any).self = globalThis;
(globalThis as any).URL.createObjectURL = () => 'blob:stub';
(globalThis as any).URL.revokeObjectURL = () => {};
(globalThis as any).createImageBitmap = undefined;

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const glb = Buffer.from(JSON.parse(readFileSync('public/models/dog.json', 'utf8')).glb, 'base64');
const loader = new GLTFLoader();
const gltf: any = await new Promise((res, rej) =>
  loader.parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', res, rej)
);

const box = new THREE.Box3().setFromObject(gltf.scene);
const size = box.getSize(new THREE.Vector3());
console.log('méret x/y/z:', size.x.toFixed(3), size.y.toFixed(3), size.z.toFixed(3));
console.log('doboz min/max y:', box.min.y.toFixed(3), box.max.y.toFixed(3));

// A csontok neve elárulja a fejet; a fej vízszintes helye az ELŐRE.
const bones: THREE.Bone[] = [];
gltf.scene.traverse((o: any) => { if (o.isBone) bones.push(o); });
console.log('csontok:', bones.length);
console.log('nevek:', bones.map((b) => b.name).slice(0, 40).join(' '));

const head = bones.find((b) => /head|skull|neck/i.test(b.name));
const tail = bones.find((b) => /tail/i.test(b.name));
const root = bones.find((b) => /hips|pelvis|root|spine/i.test(b.name));
for (const [label, b] of [['fej', head], ['farok', tail], ['tő', root]] as const) {
  if (!b) { console.log(label, '— nincs ilyen csont'); continue; }
  const p = b.getWorldPosition(new THREE.Vector3());
  console.log(label, b.name, p.x.toFixed(3), p.y.toFixed(3), p.z.toFixed(3));
}

for (const c of gltf.animations as THREE.AnimationClip[]) {
  console.log(`klip "${c.name}" ${c.duration.toFixed(2)}s, ${c.tracks.length} sáv`);
}

// --- A kutya viselkedése ----------------------------------------------------
import { Dog } from '../src/ai/Dog';
import { NoiseSystem } from '../src/systems/NoiseSystem';
import { DOG, HOMEOWNER, MOVE, NOISE } from '../src/core/config';

let ok = true;
const line = (name: string, pass: boolean, detail: string) => {
  console.log(`${pass ? 'OK  ' : 'HIBA'}  ${name.padEnd(46)} ${detail}`);
  return pass;
};
console.log('');

// 1. A füle jobb, mint a lakó szeme messze ér — különben minek a második fogó.
{
  const dogHears = NOISE.sprintRadius * DOG.hearing;
  ok = line(
    'a kutya messzebbről hall, mint a lakó lát',
    dogHears > HOMEOWNER.viewRange,
    `futászaj a kutyának ${dogHears.toFixed(0)}, a lakó kúpja ${HOMEOWNER.viewRange}`
  ) && ok;
}

// 2. A séta NÉMA. Ez az egyetlen ellenjáték a kutya ellen; ha a séta is zajt
//    adna, a kutya elől nem lehetne mit csinálni.
{
  ok = line(
    'a sétának nincs zajsugara',
    !('walkRadius' in NOISE),
    `a NOISE csak futásra (${NOISE.sprintRadius}) és érkezésre (${NOISE.landRadius}) ad zajt`
  ) && ok;
}

// 3. Futva NEM lehet lerázni — ezért kell megállni, nem menekülni.
{
  ok = line(
    'futva nem lehet lehagyni a kutyát',
    DOG.chaseSpeed > MOVE.sprintSpeed,
    `kutya ${DOG.chaseSpeed}, sprint ${MOVE.sprintSpeed}`
  ) && ok;
}

// 4. Az ugatás ELÉR a lakóig: nagyobb sugarú, mint a csíny, ami a ház másik
//    végébe szánt zaj. Enélkül a kutya csak egy lassabb második lakó lenne.
{
  ok = line(
    'az ugatás messzebb szól, mint egy csíny',
    DOG.barkRadius > NOISE.prankRadius,
    `ugatás ${DOG.barkRadius}, csíny ${NOISE.prankRadius}`
  ) && ok;
}

// 5. Csend esetén HAZAMEGY. Egy kutya, ami egyszer felriad és onnantól a
//    szobában marad, elveszi a ház többi részét.
{
  const noise = new NoiseSystem();
  const dog = new Dog(new THREE.Vector3(0, 0, 0));
  noise.emit(new THREE.Vector3(0, 0, 40), 20, 'teszt');
  let t = 0;
  const dt = 1 / 60;
  let slept = -1;
  while (t < 40) {
    noise.update(dt);
    dog.update(dt, noise);
    t += dt;
    if (dog.state === 'SLEEP' && t > 1) { slept = t; break; }
  }
  ok = line(
    'csendben visszamegy a kennelbe',
    slept > 0,
    slept > 0 ? `${slept.toFixed(1)} mp alatt ért haza és lefeküdt` : `40 mp után is ${dog.state}`
  ) && ok;
}

// 6. Az ugatás tényleg bekerül a zajlistába — a lakó ezen keresztül hallja meg.
{
  const noise = new NoiseSystem();
  const dog = new Dog(new THREE.Vector3(0, 0, 0));
  noise.emit(new THREE.Vector3(0, 0, 30), 20, 'teszt');
  let barked = false;
  for (let t = 0; t < 30; t += 1 / 60) {
    noise.update(1 / 60);
    dog.update(1 / 60, noise);
    if (noise.events.some((e) => e.source === 'kutya')) { barked = true; break; }
  }
  ok = line('a zaj helyén ugat, és az maga is zaj', barked, barked ? 'a lakó meghallja' : 'soha nem ugatott');
}

// 7. A FEJE ELŐRE néz. A pók kétszer ment háttal; ugyanez a hiba egy
//    négylábúnál még jobban látszik.
{
  const nose = head ? head.getWorldPosition(new THREE.Vector3()).z : 0;
  const rump = tail ? tail.getWorldPosition(new THREE.Vector3()).z : 0;
  ok = line(
    'a kutya orra +Z felé néz (a motor előre-iránya)',
    nose > rump,
    `fej z=${nose.toFixed(4)}, farok z=${rump.toFixed(4)}`
  ) && ok;
}

// 8. CSENDBEN IS MOZOG. Ez volt a panasz: a kutya nem mozdult. Nem is
//    mozdulhatott — csak zajra reagált, a séta pedig néma, tehát egy óvatos
//    játékos mellett egész este ült.
{
  const noise = new NoiseSystem();
  const dog = new Dog(new THREE.Vector3(0, 0, 0));
  dog.roam.push(new THREE.Vector3(60, 0, 0), new THREE.Vector3(0, 0, 60));
  let far = 0;
  for (let t = 0; t < 40; t += 1 / 60) {
    noise.update(1 / 60);
    dog.update(1 / 60, noise);
    far = Math.max(far, dog.position.length());
  }
  ok = line('teljes csendben is körbejár', far > 20, `40 mp csendben ${far.toFixed(0)} egységre is eljutott`) && ok;
}

// 9. SAROKBÓL KIJÖN. A fal menti csúszás egy sarokban nem működik: ott
//    mindhárom irány zárva, és az üldöző örökre ott marad.
{
  const noise = new NoiseSystem();
  const dog = new Dog(new THREE.Vector3(0, 0, 0));
  dog.roam.push(new THREE.Vector3(60, 0, 60));
  // Egy sarok: csak a negatív negyedben lehet járni, a cél viszont a
  // pozitívban van — a kutya nekifeszül, és magától nem jön ki.
  dog.walkable = (x, z) => x <= 0.01 && z <= 0.01;
  let rescued = false;
  dog.rescue = () => { rescued = true; return new THREE.Vector3(-10, 0, -10); };
  for (let t = 0; t < 8; t += 1 / 60) { noise.update(1 / 60); dog.update(1 / 60, noise); }
  ok = line('sarokban nem ragad be', rescued, rescued ? 'a beszorulás után kiszabadul' : '8 mp-ig nekifeszült a falnak') && ok;
}

// 10. A MÉRETE a lakóhoz van kötve, nem külön beírva.
//
// Ez a kettő áll egymás mellett ugyanabban a szobában. Ha külön számokból
// jönne a méretük, előbb-utóbb szétcsúsznának — az utcai cukorkánál pontosan
// ez történt, és hordó méretű lett a szörnyecskéhez képest.
{
  const ratio = DOG.height / HOMEOWNER.height;
  ok = line(
    'a kutya pont feleakkora, mint a lakó',
    Math.abs(ratio - 0.5) < 0.001,
    `${DOG.height.toFixed(2)} a lakó ${HOMEOWNER.height}-éhez: ${(ratio * 100).toFixed(0)}%`
  ) && ok;

  // ...és ZÖMÖKEBB, mint egy ember: egy négylábú a saját marmagasságához
  // képest szélesebb.
  const dogStance = DOG.width / DOG.height;
  const manStance = HOMEOWNER.width / HOMEOWNER.height;
  ok = line(
    'a kutya zömökebb, mint a lakó',
    dogStance > manStance * 1.4,
    `kutya ${dogStance.toFixed(2)}, lakó ${manStance.toFixed(2)} (szélesség a magassághoz)`
  ) && ok;
}

// 11. NÉMA JÁTÉKOST IS MEGKERES — szaglással.
//
// Ez tervezési hiány volt, nem hiba: a kutya kizárólag HALLOTT, a séta
// viszont néma, tehát egy óvatos játékos mellett soha nem indult el keresni.
// Kívülről ez úgy néz ki, hogy a kutya nem csinál semmit.
//
// A szaglás azt adja meg, amit a hallás nem: hol VOLTÁL, nem hol vagy. A nyom
// néhány másodperces késéssel jár utánad, tehát a mozgás így is véd — csak a
// mozdulatlanság nem.
{
  const noise = new NoiseSystem();
  const dog = new Dog(new THREE.Vector3(0, 0, 0));
  dog.roam.push(new THREE.Vector3(30, 0, 0), new THREE.Vector3(0, 0, 30));
  // A játékos messze áll és NEM ad ki hangot.
  const quietPlayer = new THREE.Vector3(70, 0, 70);
  let closest = Infinity;
  for (let t = 0; t < 45; t += 1 / 60) {
    noise.update(1 / 60);
    dog.update(1 / 60, noise, [quietPlayer]);
    closest = Math.min(closest, dog.position.distanceTo(quietPlayer));
  }
  ok = line(
    'a néma játékost is megkeresi (szaglás)',
    closest < 12,
    `45 mp teljes csendben ${closest.toFixed(0)} egységre közelítette meg`
  ) && ok;
}

// 12. ...de a SZAG KÉSIK. A kutya oda megy, ahol voltál — ha mozogsz, nem
//     talál ott. Enélkül a szaglás mindentudás lenne, nem nyomkövetés.
{
  const noise = new NoiseSystem();
  const dog = new Dog(new THREE.Vector3(0, 0, 0));
  dog.roam.push(new THREE.Vector3(20, 0, 0));
  const walker = new THREE.Vector3(60, 0, 0);
  let closest = Infinity;
  for (let t = 0; t < 45; t += 1 / 60) {
    // Folyamatosan sétál tovább, séta-tempóban.
    walker.z += 6 / 60;
    noise.update(1 / 60);
    dog.update(1 / 60, noise, [walker]);
    closest = Math.min(closest, dog.position.distanceTo(walker));
  }
  ok = line(
    'a mozgó játékost a szag nem éri utol azonnal',
    closest > DOG.biteRadius,
    `a folyamatosan sétáló játékost ${closest.toFixed(0)} egységre közelítette meg (a harapás ${DOG.biteRadius})`
  ) && ok;
}

// 13. A KUTYA NEM HARAP: BEÁRUL.
//
// Egy második üldöző, ami maga is elkap, csak egy gyorsabb lakó lenne. Amit
// a kutya ad hozzá, az az, hogy a büntetés nem azonnal jön, hanem KÖZELEDIK.
{
  const noise = new NoiseSystem();
  const dog = new Dog(new THREE.Vector3(0, 0, 0));
  dog.found(noise);
  const barked = noise.events.filter((e) => e.source === 'kutya');
  ok = line(
    'a kutya megtaláláskor a gazdit hívja',
    barked.length === 1 && barked[0].radius >= DOG.barkRadius,
    barked.length ? `ugatás ${barked[0].radius} sugárral` : 'nem szólt semmit'
  ) && ok;

  // ...és a hívás ELÉR a lakóig: nagyobb sugarú, mint a legnagyobb zaj, amit
  // egyébként kelteni lehet.
  ok = line(
    'a hívás hangosabb minden másnál a házban',
    DOG.barkRadius > NOISE.prankRadius && DOG.barkRadius > NOISE.landRadius,
    `ugatás ${DOG.barkRadius}, csíny ${NOISE.prankRadius}, érkezés ${NOISE.landRadius}`
  ) && ok;
}

console.log('');
if (!ok) process.exitCode = 1;
