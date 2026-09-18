/**
 * CANDYPOCALYPSE — Slice 0 tuning constants.
 * Everything the camera director and controllers argue about lives here,
 * so the "does this feel good?" loop is one file, not a treasure hunt.
 */

export const PLAYER_COUNT = 2 as const;

/**
 * Simulation runs on a fixed step, decoupled from the render rate.
 *
 * This is not premature polish. With a variable step clamped at 1/20, a machine
 * that renders at 20fps advances the world at a third of real time — the car
 * accelerates like a milk float and the homeowner patrols in slow motion, with
 * nothing in the code looking wrong. Physics gets a constant; rendering gets
 * whatever the machine can give.
 */
export const SIM = {
  step: 1 / 60,
  /**
   * Hány fix lépést szabad EGY képkockában behozni.
   *
   * Hat volt, ami 0,1 másodpercet fed le — vagyis minden képkocka, ami
   * ennél tovább tartott, LASSÍTOTT FELVÉTELBE tette a játékot: a maradék
   * időt eldobtuk, a világ pedig annyival lassabban járt. Mérve: nyolc
   * kép/mp mellett 80%-os, négynél 40%-os sebesség — az autó 40 km/h-t
   * mutatott, miközben hat másodperc alatt négy egységet haladt.
   *
   * A képkockaidő felülről 0,25 másodpercre van vágva (lásd `main.ts`), és
   * ennyit tizenöt lépés fed le pontosan. Így akármilyen lassú a gép, a
   * világ VALÓS IDŐBEN jár — csak szaggatottan, ami rossz, de nem hazugság.
   */
  maxSteps: 15,
};

export const MOVE = {
  walkSpeed: 6.0,
  sprintSpeed: 9.5,
  accel: 55,
  friction: 12,
  airControl: 0.35,
  gravity: -26,
  /**
   * Ugrás.
   *
   * ÚJRAHANGOLVA a valódi lakáshoz. A régi számok (13,0 és 10,5, azaz 3,25 és
   * 5,37 egység) a greybox konyhához voltak mérve, ahol a bútorok 1,8 és 7,2
   * között voltak. A Meshy-lakás viszont HOUSE1_SCALE = 36-on áll, és ott
   * lemérve egészen mások a magasságok:
   *
   *     0–12 egység   159 doboz   bútor (kanapé, ágy, pult, asztal)
   *    14–18 egység   168 doboz   szekrény és FAL (a fal pontosan 17)
   *
   * A régi ugrás az ütközők 11 százalékára vitt fel — vagyis gyakorlatilag
   * semmire. Egy házban, amit mászkálásra terveztek, ez nem „szigorú", hanem
   * elrontott.
   *
   * Az új számok: egy ugrás 7,0 egység (alacsony bútor), kettő együtt 12,6
   * (pult, asztal). A FAL 17-en marad, tehát elérhetetlen — és ez szándékos:
   * amire fel lehet jutni, az pályatervezési eszköz, nem lehet „minden".
   */
  jumpSpeed: 19.1,
  /**
   * A második ugrás, levegőben.
   *
   * Gyengébb az elsőnél, hogy a kettő együtt se érje el a falat: a teljes
   * ugrás tetejéről 5,6 egységet ad hozzá.
   */
  doubleJumpSpeed: 17.0,
  /** How many jumps may be taken after leaving the ground. */
  airJumps: 1,
  /**
   * How long after leaving the ground the second jump becomes available.
   *
   * Without it, a button held down spends the air jump on the frame after the
   * first one — and because the second jump REPLACES upward speed rather than
   * adding to it, the weaker one cut the stronger one short: holding jump went
   * LOWER than tapping it. The input manager delivers edges, so this never
   * fires in the game, but a jump that depends on that to be correct is a jump
   * waiting to break.
   */
  airJumpDelay: 0.14,
  radius: 0.45,
  height: 1.7,
};

