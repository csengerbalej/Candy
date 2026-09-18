import * as THREE from 'three';
import type { RoomPeer, RoomTransport } from './Room';
import type { PlayerInput } from '../input/InputManager';
import type { PlayerController } from '../player/PlayerController';
import type { Homeowner, HomeownerState } from '../ai/Homeowner';
import type { HouseWorld } from '../world/HouseWorld';
import type { HouseGame } from '../game/HouseGame';

/**
 * A ház két eszköz között.
 *
 * Ugyanaz a szereposztás, mint a vezetésnél, más okból. Ott azért volt egy
 * szimulátor, mert egy autót nem lehet két gépen számolni; itt azért, mert a
 * LAKÓ nem lehet két helyen. Ha mindkét gép futtatná a járőrözést, a két
 * zseblámpa két irányba nézne, és a két játékos két különböző játékban
 * bujkálna — miközben épp az a játék, hogy tudjátok, hol van.
 *
 * Amit ez elrendez:
 *
 *   mindkettő → presence   a SAJÁT szörnye helye és iránya, plusz a neve és
 *                          hogy melyik karaktert választotta. Utóbbi kettő
 *                          azért, mert a két front-end külön fut: a társ a
 *                          saját gépén választ, tehát innen tudjuk meg, kit
 *                          kell kirajzolni.
 *
 *   csak a gazda → presence   a lakó helye, iránya és állapota; mely cukorkák
 *                          fogytak el; megvan-e a szökés. Ez mind ÁLLAPOT,
 *                          nem esemény — aki később néz oda, akkor is a
 *                          helyeset látja.
 *
 *   csak a vendég → presence  hogy nyomva tartja-e a HASZNÁLAT gombot.
 *
 * Ez az utolsó a nem nyilvánvaló. A használat élménye szerint PILLANAT
 * („felkaptam a tálat"), és kézenfekvő lenne eseményként küldeni — de az
 * esemény elveszhet, és egy elveszett gombnyomás úgy néz ki, mintha a
 * játékos gépe elromlott volna. A LENYOMVA-TARTÁS viszont állapot: ha egy
 * csomag kimarad, a következő helyrerakja. A felfutó élt a gazda gépe
 * számolja ki a változásból — pont ott, ahol a szabályok futnak.
 */

/** Rövid kulcsok: a jelenlét-keret 4 KiB. */
interface HousePresence {
  /** a saját szörny: x, y, z, irány */
  hp?: [number, number, number, number];
  /** nyomva tartja-e a HASZNÁLAT gombot */
  hu?: boolean;
  /** a neve és a választott karaktere */
  hn?: string;
  hc?: string;
  /** csak a gazdától: a lakó x, y, z, irány */
  ho?: [number, number, number, number];
  /** csak a gazdától: a lakó állapota */
  hs?: string;
  /** csak a gazdától: mely cukorkák fogytak el */
  hk?: number[];
  /** csak a gazdától: kijutottak-e, és hány cukorka van meg */
  he?: boolean;
  hq?: number;

  // --- FOGÓ MÓD ------------------------------------------------------------
  //
  // Itt nem társak vagyunk, hanem ellenfelek — és ettől a szinkron
  // kérdése is megfordul. A kooperatív részben a GAZDÁNAK van igaza
  // mindenben. Fogóban viszont mindenki a SAJÁT dolgairól mond igazat:
  // hány cukorka van a kezében, mi van a kezében, és kit talált el. Ez
  // nem engedékenység, hanem az egyetlen működő felosztás: a lövésedet a
  // te gépeden látod elsülni, és ha a döntést a másik gépre bíznánk, a
  // találat egy fél másodperccel a lövés után jönne meg.

  /** a kezemben lévő és a sarkomba bevitt cukorka */
  fc?: number;
  fb?: number;
  /** mi van a kezemben, és mennyi lőszerrel */
  fw?: string;
  fa?: number;
  /**
   * AMIKOR ELTALÁLTALAK. Sorszám + honnan + mekkora erővel.
   *
   * Sorszám, nem esemény: egy esemény elveszhet, és egy elveszett találat
   * úgy néz ki, mintha átmentél volna a másikon. A sorszám VÁLLALJA a
   * veszteséget — ha egy csomag kimarad, a következő már az új számot
   * hozza, és a találat akkor is megtörténik.
   */
  fh?: [number, number, number, number, number, number];
  /** AMIT LŐTTEM: sorszám, honnan, hova, melyik fegyverrel — csak a csíkhoz. */
  fs?: [number, number, number, number, number, number, number, string];
}

/** Egy találat, ahogy az elszenvedője megkapja. */
export interface RemoteHit {
  from: THREE.Vector3;
  strength: number;
  knockback: number;
}

/** Egy lövés nyoma, ahogy a másik gépen kirajzolódik. */
export interface RemoteShot {
  from: THREE.Vector3;
  to: THREE.Vector3;
  kind: string;
  hit: boolean;
}

