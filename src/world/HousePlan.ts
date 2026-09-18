import * as THREE from 'three';

/**
 * A KÉZZEL MEGRAJZOLT PÁLYA.
 *
 * A fogó pálya eddig sorsolt: hatvan véletlen pontból a két legtávolabbi
 * lett a gyűjtősarok, a fegyverek negyven másikra kerültek. Ez működött, de
 * VÉLETLEN volt — és a véletlen nem tud arról, hogy a fürdőszoba zsákutca,
 * hogy a hálószobán át vezet a rövid út, vagy hogy két cukorka egy szobában
 * nem két cél, hanem egy.
 *
 * Ez a fájl egy MEGRAJZOLT alaprajz: a szobák, a két sarok, a cukorkák és a
 * fegyverek helye kézzel kijelölve. A koordináták a ház felülnézeti
 * alaprajzának képpontjaiból jönnek (`tools/house-plan.py` rajzolja ki, ismert
 * méretaránnyal), 0 és 1 közé normálva — így a ház méretezésétől függetlenek.
 *
 *   u = 0 a ház bal széle,  u = 1 a jobb széle
 *   v = 0 a ház hátsó fala, v = 1 az utcai fala
 *
 * Minden pont a legközelebbi ÁLLHATÓ helyre ugrik, mielőtt használnánk: a
 * rajz a padlóról szól, a bútorokról nem — az ütközőket a világ ismeri.
 */
export interface PlanPoint {
  u: number;
  v: number;
  /**
   * Kié ez a cukorka: 0 a narancssárgáé, 1 a liláé.
   *
   * Eddig a KÖZELEBBI SAROK döntötte el (a cukorka azé, akinek messzebb
   * van) — és ez a legtöbb helyen jól is működött. A konyhában viszont nem:
   * az két sarok közt félúton van, és a számolás a rajzzal ellentétes
   * választ adott. Egy szabály, ami a pálya közepén érmét dob, nem szabály.
   * Ahol a rajz megmondja, ott a rajz dönt.
   */
  owner?: 0 | 1;
}

export interface PlanRoom {
  name: string;
  /** A szoba téglalapja: bal-felső és jobb-alsó sarok. */
  from: PlanPoint;
  to: PlanPoint;
}

export interface HousePlan {
  rooms: PlanRoom[];
  /** A két gyűjtősarok: a 0. a narancssárgáé, az 1. a liláé. */
  corners: [PlanPoint, PlanPoint];
  /** Ahol cukorka teremhet. Csak ezeken a helyeken — sehol máshol. */
  candy: PlanPoint[];
  /** Ahol fegyver teremhet. */
  weapons: PlanPoint[];
}

/** Képpontból normált érték; a rajz 1200×1200-as. */
const p = (px: number, py: number, owner?: 0 | 1): PlanPoint => ({
  u: px / 1200,
  v: py / 1200,
  owner,
});

/**
 * AZ ELSŐ HÁZ.
 *
 * Hat szoba: nappali (jobb fent), konyha (jobb lent), hálószoba (bal lent),
 * fürdő (bal fent), mosdó (középen fent), előtér (középen).
 *
 * A két sarok a két ÁTLÓSAN szemközti lakószobába került — a nappaliba és a
 * hálószobába. Ez a leghosszabb út a házban, és mindkettőnek két kijárata
 * van: egy sarkot, amit egyetlen ajtón át lehet elérni, be lehet szorítani.
 *
 * A cukorka KERESZTBEN áll: a lila játékos cukorkája a narancssárga
 * térfelén terem és fordítva — ezért kell a másik oldalára átmenni, és ezért
 * találkoztok.
 */
const HOUSE1: HousePlan = {
  rooms: [
    { name: 'nappali', from: p(560, 120), to: p(1150, 620) },
    { name: 'konyha', from: p(610, 630), to: p(1120, 1140) },
    { name: 'haloszoba', from: p(45, 715), to: p(600, 1140) },
    { name: 'furdo', from: p(40, 140), to: p(345, 700) },
    { name: 'mosdo', from: p(355, 140), to: p(555, 450) },
    { name: 'eloter', from: p(345, 460), to: p(590, 710) },
  ],
  // A narancssárga a hálószobában, a lila a nappaliban.
  corners: [p(120, 950), p(950, 300)],
  candy: [
    // a nappaliban (a lila sarok mellett) — ezek a NARANCSSÁRGÁÉ
    p(680, 200, 0),
    p(820, 520, 0),
    p(1020, 560, 0),
    // a mosdóban — szintén a narancssárgáé
    p(400, 390, 0),
    // a konyhában — a LILÁÉ. A konyha ALSÓ VÉGÉBEN, nem a közepén: a
    // konyha közepe épp félúton van a két sarok között, és onnan a lila
    // játékos a saját térfeléről szedhetné fel — pedig a szabály épp az,
    // hogy a másik oldaláról kell hoznod.
    p(660, 1060, 1),
    // a hálószobában (a narancssárga sarok mellett) — ezek a LILÁÉ
    p(130, 790, 1),
    p(520, 800, 1),
    p(230, 1000, 1),
  ],
  weapons: [
    p(760, 380),
    p(950, 950),
    p(330, 780),
    p(460, 600),
    p(150, 430),
    p(480, 330),
  ],
};

const PLANS: Record<string, HousePlan> = { house1: HOUSE1 };

/** Van-e megrajzolt alaprajz ehhez a házhoz. A többi marad sorsolt. */
export function planFor(house: string): HousePlan | null {
  return PLANS[house] ?? null;
}

/**
 * A rajz egy pontja a világban.
 *
 * @param bounds A ház befoglalója a világban — a ház tudja, nem a rajz.
 */
export function planToWorld(
  point: PlanPoint,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
): THREE.Vector3 {
  return new THREE.Vector3(
    bounds.minX + point.u * (bounds.maxX - bounds.minX),
    0,
    bounds.minZ + point.v * (bounds.maxZ - bounds.minZ)
  );
}

/** Melyik szobában van ez a pont a rajz szerint? */
export function roomAt(plan: HousePlan, u: number, v: number): string | null {
  for (const room of plan.rooms) {
    if (u >= room.from.u && u <= room.to.u && v >= room.from.v && v <= room.to.v) return room.name;
  }
  return null;
}