export const CAMERA = {
  fov: 50,
  // Tight on purpose: the ratio is what depth precision costs.
  near: 0.6,
  far: 320,
  /** The direction each section is entered facing; Q and E turn it from there. */
  yaw: Math.PI * 0.0,
  /**
   * How far above the horizon the stage camera sits, outdoors.
   */
  pitch: 0.62,
  /**
   * Beltéri kameraszög.
   *
   * Ez már kétszer ment félre. Kültéren majdnem szemmagasságból nézünk, és egy
   * lakásban az a falat mutatta egy méterrel előttünk; erre 54 fokra ment, ami
   * meg madártávlat lett. 39 fok volt a következő kísérlet — az a lakás
   * HOSSZÁBAN néz, de mérve kiderült, mibe került: a rajzolt fal kilenc egység
   * magas, a fej 1,7-en van, tehát egy fal (9 − 1,7) / tan(39°) = 9 egységgel a
   * játékos MÖGÖTT is eltakarja. A lakás bejárható celláinak 47,5 százalékán
   * (a négy nézetállás átlagában, 53 004 mintapont) nem látszott a játékos.
   *
   * 44,7 fokon ugyanez a falárnyék 7,4 egység és a takart cellák aránya 40,1
   * százalék. Nem a megoldás — azt a szobánkénti vágósíkok adják, amik az
   * aktuális szoba falait egyszerűen kiveszik a képből —, de a vágás nélküli
   * esetekben (folyosó, szoba nélküli cella) ez a különbség.
   */
  housePitch: 1.22,
  /**
   * A beltéri lencse — szobánkénti keretezéshez.
   *
   * Amíg a kamera „minél többet mutatok" elven ment, a 68 fok volt a jó: minél
   * szélesebb, annál több szoba fért a képbe. A szabály most az ellenkezője —
   * PONTOSAN az aktuális szoba kell a képbe, se több, se kevesebb —, és ehhez
   * szűkebb lencse a jobb: a távolságot úgyis a szoba mérete szabja meg, a
   * szűkebb lencse viszont kevésbé torzítja a kép szélén álló bútort, és
   * ugyanahhoz a kerethez nagyobb játékost ad.
   *
   * Mérve, egy 17×17 egységes szobára, 1920×1080-on: 62 fokon a kamera 17,1
   * egységről keretezi be, és a 1,7 egység magas szörny a képmagasság 5,9
   * százaléka. A régi 68/22 kombináció 4,4 százalékot adott — épp a
   * felismerhetőségi küszöbön. Álló panelben (függőleges osztás, 960×1080)
   * ugyanez a szoba 18,7 egységről fér be, a szörny 5,4 százalék.
   */
  houseFov: 60,
  /**
   * Felső korlát a szoba-keretezésre — és ezt NEM a szobák mérete szabja meg,
   * hanem a felismerhetőség.
   *
   * A lakás hét szobája 15×21-től 42×39 egységig terjed; a legnagyobb maga a
   * lakás fele. Azt 19,1 fokon és 60 fokos látószögön 41 egységről lehetne
   * egyben bekeretezni, és ott egy 1,7 egység magas szörny a képmagasság 3,4
   * százaléka. 4 százalék alatt a figura felismerhetetlen folt, tehát ez a
   * keretezés a saját célját rontaná el: a szoba a képen lenne, a játékos nem.
   *
   * 34 egység pontosan az a távolság, ahol a szörny még 4,1 százalék. Az ára,
   * kimondva: az öt kisebb szoba (≤34 egység) továbbra is EGYBEN látszik, a két
   * nagyból viszont egyszerre csak egy darab. A szabály ettől nem sérül — a
   * vágósíkok gondoskodnak róla, hogy más szobából semmi ne látsszon —, és a
   * kamera ilyenkor a szobán belül követi a játékost (lásd `framedFocus`),
   * úgyhogy a sarokba állva sem csúszik ki a képből.
   *
   * Ha a két nagy szobát is egyben kellene látni, az nem itt dől el: a
   * szegmentálónak kellene őket kisebb szobákra bontania.
   */
  houseMaxDistance: 30,
  /**
   * Alsó korlát, és ez nem ízlés kérdése.
   *
   * A kamera magassága = távolság × sin(szög), és a rajzolt falak koronája
   * WALL_DRAW_HEIGHT = 5,5 egységen van. 19,1 fokon a falak fölött maradáshoz
   * (1,15-szörös ráhagyással) 1,15 × 5,5 / sin(0,333) = 19,3 egység kell. Ez
   * alatt a kamera a falak KÖZÉ kerül, és egy szoba helyett egy falfelületet
   * nézünk. 20 a legkisebb kerek szám, ami ezt tartja — és történetesen a
   * legkisebb szoba (15×21) keretezéséhez is épp ennyi kell.
   */
  houseMinDistance: 18,
  /**
   * Tartalék követési távolság, ha a cellának nincs szobája.
   *
   * Nem lehet kisebb a minimumnál: ugyanaz a falkorona-kényszer él rá. 17-en
   * (a korábbi értéken) a kamera 5,56 egység magasan ülne, a falak koronája
   * alatt — pont az a kép, ami miatt „nem látni, hol vagyunk".
   */
  houseFollowDistance: 20,
  /**
   * Mennyi falmagasságot keretezünk be a szobából.
   *
   * A teljes kilenc egységet bekeretezve egy 17 egységes szobához 26 egység
   * távolság kellene (44,7°/62°), és a kép harmada üres falsík lenne. Négy
   * egység elég ahhoz, hogy a szoba határai lássanak, és 17,1 egységen tartja
   * a kamerát.
   */
  roomHeadroom: 3.0,
  /** Levegő a szoba széle és a képkeret között, világegységben. */
  roomPadding: 1.4,
  /**
   * Meddig mehet a játékos a képkeret felé, mielőtt a kamera utánamozdul.
   *
   * NDC-ben mérve (0 = képközép, 1 = a keret széle). A keret SZÉLÉN álló figura
   * fele már le van vágva, ezért 0,88 — ez 1920×1080-on nagyjából 115 képpont
   * biztonsági sáv. Nagy szobában ez dönti el, mikor kezd a kép „gördülni" a
   * szobán belül.
   */
  roomSafeFrame: 0.86,
  /**
   * Milyen gyorsan vált a kamera játékos-követésről szoba-keretezésre.
   *
   * Nem a szobák KÖZÖTTI váltás sebessége (azt a `roomSmoothing` adja), hanem
   * azé, amikor egyáltalán van-e szoba: egy folyosóra kilépve a keretezés
   * szabálya cserélődik, és kapcsolóként ez látható rándulás lenne.
   */
  roomEase: 0.7,
  /**
   * Pozíciósimítás szoba-keretezésnél.
   *
   * A követő kamera rugója (`smoothing` = 6,5) feszes, mert egy futó játékost
   * kell tartania. Szobák között viszont a kamera egy 17 egységes ugrást tesz
   * az ajtóban, és ugyanez a rugó abból csapást csinál: mérve 6,5-nél a
   * csúcsgyorsulás 212 e/s², 3,0-nél 45 e/s². Ez a különbség „átúszik a
   * szomszéd szobába" és „odarántja a fejed".
   */
  roomSmoothing: 1.8,
  /**
   * How far the shot leads ahead of the players, as a SHARE OF WHAT THE CAMERA
   * CAN SEE.
   *
   * A fixed number of units was the first attempt and it does not travel: the
   * same eleven units is most of the frame on the tight outdoor lens and a
   * quarter of it on the wide indoor one. A fraction of the visible height is
   * the same amount of "ahead" through any lens, and it cannot push the
   * players off the bottom of the screen by accident — at 0.42 they sit about
   * five sixths of the way down, and everything above them is where they are
   * going. It is measured against the camera's CURRENT distance, so a split
   * pane gets a smaller lead in world units and the same one on screen.
   */
  leadShare: 0.42,
  /**
   * How much of that a given speed earns. At a walk the lead is already at its
   * cap; standing still the camera sits on the players.
   */
  lookAheadPerSpeed: 2.8,
  /** How fast the look-ahead catches up. Low, or the camera lurches on a turn. */
  leadEase: 3.4,
  /**
   * Solo follow distance when fully split.
   *
   * Sized so a 1.7-unit character fills a useful part of its pane. It was 15
   * — nearly nine character-heights — and combined with the shared camera's
   * 48-unit clamp the monsters were ten pixels tall and unrecognisable.
   */
  followDistance: 7,
  /** Shared-cam framing clamps. */
  sharedMinDistance: 6.5,
  sharedMaxDistance: 22,
  /** Extra world-units of breathing room around the players when framing both. */
  framingPadding: 2.2,
  focusHeight: 1.1,
  /** Positional smoothing (higher = snappier). */
  smoothing: 6.5,
};

export const SPLIT = {
  /** Below this separation: one shared camera. */
  mergeDistance: 7,
  /** Above this separation: fully split screen. */
  splitDistance: 14,
  /** How fast the split amount itself eases (higher = snappier). */
  easeSpeed: 3.0,
  /** Soft leash. Past this the HUD nags; it never teleports anyone. */
  maxDistance: 34,
  /** 'horizontal' = P1 top / P2 bottom. 'vertical' = P1 left / P2 right. */
  orientation: 'horizontal' as 'horizontal' | 'vertical',
  /**
   * Mennyi ideig kell két külön szobában állni ahhoz, hogy szétváljon a kép.
   *
   * Szobánkénti kamerával a szétválás nem (csak) távolság kérdése: ha a pár
   * két külön szobában van, egy közös kép mindkét szobát megmutatná, és épp az
   * a tiltott. Csakhogy az ajtóban álló játékos cellánként váltogatja a szobát,
   * és késleltetés nélkül ez másodpercenként többször ki-be csúsztatná a fél
   * képernyőt. 0,4 másodperc hosszabb, mint bármelyik átlépés, és rövidebb,
   * mint amennyit egy szándékos szétválásra várni kellemetlen.
   */
  roomSplitDwell: 0.4,
};

export const PALETTE = {
  p1: 0xff7a29, // Halloween orange
  p2: 0x9d5cff, // Halloween purple
  ground: 0x1b1430,
  grid: 0x2f2350,
  obstacle: 0x2a2145,
  fog: 0x0b0716,
};

/**
 * Slice 1 — the house. Players are tiny monsters; everything here is built at
 * roughly 5× human scale, which is what sells the size gag (spec §14).
 */
