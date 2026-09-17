import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { VillageHouse, WALL_DRAW_HEIGHT } from '../src/world/VillageHouse';
import { MOVE, CAMERA } from '../src/core/config';
const nav = JSON.parse(readFileSync('public/models/house1-nav.json', 'utf8'));
const house = VillageHouse.fromNav(nav);
const N = house.gridSize, R = Math.ceil(MOVE.radius / house.cell);
const spots: THREE.Vector3[] = [];
for (let j = R; j < N - R; j += 3) for (let i = R; i < N - R; i += 3) {
  let free = true;
  for (let b = -R; b <= R && free; b++) for (let a = -R; a <= R; a++) if (house.solidAt(i + a, j + b)) { free = false; break; }
  if (free && house.roomAt(house.worldX(i), house.worldZ(j)) > 0) spots.push(new THREE.Vector3(house.worldX(i), 0, house.worldZ(j)));
}
function occl(p: THREE.Vector3, yaw: number, pitch: number, dist: number) {
  const dir = new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch), Math.sin(pitch), Math.cos(yaw)*Math.cos(pitch));
  const cam = p.clone().setY(CAMERA.focusHeight).addScaledVector(dir, dist);
  const head = p.clone().setY(MOVE.height);
  const to = cam.clone().sub(head); const len = to.length(); to.normalize();
  for (let s = 0.3; s < len; s += 0.3) { const q = head.clone().addScaledVector(to, s);
    if (q.y > WALL_DRAW_HEIGHT) return false; if (house.solidAt(house.col(q.x), house.row(q.z))) return true; }
  return false;
}
function cam(pitch: number, fov: number, dist: number, aspect: number) {
  const c = new THREE.PerspectiveCamera(fov, aspect, CAMERA.near, CAMERA.far);
  const d = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
  const f = new THREE.Vector3(0, CAMERA.focusHeight, 0);
  c.position.copy(f).addScaledVector(d, dist); c.lookAt(f); c.updateMatrixWorld(); c.updateProjectionMatrix(); return c;
}
const nd = (c: THREE.PerspectiveCamera, p: THREE.Vector3) => p.clone().project(c);
function metrics(pitch: number, fov: number, dist: number, aspect: number, panePx: number) {
  const c = cam(pitch, fov, dist, aspect);
  const a = nd(c, new THREE.Vector3()), b = nd(c, new THREE.Vector3(0, MOVE.height, 0));
  const frac = Math.abs(b.y - a.y) / 2;
  let ah = 0; for (let s = 0; s <= 200; s += 0.5) { if (nd(c, new THREE.Vector3(0,0,-s)).y > 0.75) break; ah = s; }
  let bh = 0; for (let s = 0; s <= 200; s += 0.5) { if (nd(c, new THREE.Vector3(0,0,s)).y < -1) break; bh = s; }
  let sw = 0; for (let s = 0; s <= 200; s += 0.5) { if (nd(c, new THREE.Vector3(s,0,0)).x > 1) break; sw = s; }
  return { frac, px: frac * panePx, ah, bh, sw: sw * 2, camY: dist * Math.sin(pitch) + CAMERA.focusHeight };
}
const cands: Array<[string, number, number, number, number]> = [
  // név, pitch, fov, közös táv, osztott táv
  ['jelenlegi     ', 0.68, 68, 22, 18],
  ['A p=0.74      ', 0.74, 68, 21, 17],
  ['B p=0.78      ', 0.78, 68, 21, 17],
  ['C p=0.78 f64  ', 0.78, 64, 20, 16],
  ['D p=0.82 f66  ', 0.82, 66, 20, 16],
  ['E p=0.86 f66  ', 0.86, 66, 20, 16],
];
console.log('név            | takart% | KÖZÖS px/%/előre/oldal | VÍZSZ.OSZT px/% | FÜGG.OSZT px/%/oldal | kam.mag');
for (const [name, pitch, fov, ds, dp] of cands) {
  let bad = 0, tot = 0;
  for (let q = 0; q < 4; q++) for (const s of spots) { tot++; if (occl(s, q*Math.PI/2, pitch, ds)) bad++; }
  const S = metrics(pitch, fov, ds, 1920/1080, 1080);
  const Hh = metrics(pitch, fov, dp, 1920/540, 540);
  const Vv = metrics(pitch, fov, dp, 960/1080, 1080);
  console.log(`${name} | ${(100*bad/tot).toFixed(1).padStart(5)}% | ${S.px.toFixed(0).padStart(3)}px ${(S.frac*100).toFixed(1)}% ${S.ah.toFixed(0).padStart(3)}e ${S.sw.toFixed(0).padStart(3)}e | ${Hh.px.toFixed(0).padStart(3)}px ${(Hh.frac*100).toFixed(1)}% | ${Vv.px.toFixed(0).padStart(3)}px ${(Vv.frac*100).toFixed(1)}% ${Vv.sw.toFixed(0).padStart(3)}e | ${S.camY.toFixed(1)}`);
}