const IDLE: PlayerInput = {
  nitro: false,
  moveX: 0,
  moveY: 0,
  jump: false,
  jumpHeld: false,
  interact: false,
  interactHeld: false,
  sprint: false,
  usingGamepad: false,
  pause: false,
};

export class HouseLink {
  /** Amit a társról tudunk: neve és karaktere, ha már elküldte. */
  remoteName = '';
  remoteCharacter = '';

  /** A távoli játékos bemenete, ahogy a szabályok látják. */
  private readonly remoteInput: PlayerInput = { ...IDLE };
  private remoteHeldBefore = false;

  /** A társ fogó-állapota, ahogy legutóbb megmondta. */
  readonly remoteFogo: { carried: number; banked: number; weapon: string; ammo: number } = {
    carried: 0,
    banked: 0,
    weapon: '',
    ammo: 0,
  };
  /** A legutóbb FELDOLGOZOTT sorszámok — ezekből tudjuk, mi az új. */
  private seenHit = 0;
  private seenShot = 0;
  /** A saját kimenő sorszámaink. */
  private hitSeq = 0;
  private shotSeq = 0;
  private outHit: HousePresence['fh'];
  private outShot: HousePresence['fs'];
  private lastSent = 0;
  private sentHeld = false;

  constructor(
    private readonly room: RoomTransport | null,
    private readonly amHost: boolean,
    private readonly localIndex: 0 | 1
  ) {}

  private get remoteIndex(): 0 | 1 {
    return this.localIndex === 0 ? 1 : 0;
  }

  /** A saját gépem kiteszi magáról, amit a másiknak tudnia kell. */
  publish(
    players: PlayerController[],
    input: PlayerInput,
    homeowner: Homeowner,
    world: HouseWorld,
    game: HouseGame,
    identity: { name: string; character: string }
  ): void {
    if (!this.room) return;

    // A fojtás a HELYRE való, nem a gombra.
    //
    // Harmincszor másodpercenként bőven elég ahhoz, hogy a társ szörnye
    // simán mozogjon — de egy koppintás rövidebb lehet 33 ezredmásodpercnél,
    // és akkor a lenyomás ÉS az elengedés is ugyanabba a kihagyott ablakba
    // esik: a társ gépe soha nem látja, hogy megnyomtad. Lemérve: két egymás
    // utáni nyomás közül a második eltűnt. Ezért az állapot VÁLTOZÁSA mindig
    // azonnal megy, akkor is, ha az előző csomag épp most ment el.
    const now = Date.now();
    const heldChanged = input.interactHeld !== this.sentHeld;
    if (!heldChanged && now - this.lastSent < 33) return;
    this.lastSent = now;
    this.sentHeld = input.interactHeld;

    const me = players[this.localIndex];
    const patch: HousePresence = {
      hp: [round(me.position.x), round(me.position.y), round(me.position.z), round(me.mesh.rotation.y, 1000)],
      hu: input.interactHeld,
      hn: identity.name,
      hc: identity.character,
    };

    // FOGÓ: a sajátomról mondok igazat. A gazdaság itt nem számít — a
    // kezemben lévő cukorkát nem a másik gépe tartja számon.
    if (this.fogo) {
      patch.fc = this.fogo.carried;
      patch.fb = this.fogo.banked;
      patch.fw = this.fogo.weapon;
      patch.fa = this.fogo.ammo;
      if (this.outHit) patch.fh = this.outHit;
      if (this.outShot) patch.fs = this.outShot;
    }

    if (this.amHost) {
      patch.ho = [
        round(homeowner.position.x),
        round(homeowner.position.y),
        round(homeowner.position.z),
        round(homeowner.group.rotation.y, 1000),
      ];
      patch.hs = homeowner.state;
      // Csak az elfogyottak indexe megy át, nem minden tálé: egy félig
      // kiürített lakásban ez néhány szám, nem száz.
      patch.hk = world.candySpots.flatMap((c, i) => (c.taken ? [i] : []));
      patch.he = game.stats.escaped;
      patch.hq = game.stats.candy;
    }

    this.room.presence(patch as unknown as Record<string, unknown>);
  }

  /**
   * A SAJÁT fogó-állapotom, amit a következő csomag visz.
   *
   * A jelenet minden képkockában beállítja; a link dönti el, mikor megy el.
   */
  fogo: { carried: number; banked: number; weapon: string; ammo: number } | null = null;

  /** ELTALÁLTAM A TÁRSAT. A találatot a LÖVŐ dönti el — lásd fent. */
  sendHit(from: THREE.Vector3, strength: number, knockback: number): void {
    this.hitSeq++;
    this.outHit = [
      this.hitSeq,
      round(from.x),
      round(from.y),
      round(from.z),
      round(strength, 100),
      round(knockback, 100),
    ];
  }