export const HOUSE = {
  /**
   * How many sweets you have to lift before the front door counts as a way
   * out.
   *
   * Without this the house had no job in it: the exit is the door you came in
   * through, so both players were standing in the exit zone the moment they
   * spawned and the section ended before it began. A quota is what turns a
   * room into an errand.
   */
  candyQuota: 3,
  /** Seconds of standing still required to lift a candy bowl. */
  grabTime: 2.6,
  /** Both players must be inside the door zone at once to shove it open (§12, §33). */
  exitHoldTime: 1.2,
  /** Candy dropped when the homeowner catches you. */
  candyLostOnCatch: 3,
  catchRadius: 2.1,
  stunTime: 1.4,
};

export const HOMEOWNER = {
  /** Roughly four times a player: an adult, to a monster the size of a cat. */
  height: 6.4,
  /**
   * Mennyi helyet foglal vízszintesen.
   *
   * Az ütközéshez kell, és eddig nem létezett — mert a lakónak nem volt
   * ütközése. A törzse a magasság durván harmada; ennyi hely kell neki, hogy
   * elférjen egy ajtóban anélkül, hogy beszorulna.
   */
  width: 2.2,
  walkSpeed: 4.4,
  chaseSpeed: 7.6, // slower than a sprinting player: you can always outrun him
  turnSpeed: 2.6,

  /** Flashlight cone. */
  viewRange: 23,
  viewHalfAngle: Math.PI * 0.16,
  /** He notices anything this close regardless of facing. */
  peripheralRadius: 6,

  /** Suspicion fills at this rate when a player is lit, drains this fast otherwise. */
  suspicionRise: 2.0,
  suspicionFall: 0.32,

  idleTime: 1.6,
  investigateTime: 3.2,
  /** Ceiling on how far he will chase a noise across the house. */
  maxInvestigateTime: 13,
  searchTime: 4.5,
  alertTime: 0.7,
  loseSightTime: 2.2,
};

/**
 * A kutya — a harmadik ház második fogója.
 *
 * Szándékosan NEM a lakó kicsiben. A lakó a SZEMÉVEL vadászik: van lámpakúpja,
 * kikerülhető, és látod, merre néz. A kutya a FÜLÉVEL: nincs kúpja, a falon
 * át is meghallod, viszont csak azt hallja meg, AMIT CSINÁLSZ. Ettől a két
 * fogó ellentétes játékot kíván ugyanabban a szobában — a lakó elől bújni
 * kell, a kutya elől megállni.
 *
 * És nem is ő kap el igazán: ha odaér a zajhoz és nem talál ott senkit,
 * UGAT — az pedig maga is zaj, a lakónak. A kutya nem fogó, hanem riasztó.
 */
export const DOG = {
  /**
   * Marmagasság: PONTOSAN A LAKÓ FELE.
   *
   * Nem beírt szám, hanem a lakóból származtatva — ez a kettő áll egymás
   * mellett ugyanabban a szobában, és ha külön számokból jönne a méretük,
   * előbb-utóbb szétcsúsznának. (Az utcai cukorkánál pontosan ez történt: a
   * szörnyecskéhez képest hordó méretű lett.)
   *
   * Korábban 2,6 volt, ami a lakó 41%-a — egy nagy kutya, de nem az a
   * „feleakkora, mint egy ember" arány, ami olvasható.
   */
  height: HOMEOWNER.height * 0.5,
  /**
   * Vízszintes helyigény.
   *
   * A magasságából számol, nem a lakóéból: egy négylábú a saját
   * marmagasságához képest ZÖMÖKEBB, mint egy ember. A lakónál ez az arány
   * 0,34, itt 0,58.
   */
  width: HOMEOWNER.height * 0.5 * 0.58,

  /** Gyorsabb a lakónál — de csak rövid ideig bírja, lásd huntTime. */
  chaseSpeed: 9.8,
  walkSpeed: 3.6,
  turnSpeed: 4.2,

  /**
   * Mennyivel hallja jobban a zajt, mint egy ember.
   *
   * A NoiseSystem minden zajnak sugarat ad; a kutya ezt szorozza. 2,4-szeres:
   * a futás (13 egység) neki 31, vagyis szobányival messzebbről. Ezért a
   * lopakodás ebben a házban nem opció, hanem az egyetlen út.
   */
  hearing: 2.4,

  /** Ennél közelebb harap. Kisebb a lakóénál: kerülgetni lehet. */
  biteRadius: 3.4,

  /** Meddig hajt egy zaj után, mielőtt feladja. */
  huntTime: 6.5,
  /** Szaglászás a zaj helyén, mielőtt hazaindul. */
  sniffTime: 2.6,
  /** Felriadás a kennelben: ennyi ideig áll és fülel, mielőtt elindul. */
  alertTime: 0.55,
  /** Mennyit szunyókál a kennelben, mielőtt körbejárja a házat. */
  napTime: 6,

  /**
   * Milyen gyakran KAPJA EL A SZAGODAT.
   *
   * A kutya eddig kizárólag hallott, a séta viszont néma — egy óvatos
   * játékos mellett soha nem indult el keresni. Ez nem „jól lopakodtál",
   * hanem hiányzó viselkedés: egy kutya SZAGOL.
   *
   * Amit a szaglás ad, és amit a hallás nem: a kutya megtudja, hol VOLTÁL,
   * nem azt, hol vagy. A nyom néhány másodperces késéssel jár utánad, tehát
   * a mozgás így is véd — csak a mozdulatlanság már nem.
   */
  scentEvery: 16,
  /** Hány másodperces késéssel. Ennyivel korábbi helyedre indul el. */
  scentAge: 4,

  /**
   * Az ugatás zajsugara.
   *
   * Nagyobb a csínyénél (70), mert ez a kutya egyetlen igazi fegyvere: a
   * lakót hívja oda. Egy kutya, ami magában kerget, csak egy lassabb lakó
   * lenne; egy kutya, ami kiabál, új helyzet.
   */
  barkRadius: 95,
  /** Két ugatás közt ennyi. Különben egy zajos szoba végtelen riasztó. */
  barkCooldown: 7,
};

/**
 * A nitró.
 *
 * Egy tartály, ami magától töltődik vissza — nem korlátlan, de nem is
 * egyszer használatos. Az az érdekes benne, hogy ÁLLÓ HELYZETBŐL a
 * legerősebb: a `launchBonus` a sebességgel elfogy, tehát a nitró jutalma az
 * indulás, nem a már amúgy is gyors autó még gyorsabbá tétele. Ezért emeli
 * meg az orrát is — a kerékre állás ugyanannak a pillanatnak a képe.
 */
