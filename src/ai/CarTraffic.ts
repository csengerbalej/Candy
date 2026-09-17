import * as THREE from 'three';
import { VILLAGE_SCALE } from '../world/VillageWorld';
import type { TrafficLights } from '../world/TrafficLights';

export interface StreetGrid {
  pitchX: number;
  pitchZ: number;
  count: number;
  street: number;
  builtX: number;
  builtZ: number;
}

/**
 * NPC AUTÓK a város utcáin.
 *
 * A város eddig üres volt: lámpák váltottak, de nem állt meg előttük senki,
 * és a zebrán soha nem ment át semmi. Egy utca, amin csak te jársz, nem
 * utca — pálya.
 *
 * Amitől ez működik, és amiért nem kellett hozzá útkereső intelligencia: a
 * város SZABÁLYOS RÁCS, és a rácsot a térképgenerátor kiadja. Egy autó tehát
 * mindig egy SÁVBAN van (egy utcavonaltól jobbra, a haladási iránya
 * szerint), és a döntése egyetlen helyen születik: a kereszteződésben, ahol
 * vagy egyenesen megy, vagy kanyarodik.
 *
 * Három szabályt tart be, és mind a három LÁTHATÓ kívülről:
 *
 *   · a jobb oldali sávban megy,
 *   · a pirosnál megáll a vonal előtt,
 *   · nem megy neki az előtte állónak.
 *
 * Előzés nincs, és ez szándékos: egy sort álló autó a piros lámpánál a
 * városnak azt a jelentést adja, hogy ITT SZABÁLYOK VANNAK — amit aztán te
 * megszeghetsz.
 */
interface Npc {
  mesh: THREE.Object3D;
  /** Melyik utcavonalon megy (világkoordináta). */
  lane: number;
  /** Merre: +1 vagy −1, a saját tengelye mentén. */
  dir: number;
  /** Z tengely mentén halad-e. */
  alongZ: boolean;
  /** Hol tart a saját tengelye mentén. */
  at: number;
  speed: number;
  /** Amíg fut, áll — piros lámpa vagy az előtte lévő autó miatt. */
  waiting: number;
}

export class CarTraffic {
  readonly group = new THREE.Group();

  /** Ennyivel megy a sáv közepén, jobbra az utcavonaltól. */
  private readonly laneOffset: number;
  private readonly npcs: Npc[] = [];
  private readonly lines: { x: number[]; z: number[] };
  private readonly halfX: number;
  private readonly halfZ: number;

  /** Mennyivel lassabbak nálad. A város nem verseny. */
  private static readonly SPEED = 11;

  /** Azok a kereszteződés-vonalak, ahol TÉNYLEG van lámpa. */
  private readonly lit: { x: number[]; z: number[] };

  constructor(
    grid: StreetGrid,
    count: number,
    /**
     * A lámpás kereszteződések helye.
     *
     * Enélkül az autók MINDEN kereszteződésnél megálltak, pedig a
     * nyolcvanegyből csak tizenhatban van lámpa — mérve mind a tizenkettő
     * egyszerre állt, és öt másodperc alatt ötnél több nem indult el. Egy
     * város, ahol semmi nem mozog, ugyanolyan üres, mint ahol semmi nincs.
     */
    lights: Array<{ centre: [number, number] }> = [],
    private readonly random: () => number = Math.random
  ) {
    const street = grid.street * VILLAGE_SCALE;
    this.laneOffset = street * 0.25;
    this.halfX = grid.builtX * VILLAGE_SCALE;
    this.halfZ = grid.builtZ * VILLAGE_SCALE;

    // Az utcavonalak: ugyanaz a képlet, amiből a térkép is rajzolta őket.
    const lines = (pitch: number): number[] =>
      Array.from({ length: grid.count + 1 }, (_, k) => (k - grid.count / 2) * pitch * VILLAGE_SCALE);
    this.lines = { x: lines(grid.pitchX), z: lines(grid.pitchZ) };

    // A lámpás vonalak halmaza: a lámpák középpontjainak koordinátái.
    const uniq = (v: number[]): number[] => [...new Set(v.map((n) => Math.round(n)))];
    this.lit = {
      x: uniq(lights.map((l) => l.centre[0] * VILLAGE_SCALE)),
      z: uniq(lights.map((l) => -l.centre[1] * VILLAGE_SCALE)),
    };

    for (let i = 0; i < count; i++) this.spawn();
  }

  /** A modell megérkezett: minden autó kap egy példányt. */
  setArt(make: () => THREE.Object3D): void {
    for (const npc of this.npcs) {
      const art = make();
      npc.mesh.add(art);
    }
  }

