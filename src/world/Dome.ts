import * as THREE from 'three';

/**
 * A BEFŐTTESÜVEG.
 *
 * Valaki leüvegezte a falut, ahogy a cukorkát szokás — se ki, se be. Ez
 * egyszerre két dolgot old meg, és ezért érdemes egyáltalán megcsinálni:
 *
 *   · JÁTÉKMENET: a pálya szélén nem lehet lezuhanni. Egy láthatatlan fal
 *     ugyanezt tudná, de a játékos nem értené, MIÉRT nem mehet tovább — egy
 *     látható üvegbura viszont megmondja magától.
 *   · TÖRTÉNET: eddig „eltűnt a város édességkészlete" volt a felállás, ami
 *     nem magyaráz semmit. Az üveg megmagyarázza: a készlet nem eltűnt,
 *     hanem be van zárva, és ti is vele együtt.
 *
 * Az üveg BELÜLRŐL látszik (BackSide), tehát nem takarja a falut, csak
 * megszínezi az eget a széleken — középen szinte átlátszó, a horizont felé
 * sűrűsödik. Ez nem stílus: egy egyenletesen opálos bura a fél képet elvenné.
 */
export class Dome {
  readonly group = new THREE.Group();
  readonly radius: number;

  private readonly glass: THREE.Mesh;
  private readonly sheen: THREE.Mesh;
  private clock = 0;

  constructor(radius: number, height: number) {
    this.radius = radius;

    // Az üveg maga. A gradiens a csúcsponttól a talpig sűrűsödik, mert ott
    // nézünk rajta a leghosszabban keresztül — ahogy egy igazi üvegen is.
    const glassGeo = new THREE.SphereGeometry(radius, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    glassGeo.scale(1, height / radius, 1);
    const colours: number[] = [];
    const pos = glassGeo.attributes.position;
    const top = new THREE.Color(0x6a4fa8);
    const bottom = new THREE.Color(0xffa63c);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, pos.getY(i) / height);
      const c = bottom.clone().lerp(top, Math.pow(t, 0.55));
      colours.push(c.r, c.g, c.b);
    }
    glassGeo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));

    this.glass = new THREE.Mesh(
      glassGeo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.22,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.glass.renderOrder = -1;
    this.group.add(this.glass);

    // Egy második, alig nagyobb héj, ami LASSAN fordul. Ettől lesz üveg és
    // nem köd: a csillanás elmozdul, miközben a bura áll.
    const sheenGeo = glassGeo.clone();
    sheenGeo.scale(1.004, 1.004, 1.004);
    this.sheen = new THREE.Mesh(
      sheenGeo,
      new THREE.MeshBasicMaterial({
        color: 0xbfd4ff,
        transparent: true,
        opacity: 0.09,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.sheen.renderOrder = -1;
    this.group.add(this.sheen);

    // A csavarmenetes perem a talpánál: ez mondja meg, hogy ÜVEG, és nem
    // erőtér. Egyetlen tórusz, a horizont vonalában.
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.998, radius * 0.012, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0xc9873a, transparent: true, opacity: 0.55 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = radius * 0.012;
    this.group.add(rim);

    // A TETEJE. Enélkül ez nem befőtt, hanem bura.
    //
    // A búra és a befőttesüveg között egyetlen dolog dönt, és az nem az
    // üveg: a FEDŐ. Amíg csak egy áttetsző félgömb volt fölötted, a
    // történetet (üveg alá zártak, mint egy cukorkát) semmi nem támasztotta
    // alá — hiába mondta az intró.
    //
    // Fémes, bordázott perem és egy enyhén domború lap. Magasan van, tehát
    // csak akkor látod, ha FELNÉZEL — és pont ezért éri meg felnézni.
    const lidY = height * 0.985;
    const lidR = radius * 0.27;

    const lidMat = new THREE.MeshBasicMaterial({ color: 0x8c6a3f });
    const plate = new THREE.Mesh(new THREE.CircleGeometry(lidR, 40), lidMat);
    plate.rotation.x = Math.PI / 2;
    plate.position.y = lidY;
    this.group.add(plate);

    // A fedő pereme: bordázott gyűrű, ahogy egy csavaros tetőn.
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(lidR, lidR * 1.04, radius * 0.045, 40, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xa8804c, side: THREE.DoubleSide })
    );
    skirt.position.y = lidY - radius * 0.022;
    this.group.add(skirt);

    // A NYAK: az üveg befelé szűkül a fedő alatt. Ez a forma az, amitől
    // messziről is befőtt, nem lombik.
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(lidR * 1.02, radius * 0.42, height * 0.12, 40, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x9fb6e8,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    neck.position.y = lidY - height * 0.075;
    this.group.add(neck);
  }

  update(dt: number): void {
    this.clock += dt;
    this.sheen.rotation.y = this.clock * 0.035;
  }

  /**
   * Visszatereli, aki kifelé tart.
   *
   * Nem ütközésvizsgálat, hanem egyetlen sugárirányú korlát — és ez
   * szándékos: az üveg kör alakú, tehát nincs sarka, ahol be lehetne
   * szorulni. Az eredmény egy csúszás a fal mentén, nem egy megállás.
   */
  clamp(position: THREE.Vector3, inset: number): boolean {
    const limit = this.radius - inset;
    const d = Math.hypot(position.x, position.z);
    if (d <= limit || d < 1e-6) return false;
    position.x *= limit / d;
    position.z *= limit / d;
    return true;
  }
}