export const NITRO = {
  /** Meddig tart egy teli tartály, másodpercben. */
  duration: 2.4,
  /** Mennyi idő alatt töltődik vissza teljesen. */
  refill: 9,
  /**
   * Ennyi kell a tartályban ahhoz, hogy EL LEHESSEN indítani.
   *
   * Enélkül a nitró nullán villog: kiürül, a nyomva tartott gomb alatt
   * visszatöltődik egy képkockányi, és azonnal újra elsül. Az eredmény nem
   * gomb, hanem rángás. Elindulni negyedtartálytól lehet — utána viszont megy,
   * amíg van benne.
   */
  minStart: 0.25,
  /** Ennyivel megy a végsebesség FÖLÉ, amíg szól. */
  overspeed: 1.28,
  /** A gyorsítás szorzója. */
  push: 2.6,
  /**
   * Az indulási ráadás: álló helyzetben ennyiszeres, a végsebességnél nulla.
   * Ettől lesz a nitró indulógomb, nem pedig „mindig nyomd" gomb.
   */
  launchBonus: 2.2,
  /** Mennyire emelkedik meg az orr, radiánban, a legerősebb pillanatban. */
  wheelie: 0.34,
};

/**
 * A város haragja: mennyit tölt egy-egy vétség.
 *
 * A számok mind ugyanabban a mértékben vannak (0 = nyugodt, 1 = dühös), és
 * az APADÁSHOZ képest olvasandók: egy elütött szörnyecske nagyjából fél perc
 * tiszta vezetés alatt felejtődik el. Ez az arány a lényeg, nem az egyes
 * számok — ettől lesz a mérő ügyesség és nem visszaszámláló.
 */
export const ANGER = {
  /** Egy elütött szörnyecske. A legsúlyosabb: ez személyes. */
  critterHit: 0.22,
  /** Piroson áthajtás. Szándékos szabályszegés, majdnem annyi. */
  redLight: 0.18,
  /** Járdán haladva, másodpercenként. Ott laknak, ott sétálnak. */
  pavement: 0.1,
  /** Duda: kicsi, de AZONNALI — ezért lehet szándékosan bőszíteni vele. */
  horn: 0.03,
  /** Nitró, másodpercenként. A leghangosabb dolog a városban. */
  nitro: 0.08,
  /** Gyorshajtás a végsebesség ekkora hányada FÖLÖTT számít. */
  speedLimit: 0.6,
  /**
   * Teljes gázon, másodpercenként.
   *
   * Négy század volt, és a mérés megmutatta, hogy az sok: öt másodperc
   * padlógáz húsz százalék, vagyis huszonöt másodperc alatt kimaxolná a
   * mérőt — a városon átérni tizenkilenc. Ezzel a 120 km/h-t vettük volna
   * vissza, pont azt, amit kértél. Egy század: egy perc végigtolt padlógáz
   * hatvan százalék, egy rövid száguldás öt.
   */
  speeding: 0.01,
  /** Apadás másodpercenként, amíg épp nem rontod. */
  calm: 0.0073,

  /** Ennyien jönnek egy tiszta estén is. A tartalom sosem marad el. */
  packMin: 5,
  /** És ennyien egy csúnyán. */
  packMax: 40,
};

export const NOISE = {
  /** Radius of the noise a sprinting player leaves behind them. */
  sprintRadius: 13,
  landRadius: 17,
  /** A prank is meant to be heard from across the room. */
  prankRadius: 70,
  eventLifetime: 0.35,
};

/**
 * Slice 2 — the drive. Arcade, not simulation: the car should feel like a
 * shopping trolley with opinions (spec §8).
 */
/**
 * Scaled to the authored town, whose streets are 8 m of asphalt in a 12 m tile.
 * The greybox had 28 m roads and a 9 m car; at real town scale the same numbers
 * made the jeep a bus doing 190 km/h down a residential street.
 */
export const CAR = {
  length: 4.3,
  width: 1.95,
  /**
   * Végsebesség: 33,4 m/s = 120 km/h.
   *
   * Korábban 19 m/s (68 km/h) volt, és ez a falu régi, szűk utcáihoz volt
   * hangolva. Az épített térképen 11 méteres úttest és 5,5 méteres
   * sáv-félszélesség van — ott a hatvannyolc kilométer lassúnak érződik.
   *
   * A szám nem áll egyedül: a szörnyecskék kiugrása és a duda hatótávja a
   * FÉKÚTBÓL van levezetve, tehát mindkettő együtt mozdul vele. Lásd
   * STREET.critterDashRange.
   */
  maxSpeed: 33.4,
  reverseSpeed: 5.5,
  accel: 19,
  brake: 34,
  drag: 0.55,
  /** Steering is scaled down at speed so the car cannot pivot on the spot. */
  steerRate: 2.1,
  steerAtSpeed: 0.45,
  gripLoss: 0.12,

  // --- Tapadás és drift ----------------------------------------------------
  //
  // Eddig a kocsinak NEM VOLT oldalirányú sebessége: egyetlen `speed` haladt
  // a `heading` irányába, tehát a kormányzás azonnal átfordította a teljes
  // lendületet. Ezért nem lehetett driftelni — nem hiányzott a gomb, hiányzott
  // a tehetetlenség.
  //
  // Most a sebesség vektor. A kormányzás a KAROSSZÉRIÁT fordítja el, a
  // lendület a régi irányba tart tovább, és a különbség az oldalcsúszás. A
  // tapadás ezt szívja el: nagy érték = a kocsi azonnal arra megy, amerre
  // néz (a régi viselkedés), kicsi = sokáig csúszik.
  /** Ennyied része tűnik el az oldalcsúszásnak másodpercenként, normál tapadással. */
  grip: 7.5,
  /** Ugyanaz behúzott kézifékkel. A hátsó kerék megcsúszik, a farok kijön. */
  driftGrip: 1.9,
  /** A kézifék hosszirányban is fog — de sokkal kevésbé, mint a fék. */
  handbrakeDrag: 1.0,
  /**
   * Kézifékkel a kormány TÖBBET fordít.
   *
   * Nem "csalás": egy megcsúszott hátsó tengelynek tényleg nagyobb a
   * fordulékonysága. Enélkül a kézifék csak lassított volna, és a drift
   * beindításához előbb neki kellett volna menni valaminek.
   */
  handbrakeSteer: 1.3,
  // Az első hangolásom 1,75 volt, 1,15-ös drift-tapadással és 1,6-os
  // hosszirányú fékezéssel. Lemérve: teljes kormánnyal másfél másodperc alatt
  // 271 fokot fordult, és ugyanannyi idő alatt 14,9 métert tett meg a normál
  // kanyar 35,9-e helyett. Az nem drift, hanem pörgés — és a játékos nem
  // trükknek érezte volna, hanem annak, hogy elvesztette az autót.
  /** Efölött az oldalcsúszás fölött számít driftnek — a HUD és a pont ebből él. */
  driftThreshold: 3.2,

  // --- Ugrás ---------------------------------------------------------------
  /** Kezdősebesség felfelé. 7,4 m/s ≈ 1,4 m magas ugrás. */
  jumpSpeed: 7.4,
  gravity: 21,
  /**
   * Levegőben mennyit ér a kormány.
   *
   * Nem nulla, mert egy ugrás, ami közben irányíthatatlan, nem trükk, hanem
   * büntetés — és nem is egy, mert akkor az ugrás egy lebegő kanyar lenne,
   * amivel minden sarkot le lehetne vágni.
   */
  airSteer: 0.45,
  /** Földetérés után ennyi ideig nem lehet újra ugrani. */
  jumpCooldown: 0.25,
  /** Ennyivel a talaj fölött már nem ér a kerék. */
  groundEpsilon: 0.02,
  /**
   * Head-on bounce. Was 0.45, which sent the car backwards at half its impact
   * speed and left the player facing a direction they never chose. A crash
   * should stop you and jolt you, not undo your last two seconds.
   */
  crashBounce: 0.22,
  /** Hard ceiling on the rebound, so a 19 m/s wall is not a catapult. */
  crashBounceMax: 3.0,
  /** Below this impact speed a head-on hit simply stops the car. */
  impactMinSpeed: 3.0,
  /**
   * Collision shape: three circles along the car's spine instead of one
   * circumscribed square. The square was 3.6 m on a side for a 1.95 m wide
   * car, so it clipped kerbs and critters the player visually missed by a
   * metre, and was simultaneously too SHORT at the nose when travelling
   * diagonally.
   */
  bodyRadius: 1.02,
  /** Local-z offset of the front and rear circles. */
  spineSpread: 1.32,
  /**
   * cos of the angle between travel and the contact normal above which a
   * contact counts as an impact rather than a scrape. 0.55 ≈ 57° — hitting a
   * wall at a shallower angle slides along it.
   */
  impactCos: 0.55,
  /** Speed kept per frame while scraping along a wall. */
  scrapeFriction: 0.965,
  /** How strongly a scrape steers the car along the wall (0 = not at all). */
  scrapeSteer: 0.45,
  /** Max heading change a single scrape frame may apply, radians. */
  scrapeSteerMax: 0.09,
  /** Extra drag while off the tarmac — gardens and pavements are slow. */
  /**
   * How long the car must be off the road before it counts as off the road.
   * 0.12 s is under three metres at full speed — long enough to swallow a
   * pinhole in a measured road surface, far too short to let anyone cut a
   * corner across a garden for free.
   */
  offRoadDwell: 0.12,
  offRoadDrag: 1.9,
  /** Speed ceiling off the tarmac. You can mount the kerb; you cannot cruise. */
  offRoadMaxSpeed: 9.5,
  /**
   * Collider filtering (see Car.prepare). The town hands us one AABB per mesh
   * part, so a tree's box is its whole canopy and the car hits an invisible
   * wall metres from the trunk.
   */
  /** Props shorter than this are driven over rather than into. */
  propMaxHeight: 1.45,
  /** ...as long as their footprint is no wider than this. */
  propMaxFootprint: 2.2,
  /** Tall, small, roughly square footprints are treated as trunks/poles. */
  canopyMaxFootprint: 6.0,
  canopyMinHeight: 2.4,
  /** Half-extent the trunk of such a thing is shrunk to. */
  trunkHalfExtent: 0.55,
  /** Flipped to -1 by the invert-steering setting. */
  steerInvert: 1,
  /**
   * How far the car creeps out of geometry it is embedded in, per step.
   * Small enough never to read as a teleport, large enough to clear a house
   * in about a second rather than never.
   */
  unstickStep: 0.16,
};

