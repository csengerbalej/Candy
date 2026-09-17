import * as THREE from 'three';
import { canDraw } from '../render/headless';

/**
 * A POLC, amin a befőttesüveg áll.
 *
 * Az üveg önmagában nem elég: a játékos szerint „a játékból nézve nem olyan,
 * mintha egy befőttben lennénk". Igaza volt — egy bura fölöttünk lehet
 * erőtér, kupola, égbolt is. Ami befőtté teszi, az nem a fedél, hanem hogy
 * VALAMIN ÁLL, és hogy azon túl egy szoba van.
 *
 * Miért nem háttérkép: egy fotó nem mozdul a kamerával, tehát az első
 * elfordulásnál kilóg a térből. Ez itt három valódi, térben álló elem —
 * deszkalap, hátfal, porszemek —, és pontosan attól működik, hogy a kamerával
 * együtt mozdul.
 *
 * Minden elem a burán KÍVÜL van, és egyik sem ütközik semmivel: a játékmenet
 * felől nézve ez a jelenet nem létezik.
 */
/**
 * Ennyivel a pálya alatt van a polc lapja.
 *
 * A falu alaplemeze egy egység vastag (az alja -1-en), tehát ennél lejjebb
 * kell lennie — különben a két felület egy síkba kerül, és a mélységpuffer
 * villogni kezd köztük.
 */
const BOARD_TOP = 3;

export class Shelf {
  readonly group = new THREE.Group();

  private readonly dust: THREE.Points | null = null;
  private readonly drift: Float32Array | null = null;
  private clock = 0;

  constructor(radius: number, height: number) {
    // --- a deszkalap ---------------------------------------------------------
    //
    // Jóval szélesebb, mint az üveg: egy pont akkora polc szűknek látszana,
    // és elárulná, hogy csak az üveg kedvéért van ott.
    const boardSize = radius * 5.5;
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(boardSize, radius * 0.11, boardSize),
      // Sötétebb, mint elsőre: egy világos deszkalap a kép legfényesebb
      // eleme lett, és elvitte a figyelmet a falutól. A polc háttér, nem
      // díszlet.
      new THREE.MeshBasicMaterial({ map: woodTexture(), color: 0x3b2d1e })
    );
    // A DESZKA TETEJE A PÁLYA ALÁ KERÜL.
    //
    // Elsőre pont a pálya síkjába tettem — a kettő egy magasságban volt,
    // tehát a mélységpuffer nem tudta eldönteni, melyik van elöl, és a fél
    // kép sárgán VILLOGOTT. Két egy síkban fekvő felület mindig ezt csinálja,
    // és ez a hiba nem „néha" jelentkezik: attól függ, épp merre néz a kamera.
    //
    // A falu alaplemeze egy egységnyi vastag, tehát az alja -1-en van. A
    // deszka teteje ez alatt marad, jó tartalékkal.
    board.position.y = -BOARD_TOP - radius * 0.055;
    this.group.add(board);

    // A polc ELEJE, ahol a deszka véget ér. Ez adja meg, hogy egy bútoron
    // állunk és nem egy végtelen síkon.
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(boardSize, radius * 0.16, radius * 0.06),
      new THREE.MeshBasicMaterial({ color: 0x55402c })
    );
    lip.position.set(0, -BOARD_TOP - radius * 0.06, boardSize / 2);
    this.group.add(lip);

    // --- a szoba -------------------------------------------------------------
    //
    // Egy hengerpalást a jelenet köré, befelé nézve: olcsóbb, mint négy fal,
    // és nincs sarka, ami elárulná, hol ér véget. Alul melegebb (a lámpa
    // felől), fent sötétbe vész.
    const wallGeo = new THREE.CylinderGeometry(radius * 6, radius * 6, radius * 5, 24, 1, true);
    const colours: number[] = [];
    const pos = wallGeo.attributes.position;
    const warm = new THREE.Color(0x3a2c30);
    const dark = new THREE.Color(0x090711);
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp(pos.getY(i) / (radius * 2.5) + 0.5, 0, 1);
      const c = warm.clone().lerp(dark, Math.pow(t, 0.7));
      colours.push(c.r, c.g, c.b);
    }
    wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    const walls = new THREE.Mesh(
      wallGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })
    );
    walls.position.y = radius * 1.4;
    this.group.add(walls);

    // Egy távoli szekrény sziluettje. Egyetlen doboz — de tőle lesz a szoba
    // szoba, és nem egy színes henger.
    const cupboard = new THREE.Mesh(
      new THREE.BoxGeometry(radius * 2.2, radius * 3.4, radius * 0.9),
      new THREE.MeshBasicMaterial({ color: 0x16111f, fog: false })
    );
    cupboard.position.set(-radius * 3.4, radius * 1.2, -radius * 3.6);
    this.group.add(cupboard);

    // --- porszemek -----------------------------------------------------------
    //
    // Ez az egyetlen MOZGÓ elem a háttérben, és ez adja a „poros polc"
    // érzést. Lassan süllyednek, és ha leérnek, fölül újrakezdik.
    const count = 260;
    const points = new Float32Array(count * 3);
    const drift = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      points[i * 3] = (Math.random() * 2 - 1) * radius * 2.4;
      points[i * 3 + 1] = Math.random() * height * 2.2;
      points[i * 3 + 2] = (Math.random() * 2 - 1) * radius * 2.4;
      drift[i] = 0.4 + Math.random() * 1.2;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    this.dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color: 0xffe0b0,
        size: radius * 0.012,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        fog: false,
      })
    );
    this.drift = drift;
    this.group.add(this.dust);

    // Egy meleg fény OLDALRÓL, a szoba felől. Nem világít be semmit — a
    // háttér anyagai alapszínűek —, de a por megcsillan benne.
    const lamp = new THREE.PointLight(0xffb45e, 40, radius * 9, 2);
    lamp.position.set(radius * 3.2, radius * 2.2, radius * 2.6);
    this.group.add(lamp);
  }

  update(dt: number): void {
    this.clock += dt;
    if (!this.dust || !this.drift) return;
    const pos = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    const array = pos.array as Float32Array;
    for (let i = 0; i < this.drift.length; i++) {
      const y = i * 3 + 1;
      array[y] -= this.drift[i] * dt;
      // Oldalirányú lebegés: a por nem esik, hanem SZÁLL.
      array[i * 3] += Math.sin(this.clock * 0.35 + i) * dt * 0.35;
      if (array[y] < 0) array[y] = this.dust.position.y + 200;
    }
    pos.needsUpdate = true;
  }
}

/**
 * Deszkaerezet, rajzolva.
 *
 * Nem letöltött textúra: egy polc erezete néhány sáv, és ennyiért nem éri meg
 * fájlt szállítani. Fejetlen próbában nincs vászon, ilyenkor egyszerűen nincs
 * erezet sem — a szín marad.
 */
function woodTexture(): THREE.Texture | null {
  if (!canDraw()) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * 256;
    ctx.strokeStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.1})`;
    ctx.lineWidth = 0.6 + Math.random() * 2.4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(85, y + (Math.random() * 8 - 4), 170, y + (Math.random() * 8 - 4), 256, y);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