  /** LŐTTEM. Csak a látványért: a társ gépén is legyen csík és becsapódás. */
  sendShot(from: THREE.Vector3, to: THREE.Vector3, kind: string, hit: boolean): void {
    this.shotSeq++;
    this.outShot = [
      this.shotSeq,
      round(from.x),
      round(from.y),
      round(from.z),
      round(to.x),
      round(to.y),
      round(to.z),
      hit ? `${kind}!` : kind,
    ];
  }

  /** Az ÚJ találat, ha jött ilyen. Egyszer adja ki — utána megette. */
  takeHit(): RemoteHit | null {
    const h = this.lastState?.fh;
    if (!h || h[0] === this.seenHit) return null;
    this.seenHit = h[0];
    return { from: new THREE.Vector3(h[1], h[2], h[3]), strength: h[4], knockback: h[5] };
  }

  /** Az ÚJ lövés, ha jött ilyen. Csak rajzolni való. */
  takeShot(): RemoteShot | null {
    const s = this.lastState?.fs;
    if (!s || s[0] === this.seenShot) return null;
    this.seenShot = s[0];
    const kind = String(s[7]);
    return {
      from: new THREE.Vector3(s[1], s[2], s[3]),
      to: new THREE.Vector3(s[4], s[5], s[6]),
      kind: kind.endsWith('!') ? kind.slice(0, -1) : kind,
      hit: kind.endsWith('!'),
    };
  }

  private lastState: HousePresence | null = null;

  /** Amit a másiktól kaptunk, ráolvasva a saját világunkra. */
  apply(
    peers: readonly RoomPeer[],
    players: PlayerController[],
    homeowner: Homeowner,
    world: HouseWorld,
    game: HouseGame
  ): void {
    const from = peers.find((p) => !p.isMe && (p.presence as HousePresence).hp);
    if (!from) return;
    const state = from.presence as HousePresence;
    this.lastState = state;

    if (typeof state.fc === 'number') this.remoteFogo.carried = state.fc;
    if (typeof state.fb === 'number') this.remoteFogo.banked = state.fb;
    if (typeof state.fw === 'string') this.remoteFogo.weapon = state.fw;
    if (typeof state.fa === 'number') this.remoteFogo.ammo = state.fa;

    if (state.hn) this.remoteName = state.hn;
    if (state.hc) this.remoteCharacter = state.hc;

    const other = players[this.remoteIndex];
    const hp = state.hp;
    if (hp) {
      // Simítva: harmincszor jön, hatvanszor rajzolunk.
      other.position.lerp(new THREE.Vector3(hp[0], hp[1], hp[2]), 0.35);
      other.mesh.position.copy(other.position);
      other.mesh.rotation.y = lerpAngle(other.mesh.rotation.y, hp[3], 0.35);
    }

    // A HASZNÁLAT gomb: az él a lenyomva-tartás VÁLTOZÁSA, nem külön üzenet.
    const held = Boolean(state.hu);
    this.remoteInput.interactHeld = held;
    this.remoteInput.interact = held && !this.remoteHeldBefore;
    this.remoteHeldBefore = held;

    // A vendég nem szimulál semmit, amiben a gazdának igaza lehetne.
    if (this.amHost) return;

    const ho = state.ho;
    if (ho) {
      homeowner.position.lerp(new THREE.Vector3(ho[0], ho[1], ho[2]), 0.35);
      homeowner.group.position.copy(homeowner.position);
      homeowner.group.rotation.y = lerpAngle(homeowner.group.rotation.y, ho[3], 0.35);
    }
    if (state.hs) homeowner.state = state.hs as HomeownerState;

    if (state.hk) {
      const taken = new Set(state.hk);
      for (let i = 0; i < world.candySpots.length; i++) {
        const spot = world.candySpots[i];
        const gone = taken.has(i);
        if (spot.taken === gone) continue;
        spot.taken = gone;
        spot.mesh.visible = !gone;
      }
    }
    if (typeof state.hq === 'number') game.stats.candy = state.hq;
    if (state.he) game.stats.escaped = true;
  }

  /**
   * A bemenet, ahogy a szabályok kérik.
   *
   * A saját játékosom a valódi gombjait kapja, a társam azt, ami a szobából
   * jött. Egyedül — amíg nincs társ — a másik index üres bemenetet kap, és a
   * `HouseGame.cast` amúgy sem néz rá.
   */
  source(local: { get(index: number): PlayerInput }): { get(index: number): PlayerInput } {
    const remoteIndex = this.remoteIndex;
    const remote = this.remoteInput;
    return {
      get: (index: number) => (index === remoteIndex ? remote : local.get(index)),
    };
  }
}

function round(v: number, scale = 100): number {
  return Math.round(v * scale) / scale;
}

function lerpAngle(from: number, to: number, t: number): number {
  let d = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d * t;
}