export const STREET = {
  /**
   * How slow counts as parked. Arriving is not the same as stopping, and only
   * stopping should open a door.
   */
  parkSpeed: 1.6,
  /**
   * Hány szörnyecske van egyszerre az utcákon.
   *
   * Tizenhat volt, és az a RÉGI, 233 egységes városhoz tartozott. A város
   * azóta 540 egység — a területe ÖTSZÖRÖSÉRE nőtt —, tehát ugyanaz a
   * tizenhat egy ötödannyira sűrű forgalom: egész utcákon nem találkoztál
   * senkivel.
   *
   * Az azonos sűrűség 86-ot kívánna. Negyvennyolc: érezhetően élő utcák,
   * de nem hangyaboly — és a városnak vannak csendesebb sarkai is, ami jó,
   * mert akkor a forgalmas részek jelentenek valamit.
   */
  critterCount: 48,
  /**
   * Hány NPC autó jár a városban.
   *
   * Tizenkettő: elég ahhoz, hogy minden nagyobb kereszteződésnél lásd őket
   * és néha sorban álljanak, kevés ahhoz, hogy dugó legyen. Egy üres város
   * pálya; egy tele város akadálypálya — a kettő között van a város.
   */
  npcCarCount: 12,
  /**
   * A SZTRÁDA forgalma: hány autó jár a körpályán, és milyen gyorsan.
   *
   * 200 km/h = 55,6 egység/mp (a kijelző 3,6-del szoroz). A lassabbak 130-cal
   * mennek: a különbség az, amitől a gyors autó ESEMÉNY, amikor elhúz
   * melletted. Ha mind egyformán menne, egyik sem volna gyors.
   */
  motorwayCount: 9,
  motorwayFast: 55.6,
  motorwaySlow: 36,
  critterSpeed: 1.9,
  /**
   * Ennyire kell megközelíteni, hogy a várakozó szörnyecske kiugorjon.
   *
   * A szám a FÉKÚTBÓL jön, nem ízlésből, és a végsebességgel EGYÜTT mozdul.
   *
   * Lemérve: 120 km/h-ról (33,4 m/s) a fékút 11,5 méter. Ehhez jön a
   * reakcióidő — harmadmásodperc ezen a sebességen tíz méter. Huszonnyolc
   * méter tehát az a távolság, ahonnan még ki lehet kerülni, de csak ha
   * azonnal lépsz. Kevesebbnél az ütközés elkerülhetetlen lenne, ami nem
   * kihívás, hanem igazságtalanság; többnél van idő kényelmesen lefékezni, és
   * nem történik semmi.
   *
   * (Hatvannyolc km/h-s végsebességnél ez a szám 18 volt. Ha a sebesség
   * változik, ez sem maradhat.)
   */
  critterDashRange: 28,
  /**
   * Ennél messzebb a szörnyecske nem RAJZOLÓDIK ki.
   *
   * Mérve: a városban negyvennyolc szörnyecske él, egyenként húszezer
   * háromszög — ez egymillió a képkockánkénti kétmillióból, tehát a FELE a
   * terhelésnek. A hozzájuk tartozó medián távolság viszont 245 egység: a
   * felük olyan messze van, hogy egy-két képpontot ha elfoglalna. Kiszámolni
   * mindet, hogy aztán ne látszódjon, pont az, amitől akadozik.
   *
   * Százhúsz egység a látótávolság széle: a köd ott már úgyis elnyeli őket,
   * tehát az eltűnésük nem látszik. Mozogni közben MOZOGNAK — csak nem
   * rajzoljuk ki őket, tehát amikor odaérsz, ott vannak, ahol lenniük kell.
   */
  critterDrawRange: 120,
  /** Meddig tart a kiugrás, mielőtt visszaáll ácsorogni. */
  critterDashTime: 1.6,
  /** A kiugrás sebessége. Háromszorosa a sétálásnak: ettől ijesztő. */
  critterDashSpeed: 6.2,
  /**
   * Meddig hallatszik a duda a szörnyecskéknek.
   *
   * Nagyobb, mint a kiugrás távolsága, mert a dudának MEGELŐZŐNEK kell
   * lennie: ha ugyanonnan hatna, ahonnan kiugranak, már késő lenne. De nem
   * sokkal — egy egész utcát szétugrasztó kürt elvenné a szakasz egyetlen
   * valódi döntését.
   */
  hornRange: 38,
  /** Radius the navigator's radar pulse reveals. */
  radarRange: 70,
  radarTime: 3.4,
  /** How long a navigator ping stays on the driver's screen. */
  pingTime: 2.6,
  arriveRadius: 7,
  /** Body half-width of a critter, for the hit test against the car's spine. */
  critterRadius: 0.42,
  /** Gap from the car's flank that still counts as "that was close". */
  nearMissGap: 1.5,
  /** Clearance at which a critter is forgiven and can be near-missed again. */
  nearMissReset: 4.5,
};

