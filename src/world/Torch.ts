import * as THREE from 'three';
import { HAUNT } from '../core/config';

/**
 * A ZSEBLÁMPA.
 *
 * Egy kúp, ami arra néz, amerre te. Nem díszítés: a kísértetházban a FÉNY
 * az erőforrás, és ez a tárgy, ami adja.
 *
 * Miért reflektor (SpotLight) és nem pontfény: a pontfény mindenhova
 * egyszerre világít, tehát nem kell IRÁNYÍTANI — és ha nem kell irányítani,
 * akkor a sötét nem korlát, csak egy szűrő a képen. A kúp viszont azt
 * jelenti, hogy amit nézel, azt látod, a hátad mögött pedig nem tudod, mi
 * van. Ez a különbség az egész mód.
 *
 * A fénye MELEG és enyhén imbolyog. Egy tökéletesen egyenletes fénykör
 * lámpának látszik; egy remegő kézben tartott lámpa attól ijesztő, hogy
 * emlékeztet rá: valaki fogja.
 */
export class Torch {
  readonly group = new THREE.Group();
  private readonly light: THREE.SpotLight;
  private readonly target = new THREE.Object3D();
  private clock = 0;

  constructor() {
    // A KÚP SZÖGE ugyanaz, mint amit a szabály használ (HAUNT.beam): a
    // fénykör, amit LÁTSZ, és a kúp, ami ÉGET, nem lehet két különböző
    // dolog — abból az lenne, hogy ráfogod a fényt, és nem történik semmi.
    // A FÉNYERŐ ÉS A LECSENGÉS EGYÜTT dönti el, mit látsz.
    //
    // Először 240 volt 1,5-ös lecsengéssel, és közelről KIÉGETT: egy méterre
    // álló szörny fehér foltként töltötte be a képet, és pont az veszett el,
    // ami ijesztő benne — a forma. A fényerő harmadára, a lecsengés
    // laposabbra: közel nem világít agyon, messze viszont még elér.
    // ERŐSEBB LÁMPA — de nem a fényerő emelésével.
    //
    // A fényerő magában rossz kapcsoló: ha feltekerem, a KÖZELI felület ég
    // ki tőle (ez volt a 240-es változat: egy méterre álló szörny fehér
    // folt), a folyosó vége meg attól még sötét marad. Ami messzire visz, az
    // a LECSENGÉS: 1,15-ről 0,8-ra véve a fény lassabban fogy a távolsággal.
    //
    // A kettő együtt (120-as fényerő, 0,8-as lecsengés, 32 méteres hatótáv):
    //   egy méterre    120 helyett 95 volt   — alig világosabb
    //   tíz méterre     19 helyett 6,7       — háromszor annyi
    //   húsz méterre    11 helyett 3,0       — közel négyszer annyi
    //
    // Vagyis pont ott lett erősebb, ahol hiányzott: a folyosó túlsó végén.
    // A PEREM LÁGYABB ÉS A LECSENGÉS ERŐSEBB.
    //
    // A régi, kemény peremű kúp (0,4) egy vakító korongot rajzolt a falra,
    // a 0,8-as lecsengés pedig közelről kiégette: mérve 206/255 a közepén,
    // és a szörny is fehér szilánkokká égett, ha melléd ért. A 0,7-es perem
    // elmossa a korong szélét, az 1,35-ös lecsengés pedig a közeli
    // túlvilágítást veszi vissza — a távoli fényt nem, mert azt a tágabb
    // kúp bőven pótolja (mérve: a kép átlaga 13-ról 24-re nőtt).
    this.light = new THREE.SpotLight(0xffd9a8, 0, 32, HAUNT.beamLight, 0.7, 0.4);
    // A LÁMPA ÁRNYÉKOT VET — és ez a mód legnagyobb látványbeli nyeresége.
    //
    // Enélkül a szörny egy világos folt a sötétben; árnyékkal viszont
    // ELŐBB LÁTOD AZ ÁRNYÉKÁT, mint őt magát. Egy folyosón végigvetülő,
    // hosszú alak több, mint amit bármilyen textúra adhat.
    //
    // Egyetlen árnyékvető fény van a házban, és 1024-es térképpel dolgozik:
    // ez egy mélységi rajzolás képkockánként, nem tizenkettő. A vágósíkok
    // szűkek (fél métertől a lámpa hatótávjáig), mert egy tág tartományon
    // a mélységi pontosság szétesik, és az árnyék „csíkozni" kezd.
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.camera.near = 0.5;
    this.light.shadow.camera.far = 32;
    // A ferdén érő fény ÖNÁRNYÉKA a legcsúnyább hiba, amit egy reflektor
    // tud: a fal saját magára vet csíkokat. A torzítás ezt tolja el.
    this.light.shadow.bias = -0.0015;
    this.light.shadow.normalBias = 0.04;
    this.group.add(this.light, this.target);
    this.light.target = this.target;
  }

