import * as THREE from 'three';

export type RigState = 'idle' | 'walk' | 'run' | 'jump' | 'carry' | 'sneak' | 'grab';

/**
 * What the gameplay layer is allowed to know about animation: a state goes in,
 * something moves. Whether that something is a skeleton or a sine wave is an
 * asset detail, and two of the four characters are currently the latter.
 */
export interface Rig {
  play(state: RigState, fade?: number): void;
  setSpeedScale(scale: number): void;
  update(dt: number): void;
}

/** Clip names as they arrive from the authoring tool, mapped to game states. */
export type ClipMap = Partial<Record<RigState, string>>;

const CLIP_FOR: ClipMap = {
  idle: 'Walking',
  walk: 'Walking',
  run: 'run_fast_7_inplace',
  jump: 'Regular_Jump',
  carry: 'Female_Run_Forward_Pick_Up_Right',
};

/**
 * A lakó klipjei.
 *
 * Ugyanarra a mixamorig csontvázra készült, mint a szörnyek, de MÁS a dolga:
 * nem ugrik és nem cipel, hanem járőrözik, lopakodik és üldöz. Ezért nem
 * elég egy közös táblázat — a szereplőt az különbözteti meg, hogy mit csinál,
 * és ez az a hely, ahol ezt ki lehet mondani.
 *
 * Az `idle` itt igazi helyben-járás, nem a járásciklus megállítva: a lakó
 * sosem alszik, csak vár, és ezt látni is kell rajta. A `sneak` a settenkedő
 * guggolás — a gyanakvó állapotoké.
 */
/**
 * A KÍSÉRTETHÁZ SZÖRNYEI.
 *
 * Egyetlen klipjük van, a járás — és ez nem hiányosság, hanem elég.
 *
 * Egy szörny, ami ácsorog, tétovázik és elgondolkodik, EMBER. Ezek nem
 * emberek: ugyanazzal a ritmussal jönnek feléd, akkor is, ha épp megálltak.
 * A futás ugyanaz a ciklus gyorsabban — a rig `rate`-je intézi —, és pont
 * ettől lesz rossz nézni: nem vált testtartást, csak GYORSUL.
 */
/**
 * A SZÖRNYEK MOZGÁSA — a közös csomagból, szörnyenként másként.
 *
 * A három letöltött modell mindegyikében EGYETLEN használható klip van: egy
 * 1,08 másodperces járásciklus (a másik nevű klip 0,08 mp, két képkocka
 * törmelék). Eddig ez az egy klip vitt mindent: az álló szörny helyben
 * lépkedett, a rohanó ugyanolyan ütemben rakta a lábát, mint a sétáló, és
 * az elkapás is ugyanaz a séta volt.
 *
 * Mérve viszont a szörnyek csontváza és a lakó klipcsomagja HUSZONHÉT
 * csontban azonos (mindkettő ugyanaz a Mixamo-rig; a szörnyön egy plusz
 * `headfront` csont van, ami a klipekben nem szerepel). Tehát a lakó teljes
 * mozgáskészlete ráhúzható — állás, futás, lopakodás —, és nem kell új
 * animációt szerezni hozzá.
 *
 * A HÁROM SZÖRNY HÁROM KÉSZLETET KAP, mert a mozgás a jellemük:
 */

/**
 * A VAK: TAPOGATÓZIK, AMÍG KERES.
 *
 * Nincs szeme, tehát nem járőrözik magabiztosan — óvatosan lép, előretartott
 * kézzel. Amikor meghall valamit, ELINDUL: akkor fut. A kettő között nincs
 * átmenet, és pont ez benne a rossz: amíg tapogat, addig van időd.
 */
export const VAK_CLIPS: ClipMap = {
  idle: 'Idle_5',
  walk: 'Cautious_Crouch_Walk_Forward',
  sneak: 'Cautious_Crouch_Walk_Forward',
  run: 'Running',
  grab: 'Kick_a_Soccer_Ball',
};

