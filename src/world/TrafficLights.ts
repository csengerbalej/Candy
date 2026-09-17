import * as THREE from 'three';

export interface LightSpot {
  /** A kereszteződés közepe, a falu normalizált terében. */
  centre: [number, number];
  /** Az úttest félszélessége — a kereszteződés doboza. */
  half: number;
  /** Milyen messze van a megállási vonal a középtől. */
  stop: number;
}

/**
 * Jelzőlámpák a kereszteződésekben.
 *
 * Két dolgot csinálnak, és a második a fontosabb. Egy: szabályt adnak, amit
 * meg lehet szegni — és a szabályszegés az, amiből a szörnyecskék haragja
 * épül. Kettő: MOZOGNAK. A város eddig néma és mozdulatlan volt; kilenc
 * váltakozó lámpa önmagában több életet ad neki, mint bármilyen díszlet.
 *
 * Az egész város EGY órán jár, nem lámpánként külön véletlenen. Így a piros
 * kiszámítható: aki figyel, meg tudja tanulni a ritmust, és ez sokkal jobb
 * annál, mint amikor minden sarok külön lutri. A szomszédos irányok
 * ellentétesek — amikor az egyik zöld, a másik piros.
 */
export class TrafficLights {
  readonly group = new THREE.Group();

  /**
   * Ennyi ideig zöld az egyik irány.
   *
   * Kilenc volt, és az NPC forgalom megmutatta, miért sok: egy piros
   * kilenc másodperc, egy áthaladás egy — tehát az autók a pirosnál
   * GYŰLNEK. Mérve a tizenkettőből átlagosan 6,6 állt, vagyis a város fele
   * mindig vesztegelt.
   *
   * Hat és fél: a szabály megmarad, a város viszont mozog.
   */
  private static readonly GREEN = 6.5;
  /** A sárga a zöld VÉGÉN, ebből. */
  private static readonly AMBER = 1.6;

  private clock = 0;
  private readonly spots: { centre: THREE.Vector3; half: number; stop: number }[] = [];
  private readonly lamps: {
    mesh: THREE.Mesh;
    mat: THREE.MeshStandardMaterial;
    halo: THREE.Sprite;
    dark: THREE.Color;
    hot: THREE.Color;
    northSouth: boolean;
    bulb: number;
  }[] = [];

  /** Hány piroson hajtottak át. A haragmérőnek és a mérésnek. */
  runs = 0;
  /** Épp most szegted meg — egyetlen képkockára igaz. */
  justRan = false;

  private readonly wasInside = new Map<number, boolean>();

  constructor(spots: LightSpot[], scale: number) {
    for (const s of spots) {
      const centre = new THREE.Vector3(s.centre[0] * scale, 0, -s.centre[1] * scale);
      this.spots.push({ centre, half: s.half * scale, stop: s.stop * scale });
      this.build(centre, s.half * scale, s.stop * scale);
    }
  }

  /**
   * Zöld-e most ez az irány.
   *
   * @param northSouth A Z tengely mentén haladók. A másik a kereszteződő ág.
   */
  green(northSouth: boolean): boolean {
    const phase = this.clock % (TrafficLights.GREEN * 2);
    const nsGreen = phase < TrafficLights.GREEN;
    const amber = phase % TrafficLights.GREEN > TrafficLights.GREEN - TrafficLights.AMBER;
    return (northSouth === nsGreen) && !amber;
  }

  /**
   * MELYIK LÁMPA VONATKOZIK RÁM.
   *
   * A haladási irányból, nem a helyzetből: a kereszteződésben állva a hely
   * már nem mond semmit. Ha jobban megy előre-hátra (Z), akkor az
   * észak-déli ág szabályai vonatkoznak rád — és pontosan az a lámpa, ami
   * SZEMBEN áll veled.
   */
  static lane(heading: number): boolean {
    return Math.abs(Math.cos(heading)) > Math.abs(Math.sin(heading));
  }

  /** Sárga-e — a kijelzőnek. A sárga NEM piros: átmenni rajta szabad. */
  private amber(northSouth: boolean): boolean {
    const phase = this.clock % (TrafficLights.GREEN * 2);
    const nsGreen = phase < TrafficLights.GREEN;
    return northSouth === nsGreen && phase % TrafficLights.GREEN > TrafficLights.GREEN - TrafficLights.AMBER;
  }

  /**
   * @param car Hol van a kocsi.
   * @param heading Merre néz — ebből derül ki, melyik ág szabályai vonatkoznak rá.
   */
  update(dt: number, car: THREE.Vector3, heading: number): void {
    this.clock += dt;
    this.justRan = false;

    for (let i = 0; i < this.lamps.length; i++) {
      const l = this.lamps[i];
      const go = this.green(l.northSouth);
      const amber = this.amber(l.northSouth);
      // 0 = piros, 1 = sárga, 2 = zöld. Egy izzó ég, a többi sötét — ez az,
      // amitől lámpának néz ki, és nem három színes pontnak.
      const lit = l.bulb === (go ? 2 : amber ? 1 : 0);
      // A kialudt izzó SÖTÉT, nem halvány: egy 4%-on izzó piros és egy
      // 240%-on izzó zöld egymás mellett messziről két világító pöttynek
      // látszik. A kontrasztot a kikapcsolt állapot adja, nem a bekapcsolt.
      l.mat.emissiveIntensity = lit ? 3.2 : 0;
      l.mat.color.copy(lit ? l.hot : l.dark);
      // És a fénykör: ez az, ami két utcával odébbről is elárulja a színt. A
      // magányos gömb harminc méterről néhány képpont — a glória nem.
      l.halo.visible = lit;
    }

    // Melyik ágon jön? A haladási irányból, nem a helyéből: a kereszteződésben
    // a hely már nem mond semmit.
    const alongZ = TrafficLights.lane(heading);

    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i];
      const dx = car.x - s.centre.x;
      const dz = car.z - s.centre.z;
      const inside = Math.abs(dx) < s.half && Math.abs(dz) < s.half;
      const before = this.wasInside.get(i) ?? false;
      this.wasInside.set(i, inside);