  /**
   * @param at Ahonnan világít (a szem magasságából, nem a lábtól).
   * @param yaw Amerre nézel.
   * @param on Ég-e.
   * @param fade 0…1 — mennyi van a telepben. A lámpa nem hirtelen alszik ki,
   * hanem elhalványul: a fogyó fény maga a figyelmeztetés.
   */
  update(
    dt: number,
    at: THREE.Vector3,
    yaw: number,
    on: boolean,
    fade: number,
    /**
     * A NÉZÉS DŐLÉSE. Belső nézetben fel-le is nézel, és a lámpa a fejet
     * követi — egy vízszintesen ragadt fénykúp azt jelentené, hogy a
     * padlóra és a plafonra nem tudsz világítani, pedig pont ott van a
     * legtöbb keresnivaló.
     */
    pitch = 0
  ): void {
    this.clock += dt;
    this.light.position.copy(at);
    this.light.position.y += 1.6;
    // A cél EGY EGYSÉGGEL a szem alatt van: a lámpát nem a plafonnak
    // tartod, hanem előre-lefelé, ahogy járás közben bárki.
    const tav = 10;
    this.target.position.set(
      at.x + Math.sin(yaw) * Math.cos(pitch) * tav,
      at.y + 1.6 + Math.sin(pitch) * tav,
      at.z + Math.cos(yaw) * Math.cos(pitch) * tav
    );
    // Imbolygás: két különböző ütemű szinusz, hogy ne legyen felismerhető
    // ritmusa. Egy szabályos pulzálás gépnek látszik.
    const flicker = 1 + Math.sin(this.clock * 11) * 0.04 + Math.sin(this.clock * 3.3) * 0.05;
    const low = fade < 0.2 ? 0.45 + Math.sin(this.clock * 24) * 0.35 : 1;
    // A LECSENGÉS LAPOS, AZ ERŐSSÉG KICSI — és ez a kettő együtt jár.
    //
    // Mérve: a régi görbével (120 erősség, 1,35 lecsengés) a lámpa 3,5
    // méteren 22 egységnyi fényt adott, 15 méteren 3,1-et. A közeli érték
    // annyira sok, hogy a képfeldolgozás TELÍTŐDIK: onnantól sem a festés,
    // sem a tükröződés nem számít, minden egyforma fehér lesz. Pontosan
    // ezért látszott a szörny fehér szobornak (mérve 123/255, miközben a
    // fal mellette 16) és ezért égett ki a fal, ha nekimentél.
    //
    // A 0,4-es lecsengés LAPOS: 3,5 méteren 5,0, 15 méteren 2,8 — a közeli
    // negyedére esik, a távoli szinte változatlan. Egy zseblámpa amúgy is
    // így viselkedik: nem a közeli fal ragyog tőle, hanem a folyosó vége
    // sötétedik el.
    this.light.intensity = on ? 8.2 * flicker * Math.min(1, fade * 4) * low : 0;
  }

  dispose(): void {
    this.light.dispose();
  }
}