/**
 * A KÖVETŐ: SOHA NEM FUT.
 *
 * Ő az, aki elől nem elbújni kell, hanem lehagyni — és ez csak akkor igaz,
 * ha LÁTSZIK is rajta. Egy szörny, aki fut, fenyegetés; egy szörny, aki
 * ugyanabban a tempóban jön akkor is, amikor te rohansz, sokkal rosszabb.
 * Ezért nála az üldözés klipje is a séta.
 */
export const KOVETO_CLIPS: ClipMap = {
  // KILENC SAJÁT KLIPPEL ÉRKEZETT, és kettő közülük mintha neki készült
  // volna. A `Slow_Orc_Walk` egy súlyos, lassú, megállíthatatlan lépés —
  // pontosan az, amiért a Követő ijesztő: nem rohan utánad, csak JÖN.
  // Ezért ez a járása ÉS az „üldözése" is: ő soha nem fut.
  //
  // Az `Unsteady_Walk` a támolygó változat, ez megy, amíg csak keres.
  idle: 'Alert',
  walk: 'Slow_Orc_Walk',
  sneak: 'Unsteady_Walk',
  run: 'Slow_Orc_Walk',
  grab: 'Skill_01',
};

/**
 * A LESŐ: ÁLL, AZTÁN ROBBAN.
 *
 * Amíg alszik, nem mozog — nem lopakodik, nem tapogat, csak ÁLL. Amikor
 * felébred, ő a leggyorsabb a házban, és azonnal futásra vált: nincs
 * „gyanakvó séta" közte, mert nem gyanakszik, hanem tud.
 */
export const LESO_CLIPS: ClipMap = {
  // A FIGYELŐ SAJÁT KÉSZLETE. A klipnevek az exportálótól jönnek
  // („Armature|…|baselayer"), ezért néznek ki így.
  //
  // Az ÁLLÁSA a `Skill_01`: ez az egyetlen klipje, ami nem
  // helyváltoztatás — ő az, aki a sötétben ÁLL és figyel, amíg rá nem
  // világítasz. Ébredés után a leggyorsabb a házban: `RunFast`.
  idle: 'Armature|Skill_01|baselayer',
  walk: 'Armature|walking_man|baselayer',
  sneak: 'Armature|Skill_01|baselayer',
  run: 'Armature|RunFast|baselayer',
  grab: 'Armature|running|baselayer',
};

/** Visszafelé kompatibilis alapértelmezés. */
export const LURKER_CLIPS: ClipMap = KOVETO_CLIPS;

export const HOMEOWNER_CLIPS: ClipMap = {
  idle: 'Idle_5',
  walk: 'Walking',
  run: 'Running',
  sneak: 'Cautious_Crouch_Walk_Forward',
  grab: 'Kick_a_Soccer_Ball',
};

/**
 * Idle has no clip of its own, so it is borrowed from the walk cycle — but
 * carefully.
 *
 * Frame zero of a walk is arms-pinned-to-the-sides, which reads as a melted
 * blob. Playing the cycle slowly instead is worse: a character standing still
 * drifts through mid-stride poses with one leg in the air. The passing pose,
 * a quarter of the way in, is the one frame of a walk where the feet are
 * together and the arms hang naturally — so idle parks there and breathes.
 */
const IDLE_PHASE = 0.25;
const IDLE_SWAY = 0.035;
const IDLE_RATE = 1.1;
// Egyszeri mozdulatok: lejátszódnak és megállnak az utolsó képkockán. A
// `grab` az elkapás — nem állapot, hanem esemény, és egy ciklusba tett esemény
// vagy örökké ismétlődne, vagy félbeszakadna.
const ONCE: Partial<Record<RigState, boolean>> = { jump: true, carry: true, grab: true };

/**
 * Drives one character's skeleton.
 *
 * The game never asks for a clip by name — it asks for a STATE, and the rig
 * decides what that looks like. That indirection is what lets the other three
 * characters arrive later with differently-named clips and no gameplay change.
 */
