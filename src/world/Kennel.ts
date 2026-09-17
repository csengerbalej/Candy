import * as THREE from 'three';
import { DOG } from '../core/config';

/**
 * A kutyaól.
 *
 * Geometriából, nem modellből — nem a látvány miatt van itt, hanem hogy a
 * kutya alvóhelye HELY legyen a szobában. Egy kutya, ami a semmi közepén
 * ébred, véletlennek látszik; egy kutya, aminek van ólja, szabálynak: oda
 * megy vissza, onnan indul, és a játékos ezt a második körben már tudja.
 *
 * Nem kap ütközőt. A ház rácsa nem tud róla, tehát egy ütköző itt olyan falat
 * adna, amit a navigáció nem lát — a kutya pont a saját óljában szorulna be.
 */
export function kennelAt(position: THREE.Vector3): THREE.Object3D {
  const g = new THREE.Group();

  const w = DOG.width * 2.6;
  const d = DOG.width * 3.2;
  const h = DOG.height * 1.25;

  const wood = new THREE.MeshStandardMaterial({ color: 0x4e3524, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x120c0a, roughness: 1 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x6b2f2a, roughness: 0.8 });

  // A test: két oldalfal és egy hátfal, nem egy tömör doboz — hogy a nyílás
  // tényleg nyílás legyen, és a kutya belelátszódjon, amikor bent alszik.
  const side = new THREE.BoxGeometry(0.18, h, d);
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(side, wood);
    m.position.set((sx * w) / 2, h / 2, 0);
    m.castShadow = true;
    g.add(m);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.18), wood);
  back.position.set(0, h / 2, -d / 2);
  back.castShadow = true;
  g.add(back);

  // Az előlap a nyílással: két oszlop és egy áthidaló, kapubéllet helyett.
  const gap = w * 0.46;
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry((w - gap) / 2, h * 0.72, 0.18), wood);
    post.position.set((sx * (w + gap)) / 4, h * 0.36, d / 2);
    g.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.28, 0.18), wood);
  lintel.position.set(0, h * 0.86, d / 2);
  g.add(lintel);

  // A nyílás mögötti sötét: enélkül a belseje a szoba fényét veri vissza, és
  // az ól tömör kockának látszik.
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(gap, h * 0.72), dark);
  mouth.position.set(0, h * 0.36, d / 2 - 0.05);
  g.add(mouth);

  // Nyeregtető: két ferde lap.
  const pitch = Math.PI * 0.18;
  const slope = new THREE.BoxGeometry(w * 1.12, 0.16, d / Math.cos(pitch) + 0.4);
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(slope, roof);
    m.rotation.z = sx * pitch;
    m.position.set((sx * w) / 4.1, h + (w / 4.1) * Math.tan(pitch), 0);
    m.castShadow = true;
    g.add(m);
  }

  g.position.copy(position);
  return g;
}
