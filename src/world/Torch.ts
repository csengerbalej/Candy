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
    this.light = new THREE.SpotLight(0xffd9a8, 0, 24, HAUNT.beam, 0.4, 1.15);
    this.light.castShadow = false;
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
    this.light.intensity = on ? 95 * flicker * Math.min(1, fade * 4) * low : 0;
  }

  dispose(): void {
    this.light.dispose();
  }
}