export const SCORE = {
  critterHit: -25,
  /**
   * Hány cukorka borul ki egy elütött szörnyecskénél.
   *
   * A pontlevonás a képernyő sarkában absztrakt; a cukorka az, amiért az
   * egész este megy. Három: érezhető, de egy rossz kanyar nem üríti ki a
   * zsákot — a ház átlagosan sokkal többet ad.
   */
  candyPerCritter: 3,
  critterNearMiss: 8,
  /** A head-on crash. Scrapes are free: they are already their own punishment. */
  crash: -6,
  arrive: 120,
};

/**
 * A PUSKA.
 *
 * Nyálkapuska: felpumpálod, célzol, lősz. Nem sebez, hanem BÉNÍT és
 * cukorkát ejtet — nem finomkodásból, hanem mert a kiütött játékos ül és vár,
 * és egy kétfős estén ez a legrosszabb, ami vele történhet. Így a lövés
 * ugyanaz, mint a lopás, csak távolról.
 *
 * A számok mind egy kérdésre felelnek: mennyibe kerül egy lövés? Ideje van
 * (újratöltés), zaja van (a lakó odajön), és el is fogy. Egy fegyver, aminek
 * nincs ára, nem fegyver, hanem gomb.
 */
export const WEAPON = {
  /** Meddig visz a lövés. A ház legnagyobb szobája 22 egység átlós. */
  range: 26,
  /** Mekkora sugárban talál. Nem tű, hanem nyálkacsóva. */
  radius: 1.15,
  /** Két lövés között. */
  cooldown: 0.55,
  /** Ennyi lövés fér a tárba. */
  magazine: 6,
  /** Újratöltés ideje — ez a fegyver igazi ára. */
  reload: 2.2,
  /** Eltalálva ennyi ideig nem tudsz mozogni. */
  stun: 1.2,
  /** ...és ennyi cukorkát ejtesz el. */
  drop: 1,
  /** A lövés zaja: a lakó ide jön. Hangosabb a futásnál, halkabb a csínynél. */
  noiseRadius: 34,
  /** Lőszercsomag: ennyi lövést ad egy felszedett doboz. */
  pack: 6,
} as const;

/**
 * CUKORKA-RABLÁS — a kétfős PvP szabályai a házban.
 *
 * A cukorka felszedve még NEM a tiéd: a KEZEDBEN van. Be kell vinni a saját
 * sarkodba (piros vagy kék), és letenni. Aki lő rád, ellök, és minden, ami a
 * kezedben van, a földre esik — ott bárki felszedheti.
 *
 * Ettől lesz döntés a játékból: viszed-e még egyet, vagy beadod, amid van.
 * Egy cukorka, ami felvétel pillanatában pontot ér, nem kockázat — csak
 * sietés.
 */
export const CAPTURE = {
  /** Ennyi cukorka fér a kézbe. Ez a kapzsiság felső határa. */
  carry: 3,
  /** Ilyen közel kell menni a saját sarokhoz, hogy letedd. */
  bankRadius: 2.4,
  /** Az ellökés ereje: ennyivel repülsz a lövés irányába. */
  knockback: 11,
  /** Ennyi ideig nem irányítod magad, amíg repülsz. */
  knockTime: 0.55,
  /** Az elejtett cukorkák ekkora körben szóródnak szét. */
  spread: 1.3,
  /** Ennyi ideig nem szedheti fel ugyanaz, aki elejtette — különben azonnal visszakapja. */
  graceOwn: 1.1,
  /**
   * Ennyi ideig hever a földön egy elejtett cukorka, aztán ELTŰNIK.
   *
   * Enélkül a kiszórt cukorka örökre ott maradt, és a padló egy idő után egy
   * biztonságos raktár lett: senkinek nem kellett sietnie érte. Nyolc
   * másodperc annyi, hogy a közelebbi fél oda tudjon érni, de futni kell.
   */
  looseLife: 8,
  /** Ennyi cukorka kell a kör megnyeréséhez. */
  win: 5,
} as const;

/**
 * BELSŐ NÉZET a házban.
 *
 * Miért pont a házban: a ház a lopakodás és a keresés helye, és mindkettő
 * ARRÓL szól, hogy mit LÁTSZ. Felülről nézve a fáklyakúp egy rajz a padlón,
 * a vaksötét második ház pedig csak egy sötét alaprajz. Szemből nézve
 * ugyanaz a két dolog a játék tárgya lesz. A puska célzása is innen nyeri
 * az értelmét: ahová nézel, oda lősz.
 */
export const FIRST_PERSON = {
  /** Szemmagasság a láb síkjától. A szörny 1,7 magas. */
  eye: 1.52,
  /** Meddig lehet fel- és lenézni, radiánban. */
  pitchMax: 1.15,
  pitchMin: -1.05,
  /** Belső nézetben szűkebb a lencse: a halszem szédít. */
  fov: 72,
  /** Hány egységgel előre kerül a kamera, hogy a saját test ne lógjon bele. */
  forward: 0.12,
  /**
   * A KÖZELI VÁGÓSÍK belső nézetben.
   *
   * A közös kameráé 0,6 — a szobát keretező külső nézetben ez helyes, mert
   * semmi nem kerül ilyen közel. A kézben tartott fegyver viszont IGEN, és
   * a vágósík mögé kerülve nem eltűnik, hanem BELÜLRŐL tölti ki a képet:
   * egy kék-lila massza a fél képernyőn. Ez volt a „pislákoló fegyver".
   */
  near: 0.05,
  /** A fordulás simítása. Nulla nem kell: a nyers bemenet remeg. */
  smoothing: 22,
} as const;

/**
 * A HÁROM FEGYVER.
 *
 * Kő-papír-olló: mindegyik más TÁVOLSÁGON úr, és mindegyiknek más az ára.
 * A számok egymáshoz képest vannak beállítva, nem külön-külön — ezért
 * élnek egy táblában, nem három helyen.
 *
 *   sörétes      a sarkok fegyvere      · oda kell menni
 *   mesterlövész a folyosóké            · állva kell maradni
 *   rakétavető   a zárt tereké          · magadra hívja a lakót
 */