  private spawn(): void {
    const alongZ = this.random() < 0.5;
    const lines = alongZ ? this.lines.x : this.lines.z;
    const lane = lines[Math.floor(this.random() * lines.length)];
    const dir = this.random() < 0.5 ? 1 : -1;
    const span = alongZ ? this.halfZ : this.halfX;

    const mesh = new THREE.Group();
    this.group.add(mesh);
    this.npcs.push({
      mesh,
      lane,
      dir,
      alongZ,
      at: (this.random() * 2 - 1) * span,
      speed: CarTraffic.SPEED * (0.85 + this.random() * 0.3),
      waiting: 0,
    });
    this.place(this.npcs[this.npcs.length - 1]);
  }

  /** A JOBB OLDALI sáv: a haladási iránytól jobbra tolva az utcavonaltól. */
  private place(npc: Npc): void {
    const side = npc.alongZ ? npc.dir : -npc.dir;
    if (npc.alongZ) {
      npc.mesh.position.set(npc.lane + this.laneOffset * side, 0, npc.at);
      npc.mesh.rotation.y = npc.dir > 0 ? 0 : Math.PI;
    } else {
      npc.mesh.position.set(npc.at, 0, npc.lane + this.laneOffset * side);
      npc.mesh.rotation.y = npc.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  /**
   * @param players A JÁTÉKOSOK kocsijainak helye. Enélkül az NPC egyszerűen
   * áthajtott rajtad: te ütköztél vele, ő nem vett rólad tudomást, és a
   * koccanás után a hátad mögül tolt tovább. Most ugyanúgy megáll előtted,
   * ahogy az előtte álló NPC mögött — a szabály nem az autó fajtájáról szól,
   * hanem arról, hogy valami van az úton.
   */
  update(dt: number, lights: TrafficLights | null, players: readonly THREE.Vector3[] = []): void {
    for (const npc of this.npcs) {
      npc.waiting = Math.max(0, npc.waiting - dt);

      // PIROS LÁMPA. Ugyanazt a fázist kérdezzük, amit te látsz — nem külön
      // szabály az autóknak: ha megállnak, akkor azért, amiért neked is kéne.
      const blocked = lights ? !lights.green(npc.alongZ) : false;
      const approach = this.distanceToStopLine(npc);
      // A megállási sáv SZŰKEBB, mint volt: kilenc egységről hatra. Egy
      // autó, ami tizenegy egység/mp-cel megy, kilenc egységgel a vonal
      // előtt még bőven meg tud állni — de addig is ott áll, és a városnak
      // ez a fele a vesztegelés.
      if (blocked && approach > 0 && approach < 6) {
        npc.waiting = 0.2;
      }

      // AZ ELŐTTE ÁLLÓ. Előzés nincs, tehát aki mögé beérsz, ott marad.
      for (const other of this.npcs) {
        if (other === npc || other.alongZ !== npc.alongZ || other.lane !== npc.lane) continue;
        if (other.dir !== npc.dir) continue;
        const gap = (other.at - npc.at) * npc.dir;
        if (gap > 0 && gap < 9) npc.waiting = 0.2;
      }

      // A JÁTÉKOS KOCSIJA az úton. A sávot nem nézzük — aki keresztben áll
      // az utcán, az is akadály —, csak azt, hogy előttünk van-e, közel.
      for (const player of players) {
        const dx = player.x - npc.mesh.position.x;
        const dz = player.z - npc.mesh.position.z;
        const ahead = npc.alongZ ? dz * npc.dir : dx * npc.dir;
        const side = npc.alongZ ? dx : dz;
        if (ahead > 0 && ahead < 10 && Math.abs(side) < 4) npc.waiting = 0.2;
      }

      if (npc.waiting > 0) continue;

      npc.at += npc.speed * npc.dir * dt;

      // A város szélén megfordul. Nem tűnik el és nem is születik újra: egy
      // felbukkanó autó a visszapillantóban rosszabb, mint egy megforduló.
      const span = npc.alongZ ? this.halfZ : this.halfX;
      if (Math.abs(npc.at) > span) {
        npc.dir *= -1;
        npc.at = Math.sign(npc.at) * span;
      }
      this.place(npc);
    }
  }

  /** Milyen messze a következő megállási vonal, a haladás irányában. */
  private distanceToStopLine(npc: Npc): number {
    // CSAK A LÁMPÁS kereszteződések számítanak megállási vonalnak. A többi
    // egyszerű útkereszteződés — ott menni kell, nem állni.
    const crossing = npc.alongZ ? this.lit.z : this.lit.x;
    if (crossing.length === 0) return -1;
    let best = -1;
    for (const line of crossing) {
      const ahead = (line - npc.at) * npc.dir;
      if (ahead > 0 && (best < 0 || ahead < best)) best = ahead;
    }
    return best;
  }

  /** Hány autó áll épp — a mérésnek. */
  get waitingCount(): number {
    return this.npcs.filter((n) => n.waiting > 0).length;
  }

  get cars(): readonly { mesh: THREE.Object3D }[] {
    return this.npcs;
  }
}