      // A vétség a BEHAJTÁS pillanata, nem az, hogy bent ácsorogsz. Aki piros
      // alatt beragadt a kereszteződésbe, az már megbűnhődött; aki áthajt, az
      // most szegi meg.
      if (inside && !before && !this.green(alongZ)) {
        this.runs++;
        this.justRan = true;
      }
    }
  }

  /** A lámpatest: négy sarokoszlop, mindegyik a saját ágának mutat. */
  private build(centre: THREE.Vector3, half: number, stop: number): void {
    const pole = new THREE.MeshStandardMaterial({ color: 0x232028, roughness: 0.8 });
    const box = new THREE.MeshStandardMaterial({ color: 0x14121a, roughness: 0.9 });

    // A négy sarok. Az oszlop a JÁRDÁN áll, a megállási vonalon kívül — az
    // úttesten semmi nem állhat, ez a város óta szabály.
    //
    // A HARMADIK SZÁM az, hogy melyik ÁG fázisát mutatja, és ez fel volt
    // cserélve. Az első kettő az X tengely mentén áll ki a kereszteződésből
    // (`stop` az X-ben), tehát az X felől ÉRKEZŐT állítja meg — vagyis a
    // kelet-nyugati forgalom lámpája, nem az észak-déli. Emiatt a szemben
    // lévő lámpa a MÁSIK irány fázisát mutatta: pirosat láttál, miközben
    // neked zöld volt, és fordítva.
    //
    // A szabály maga jó volt (a haladási irányból dönt), csak a KÉP hazudott
    // hozzá — és a képet nézed.
    const corners: [number, number, boolean][] = [
      [stop, half * 1.15, false],
      [-stop, -half * 1.15, false],
      [half * 1.15, -stop, true],
      [-half * 1.15, stop, true],
    ];

    for (const [ox, oz, northSouth] of corners) {
      const mast = new THREE.Group();
      mast.position.set(centre.x + ox, 0, centre.z + oz);

      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 5.4, 8), pole);
      post.position.y = 2.7;
      post.castShadow = true;
      mast.add(post);

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.72, 2.2, 0.5), box);
      head.position.y = 5.3;
      mast.add(head);

      // Az izzók a kereszteződés FELÉ néznek, hogy az odaérkező lássa őket.
      const facing = Math.atan2(-ox, -oz);
      mast.rotation.y = facing;

      // FELÜLRŐL LEFELÉ: piros, sárga, zöld — ahogy egy valódi lámpán. A
      // `bulb` szám viszont az állapot kódja (0 = piros, 1 = sárga, 2 = zöld),
      // és a kettő NEM ugyanaz a sorrend. Először `2 - b` volt itt, amitől a
      // zöld fázisban a FELSŐ, piros izzó gyulladt ki.
      const colours = [0xff2b2b, 0xffb020, 0x35e06a];
      for (let b = 0; b < 3; b++) {
        const mat = new THREE.MeshStandardMaterial({
          color: colours[b],
          emissive: colours[b],
          emissiveIntensity: 0.04,
          roughness: 0.4,
        });
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), mat);
        bulb.position.set(0, 6.05 - b * 0.72, 0.32);
        mast.add(bulb);

        // ÖSSZEADÓ fénykör, mindig a néző felé fordulva. Ugyanaz a döntés,
        // mint a lakó zseblámpakúpjánál: a fény hozzáad, nem eltakar, tehát
        // az éjszakában felizzik, a fehér falon viszont nem lesz belőle folt.
        const halo = new THREE.Sprite(
          new THREE.SpriteMaterial({
            color: colours[b],
            transparent: true,
            // Halványabb és KISEBB, mint az első nekifutásnál. Két egység
            // átmérőjű, 62%-os összeadó folt egy 0,85 széles lámpatesten nem
            // glória, hanem egy világító tábla: elnyelte a házat is, és a
            // három izzóé egymásba folyt egyetlen sárga négyszöggé.
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        halo.scale.setScalar(0.92);
        halo.position.copy(bulb.position).setZ(0.42);
        halo.visible = false;
        mast.add(halo);

        this.lamps.push({
          mesh: bulb,
          mat,
          halo,
          // A kialudt izzó SÖTÉT ÜVEG, nem tompított szín: 16%-on mind a
          // három látszott, és három színes pötty nem lámpa.
          dark: new THREE.Color(colours[b]).multiplyScalar(0.05),
          hot: new THREE.Color(colours[b]),
          northSouth,
          bulb: b === 0 ? 0 : b === 1 ? 1 : 2,
        });
      }

      this.group.add(mast);
    }
  }
}