export const GUNS = {
  shotgun: {
    name: 'SÖRÉTES',
    model: 'models/shotgun.json',
    /**
     * Egy SZOBÁN belül úr. A legnagyobb szoba kb. 29 egység széles (mérve a
     * navigációs rácsból), tehát 16 egység a fél szoba: innen még eléri az
     * ajtóban állót, a folyosó túlvégén állót viszont már nem.
     */
    range: 16,
    /** Eddig TELJES a hatás; azon túl gyengül a nullára. Ez a „közelharc". */
    full: 7,
    pellets: 6,
    spread: 0.31,
    radius: 0.9,
    magazine: 2,
    cooldown: 0.9,
    reload: 2.6,
    knockback: 16,
    stun: 1.0,
    dropsAll: true,
    noiseRadius: 44,
    needsStillness: 0,
    scopeFov: 0,
  },
  sniper: {
    name: 'MESTERLÖVÉSZ',
    model: 'models/sniper.json',
    /**
     * ÁTLŐ A LAKÁSON. A lakás átlója mérve 96 egység — a mesterlövész
     * hatótávja ennél épp egy hajszállal kevesebb, tehát a leghosszabb
     * rálátást is kihasználja, de a falon túlra ő sem lát.
     */
    range: 90,
    full: 90,
    pellets: 1,
    spread: 0,
    radius: 0.35,
    magazine: 1,
    cooldown: 1.5,
    reload: 3.2,
    knockback: 0,
    stun: 2.0,
    dropsAll: false,
    noiseRadius: 52,
    needsStillness: 0.35,
    /** TÁVCSŐ: ennyire szűkül a látószög. A 72 fokos alapból 26 — ez ~2,8× nagyítás. */
    scopeFov: 26,
  },
  rocket: {
    name: 'RAKÉTAVETŐ',
    model: 'models/rocket.json',
    /**
     * EGY SZOBÁNYI táv. A legnagyobb szoba átlója kb. 41 egység: a rakéta
     * ezen belül bárhová elér, de a lakáson nem lő át — különben egyetlen
     * helyben állva le lehetne uralni az egész pályát.
     */
    range: 38,
    full: 38,
    pellets: 1,
    spread: 0,
    /** A ROBBANÁS sugara: ez talál, nem a lövedék. */
    radius: 5,
    magazine: 1,
    cooldown: 1.95,
    reload: 4.0,
    knockback: 20,
    stun: 1.4,
    dropsAll: true,
    noiseRadius: 90,
    needsStillness: 0,
    scopeFov: 0,
    selfRadius: 5,
  },
} as const;

export type GunId = keyof typeof GUNS;

/**
 * FEGYVEREK A PÁLYÁN.
 *
 * Nem a menüben választasz fegyvert, hanem a pályán találod — és ettől lesz
 * a fegyver HELY is, nem csak tárgy: a rakétavetőért el kell menni oda, ahol
 * kint van, és közben nem viszed a cukorkát a sarkodba.
 *
 * Megjelenik és el is tűnik. A tűnés nem szeszély: egy örökké ott heverő
 * fegyver egy idő után csak egy gomb a pályán, egy elfogyó viszont döntés —
 * most mész érte, vagy lemondasz róla.
 */
export const PICKUP = {
  /** Ennyi fegyver hever kint egyszerre. */
  live: 4,
  /** Ennyi ideig marad kint egy darab, mielőtt eltűnik. */
  life: 26,
  /** Eltűnés után ennyi idő múlva bukkan fel máshol (alsó és felső határ). */
  respawnMin: 4,
  respawnMax: 9,
  /** Ilyen közelről lehet felvenni. */
  reach: 1.6,
  /**
   * Melyik fegyverből mennyi LŐSZER jár egy felvételkor.
   *
   * Nem egyforma, és ez tartja egyensúlyban a hármast: a rakétavetőből egy
   * lövés jár, a sörétesből négy. A leghangosabb fegyver egyben a
   * legritkább is.
   */
  packs: { shotgun: 4, sniper: 3, rocket: 1 },
  /**
   * Milyen gyakran bukkan fel az egyik vagy a másik. A rakétavető a
   * legritkább — különben a ház fél perc alatt kráter lenne.
   */
  weights: { shotgun: 4, sniper: 3, rocket: 1 },
  /**
   * Csere után ennyi ideig nem veheted vissza a SAJÁT leejtett fegyveredet.
   *
   * Mérve derült ki, miért kell: a régi fegyver a lábad elé esik, tehát a
   * következő pillanatban ráállsz, és visszaveszed — a csere oda-vissza
   * pattogott, és sosem maradt nálad az új. (Ugyanaz a hiba, amit a
   * cukorkánál a `CAPTURE.graceOwn` old meg.)
   */
  graceOwn: 2.2,
  /** Ilyen messzire esik a lecserélt fegyver, hogy ne a lábadnál heverjen. */
  dropAway: 2.2,
  /** Ennyinél több tartalék nem fér el egy fegyverhez. */
  maxReserve: { shotgun: 12, sniper: 6, rocket: 3 },
} as const;

/**
 * AZ AI ELLENFÉL.
 *
 * Egyedül játszva is van kivel versenyezni. Nem „nehézségi szint", hanem egy
 * MÁSIK TOLVAJ: ugyanazt akarja, amit te, ugyanazokkal a szabályokkal — a
 * lakó őt is kergeti, a fegyver neki is elfogy, és a cukorkát neki is be kell
 * vinnie a saját sarkába.
 *
 * Ez a legfontosabb döntés benne: NEM CSAL. Ugyanaz a sebessége, ugyanannyi
 * fér a kezébe. Amiben más, az a REAKCIÓIDEJE és a bátorsága — ezt lehet
 * hangolni anélkül, hogy a játékos igazságtalannak érezné.
 */
export const RIVAL = {
  /** Ennyi idő alatt veszi észre, hogy megjelent valami. Emberi tempó. */
  reaction: 0.45,
  /** Ennyi cukorkával a kézben már hazaindul, nem gyűjt tovább. */
  greed: 2,
  /** Ilyen közelről lő rád, ha van fegyvere. */
  shootFrom: 14,
  /** Két lövés között ennyit vár — nem gépfegyver. */
  shootEvery: 1.4,
  /** Ennél közelebb NEM megy a lakóhoz: ő is fél. */
  fearRadius: 9,
  /** Mennyire pontos: ennyi egységgel mellé célozhat. */
  aimError: 0.8,
  /**
   * Milyen gyorsan vezet, a kocsi végsebességéhez képest.
   *
   * 0,9 — nem a maximum, és ez szándékos: az AI-nak megnyerhetőnek kell
   * lennie. Egy tökéletes sofőr ellen nem verseny van, hanem bemutató. A
   * fizikája viszont UGYANAZ, tehát a kanyarban ugyanúgy megcsúszik, és egy
   * jól vett ív nálad többet ér, mint nála.
   */
  driveSkill: 0.9,
} as const;

/**
 * A SZÁLLÍTÁS.
 *
 * A házban a sarokba vitt cukorka még nem pont: haza is kell vinni. A bázis
 * MINDENKINEK UGYANAZ a hely a városban — ettől lesz a hazaút is verseny,
 * nem külön magánügy.
 */