export class CharacterRig implements Rig {
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<RigState, THREE.AnimationAction>();
  private current: RigState | null = null;
  private idleClock = 0;
  /** Igaz, ha az `idle` csak egy kölcsönvett járáspóz, nem saját klip. */
  private readonly frozenIdle: boolean;

  /** Hány sáv kötött valódi csontra, és hány veszett el. A próba ezt kérdezi. */
  readonly bound: { hit: number; miss: number } = { hit: 0, miss: 0 };

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[], clipFor: ClipMap = CLIP_FOR) {
    this.mixer = new THREE.AnimationMixer(root);

    const bones = boneNames(root);
    const byName = new Map(clips.map((c) => [c.name, c]));
    for (const [state, clipName] of Object.entries(clipFor) as Array<[RigState, string]>) {
      const raw = byName.get(clipName);
      if (!raw) continue;
      const clip = retarget(raw, bones, this.bound);
      const action = this.mixer.clipAction(stripRootTranslation(clip));
      if (ONCE[state]) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(state, action);
    }

    this.frozenIdle = clipFor.idle === clipFor.walk;
    this.play('idle', 0);
  }

  /** Crossfade to a state. Repeating the current state is a no-op. */
  play(state: RigState, fade = 0.18): void {
    if (state === this.current) return;
    const next = this.actions.get(state);
    if (!next) return;

    const previous = this.current ? this.actions.get(this.current) : undefined;
    this.current = state;

    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    // Az `idle` a szörnyeknél a járásciklus EGY megállított póza (lásd
    // IDLE_PHASE), a lakónál viszont saját, helyben járó klip. Ha itt is
    // lefagyasztanánk, a lakó kimerevedne — ami pont azt a benyomást keltené,
    // hogy nem figyel.
    next.timeScale = state === 'idle' && this.frozenIdle ? 0 : 1;
    next.play();

    if (previous && previous !== next) previous.crossFadeTo(next, fade, false);
    else next.fadeIn(fade);
  }

  /** Speeds the walk and run cycles to match how fast the character moves. */
  setSpeedScale(scale: number): void {
    for (const state of ['walk', 'run', 'sneak'] as RigState[]) {
      const action = this.actions.get(state);
      if (action) action.timeScale = scale;
    }
  }

  update(dt: number): void {
    const idle = this.actions.get('idle');
    if (idle && this.frozenIdle && this.current === 'idle') {
      this.idleClock += dt;
      const duration = idle.getClip().duration;
      idle.time =
        (IDLE_PHASE + Math.sin(this.idleClock * IDLE_RATE) * IDLE_SWAY) * duration;
    }
    this.mixer.update(dt);
  }
}

/**
 * Remove horizontal motion from the root bone.
 *
 * These clips carry root motion: the walk cycle slides the hips forward over
 * its length. The game already moves the character through the world, so
 * leaving it in makes the model drift out of its own collision capsule and
 * snap back every loop. Vertical motion stays — that is the bounce.
 */
function stripRootTranslation(clip: THREE.AnimationClip): THREE.AnimationClip {
  const stripped = clip.clone();
  // Csak a GYÖKÉR vízszintes elmozdulása esik ki: a testet a világban a
  // játék mozgatja, a függőleges ringás viszont a járás fele.
  //
  // (Egy ideig itt MINDEN helyzetsáv ki volt szűrve, mert az új szörnyek
  // az animáció elindulásakor százszorosra nőttek. A hiba nem itt volt:
  // a letöltött rigek csontjai CENTIMÉTERBEN álltak — mérve a csípő
  // csontja 126 méteren —, és ezt a `merge-monster.py` rendezi el, ahol
  // a hiba keletkezik. Itt elég a régi, finomabb szabály.)
  for (const track of stripped.tracks) {
    if (!/\.position$/.test(track.name)) continue;
    if (!/(^|\.)(Hips|hips|mixamorig:?Hips)\./.test(`.${track.name}`)) continue;
    // A FÜGGŐLEGES IS KIESIK, NEM CSAK A VÍZSZINTES.
    //
    // A ringás szép volna, de mérve ez süllyesztette a padló alá az új
    // szörnyeket: a csípő Y-sávja ezekben a klipekben nem RINGÁS, hanem
    // abszolút magasság — a kötési pózban a csípő egy méter magasan van, a
    // klip első képkockáján viszont majdnem nullán. A test ettől azonnal
    // két méterrel lejjebb kerül, és a ház padlója eltakarja. Pontosan ez
    // volt a „két szem lebeg a sötétben, test nélkül".
    //
    // A testet a világban a játék mozgatja — vízszintesen ÉS függőlegesen
    // is. A klipnek ehhez nincs hozzátennivalója.
    const values = track.values as Float32Array;
    for (let i = 0; i < values.length; i += 3) {
      values[i] = 0;
      values[i + 1] = 0;
      values[i + 2] = 0;
    }
  }
  return stripped;
}

/** A csontváz csontjainak neve, a gyökér alatt bárhol. */
function boneNames(root: THREE.Object3D): Set<string> {
  const names = new Set<string>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) names.add(o.name);
  });
  return names;
}

/**
 * A klip sávjait ÁTNEVEZI a célcsontváz neveire.
 *
 * Ez volt a T-póz oka, és a legpontosabb példa arra, miért kell mérni:
 * a lakó animációja LEFUTOTT (a művelet súlya 1,0, a keverő órája ketyegett),
 * és közben nulla csontot mozgatott — mert a sávok `mixamorigHead_1`-et
 * címeztek, a csontváz csontja viszont `mixamorigHead`. Az `_1` utótagot a
 * betöltő teszi hozzá, amikor a klipfájlban ütközik egy név; a régi
 * kettőspontos `mixamorig:Head` alakot ugyanígy átírja. A keverő némán
 * elnyeli az ismeretlen nevet — se hiba, se figyelmeztetés, csak egy T-póz.
 *
 * A párosítás normalizált néven megy: kettőspont és `mixamorig` előtag el,
 * a záró `_szám` utótag el, kisbetűsítve. Ami így sem talál csontot, az
 * kimarad — egy sáv, ami senkit nem mozgat, csak számol.
 */
export function retarget(
  clip: THREE.AnimationClip,
  bones: Set<string>,
  tally: { hit: number; miss: number }
): THREE.AnimationClip {
  const norm = (name: string): string =>
    name.replace(/^mixamorig:?/i, '').replace(/_\d+$/, '').replace(/[:_\s]/g, '').toLowerCase();

  // ELSŐ NYER. Ha két csont neve ugyanarra normalizálódik (`mixamorigHips` és
  // `Hips`), a későbbi ne írja felül a korábbit: a csontváz sorrendje a
  // gyökértől halad, tehát az első a valódi lánc része. Felülírva a klip egy
  // mellékágra kötne — és az ugyanolyan némán rossz, mint a T-póz.
  const lookup = new Map<string, string>();
  for (const bone of bones) if (!lookup.has(norm(bone))) lookup.set(norm(bone), bone);

  const out = clip.clone();
  const kept: THREE.KeyframeTrack[] = [];
  for (const track of out.tracks) {
    const dot = track.name.lastIndexOf('.');
    const node = dot < 0 ? track.name : track.name.slice(0, dot);
    const property = dot < 0 ? '' : track.name.slice(dot);
    if (bones.has(node)) {
      kept.push(track);
      tally.hit++;
      continue;
    }
    const target = lookup.get(norm(node));
    if (!target) {
      tally.miss++;
      continue;
    }
    track.name = target + property;
    kept.push(track);
    tally.hit++;
  }
  out.tracks = kept;
  return out;
}