export const DELIVERY = {
  /** Ennyi cukorkát kell a sarokba vinni, hogy a ház teljesítve legyen. */
  quota: 5,
  /**
   * Ennyi idő múlva telik meg újra egy kiürített tál — CSAK fogó módban.
   *
   * Mérve derült ki, hogy kell: a házban három tál van, a kvóta viszont öt.
   * Az utolsó tál után nem volt honnan cukorkát szerezni, és a kör
   * megnyerhetetlenné vált — nem nehéz lett, hanem lehetetlen.
   *
   * Kooperatívban NEM töltődik újra: ott a kvóta maga a felemelt tálak
   * száma, és egy újratelő tál visszazárná a már kinyílt ajtót.
   */
  bowlRefill: 14,
  /** Az újraéledés ára: ennyi ideig nem mozdulsz, miután visszakerültél. */
  respawnStun: 1.1,
  /**
   * ÉJJELLÁTÓ a vaksötét házban.
   *
   * A második ház azon a szabályon áll, hogy a látás maga az erőforrás. Az
   * éjjellátó ezt nem törli el, hanem IDŐRE ADJA VISSZA: húsz másodpercig
   * látsz, aztán megint a fáklyád van. Ettől lesz a keresése is döntés —
   * érte mész, vagy cukorkáért.
   */
  nightVision: 20,
  nightVisionRespawn: 25,
  /** A bázis sugara: ezen belül lehet lerakni. */
  radius: 9,
  /** A lerakás ideje. Nem azonnali: a hazaérkezés is pillanat legyen, ne érintés. */
  dropTime: 1.4,
} as const;

/**
 * KÍSÉRTETHÁZ: a harmadik játékmód.
 *
 * Az első kettő versengés — ez EGYÜTTMŰKÖDÉS, és ez a különbség nem a
 * szabályok díszítése, hanem a lényege. A másik két mód ugyanazt kéri:
 * gyorsaságot és célzást. Ez mást kér — figyelmet, csendet, és azt, hogy
 * számíthass valakire.
 *
 * Három szabály tartja össze, és mind a három EGYMÁSRA UTAL titeket:
 *
 *   EGY LÁMPA KETTŐTÖKNEK. Aki a fényt viszi, nem tud cipelni; aki cipel,
 *   nem lát. Enélkül ez két egyszemélyes játék volna egy szobában.
 *
 *   A ZAJOD HÍVJA ŐKET. Nem véletlenszerűen ugranak elő — ha futottál,
 *   ajtót csaptál, felborítottál valamit, azt meghallják. Így a félelem a
 *   SAJÁT döntéseidből jön, és nem lehet megunni, ahogy egy időzített
 *   ijesztgetést meg lehet.
 *
 *   MEG LEHET HALNI. Elkapnak: összecsuklasz, és a társadnak van ideje
 *   felszedni téged. Ha nem ér oda, vagy őt is elkapják, a körnek vége — és
 *   a cukorka is oda, amit addig gyűjtöttetek. Ettől számít.
 */
export const HAUNT = {
  /** Hány szörny járja a házat. */
  monsters: 3,
  /**
   * A lámpa TELEPE, másodpercben.
   *
   * Nem azért fogy, hogy siettessen, hanem hogy a fény DÖNTÉS legyen:
   * végigvilágítod a folyosót, vagy megspórolod a következő szobára.
   */
  torch: 150,
  /** Elemcsomag a pályán: ennyivel tölt. */
  battery: 45,
  /**
   * ÖSSZECSUKLÁS: ennyi ideje van a társadnak felszedni.
   *
   * Húsz másodperc: elég ahhoz, hogy a ház túlsó végéből is odaérjen, és
   * kevés ahhoz, hogy ne lehessen nyugodtan kivárni. Közben a szörny ott
   * van fölötted — tehát a mentés maga is kockázat.
   */
  bleed: 20,
  /** A felszedés ideje. Nem érintés: le kell guggolni melléd. */
  revive: 2.5,
  /** Ennyire kell megközelíteni a társadat a felszedéshez. */
  reviveRadius: 3,
  /** Az ijesztés hossza — a kép és a hang. */
  scare: 1.2,
  /**
   * AZ ELIJESZTÉS: mindegyik szörny MÁSTÓL fél.
   *
   * Fegyver nincs, és nem is hiányzik — egy fegyver úgyis csak egy válasz
   * volna minden kérdésre. Helyette mindegyiknek SAJÁT ellenszere van, és a
   * tudás maga a fegyver: a kérdés az lesz, MI áll ott a sötétben, mert a
   * válasz attól függ.
   *
   * A legszebb pár az ÁRNYÉK és a LESŐ. Az egyiket a fény elégeti, a
   * másikat a fény ébreszti fel — és amíg rájuk nem világítasz, ugyanúgy
   * néznek ki. Egyetlen jel különbözteti meg őket: a Leső szeme
   * VISSZAVERI a fényt, mielőtt elindulna. Az Árnyéknak nincs szeme.
   *
   * A lámpa tehát egyszerre a helyes és a végzetes válasz.
   */
  /** Ennyi ideig kell ráfogni a fényt az Árnyékra, hogy szétfoszoljon. */
  burn: 2.0,
  /** Égetés közben ennyiszer gyorsabban fogy a telep. */
  burnDrain: 6,
  /** Elijesztve ennyi ideig nem jön vissza. */
  flee: 22,
  /** A lámpa kúpjának fél szöge: ekkorában „ráfogtad". */
  beam: 0.42,
  /** És eddig a távolságig ér el. */
  beamRange: 22,
  /** A Leső ennyi mozdulatlan, sötét másodperc után nyugszik meg. */
  calm: 4,

  /**
   * A KÖVETŐ: nem bánt, csak jön — és ez rosszabb.
   *
   * Az első változatban elkapott, és az unalmas volt: még egy szörny, ami
   * elől futni kell. Így viszont ő lett a mód legkellemetlenebb lénye,
   * mert nem AZ a baj, amit ő csinál, hanem amit MIATTA történik: minden
   * lépésével zajt kelt, és a zajra jönnek a többiek. Nem tőle félsz,
   * hanem attól, hogy nem tudsz megszabadulni tőle.
   *
   * És nem szembe jön: amíg nem látod, MÖGÉD kerül. Megfordulsz, és ott
   * áll — nem támad, csak áll. Ez az egyetlen szörny, ami akkor is
   * dolgozik, amikor nincs a képernyőn.
   */
  stalkerNoise: 26,
  /** Ennyire zárkózik fel: mögötted marad, nem rád mászik. */
  stalkerGap: 7,
  /** Ennyi idő után kerül megint mögéd, ha épp nem látod. */
  stalkerBlink: 9,
  /** Ennyi ideig kell látótávolságon kívül lenned, hogy lerázd. */
  stalkerShake: 6,
  /** Lerázva ennyi ideig nem jön vissza. */
  stalkerRest: 25,

  /**
   * EMBERMÉRTÉK.
   *
   * A kísértetház nem a szörnyecskék világa: ott egy egység egy méter, a
   * folyosó két és fél méter széles, a fal három. Ehhez a mozgásnak is
   * emberinek kell lennie — a hatos alapsebesség olimpiai sprint, és egy
   * tizenkét méteres dupla ugrással a falak díszletek volnának.
   *
   * Nem külön mozgásrendszer: ugyanaz, két szorzóval.
   */
  speed: 0.55,
  jump: 0.28,
} as const;
