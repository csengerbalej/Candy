import * as THREE from 'three';
import { STREET } from '../core/config';
import type { DriveWorld } from '../world/DriveWorld';
import type { Car } from '../vehicle/Car';
import type { CritterTraffic } from '../ai/CritterTraffic';

/**
 * The navigator's screen (spec §10). It is a 2D canvas, not a 3D camera, and
 * that is the point: the two players are not looking at the same kind of thing.
 *
 * The design rule that makes this a co-op system rather than a minimap:
 * EVERYTHING useful lives here and NOTHING useful is on the driver's screen.
 * The destination, the route, the critters — the driver learns all of it by
 * being told. The ping button is the only channel between the two, and it is
 * deliberately vague: it shows a direction, never a road.
 */
export class NavigatorMap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'nav-map';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  dispose(): void {
    this.canvas.remove();
  }

  /** Position the canvas over the navigator's viewport (CSS pixel space). */
  place(x: number, top: number, w: number, h: number): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.style.left = `${x}px`;
    this.canvas.style.top = `${top}px`;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
  }

  draw(
    world: DriveWorld,
    car: Car,
    traffic: CritterTraffic,
    targetId: number,
    radarLeft: number,
    /**
     * A még hátralévő kapuk, ha időfutam megy.
     *
     * A térkép eddig egyetlen célt ismert: a házat. Amíg viszont a kihívás
     * tart, a ház zárva — és egy térkép, ami olyan helyet jelöl célként,
     * ahova még nem mehetsz, félrevezet.
     */
    gates: THREE.Vector3[] = [],
    /** A társ kocsija, ha ketten játszotok. */
    partner: THREE.Vector3 | null = null
  ): void {
    const ctx = this.ctx;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#0c0820';
    ctx.fillRect(0, 0, w, h);

    // World→map transform: the whole town at once, because a navigator who has
    // to scroll is a navigator who stops talking.
    const size = world.bounds.getSize(new THREE.Vector2());
    const centre = world.bounds.getCenter(new THREE.Vector2());
    const margin = 26;
    const scale = Math.min((w - margin) / size.x, (h - margin) / size.y);
    const px = (x: number) => w / 2 + (x - centre.x) * scale;
    const py = (z: number) => h / 2 + (z - centre.y) * scale;

    // Road tiles, drawn as the squares they actually are. The town is not a
    // grid of infinite lines any more — it has dead ends and a T-junction, and
    // the map has to show that or the navigator will send the driver into a wall.
    const tile = world.tileSize * scale;
    ctx.fillStyle = '#2f2554';
    for (const road of world.roads) {
      ctx.fillRect(px(road.centre.x) - tile / 2, py(road.centre.z) - tile / 2, tile, tile);
    }

    // Radar: critters, but only while the pulse is live.
    if (radarLeft > 0) {
      const fade = Math.min(1, radarLeft / 0.6);
      ctx.globalAlpha = 0.35 + fade * 0.55;
      for (const c of traffic.critters) {
        if (c.position.distanceTo(car.position) > STREET.radarRange) continue;
        ctx.fillStyle = c.launched > 0 ? '#ff6b6b' : '#6ef0c0';
        ctx.beginPath();
        ctx.arc(px(c.position.x), py(c.position.z), 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // A KAPUK. A soron következő világít, a többi halvány — ugyanaz a
    // logika, mint a pályán: az összes egyszerre kiemelve nem útvonal.
    for (let g = 0; g < gates.length; g++) {
      const gx = px(gates[g].x);
      const gy = py(gates[g].z);
      const next = g === 0;
      ctx.strokeStyle = next ? '#7ad7ff' : 'rgba(122,215,255,.35)';
      ctx.lineWidth = next ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc(gx, gy, next ? 9 : 5, 0, Math.PI * 2);
      ctx.stroke();
      if (next) {
        // A KÉK VONAL: valódi útvonal az utcákon, nem légvonal.
        //
        // Légvonalban kijelölt cél egy rácsos városban rendszeresen falnak
        // vezet: látod, hogy „arra van", és közben egy háztömb áll közte.
        // A navigátor dolga épp az, hogy megmondja, MERRE menj — nem az,
        // hogy merre VAN.
        const path = world.route(car.position, gates[g]);
        ctx.strokeStyle = '#7ad7ff';
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px(car.position.x), py(car.position.z));
        for (const p of path) ctx.lineTo(px(p.x), py(p.z));
        ctx.lineTo(gx, gy);
        ctx.stroke();
      }
    }

    // A TÁRS KOCSIJA. Kétfős módban a ház ajtaja kettőtökre nyílik, tehát
    // tudnod kell, hol tart — enélkül csak annyit látnál, hogy „várj a
    // társadra", és fogalmad sem lenne, mennyit.
    if (partner) {
      const tx = px(partner.x);
      const ty = py(partner.z);
      ctx.fillStyle = '#9d5cff';
      ctx.beginPath();
      ctx.arc(tx, ty, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(157,92,255,.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(tx, ty, 9, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Houses. The target is the only one drawn loud.
    for (const house of world.houses) {
      const isTarget = house.id === targetId;
      const hx = px(house.position.x);
      const hy = py(house.position.z);

      ctx.fillStyle = isTarget ? '#ff7a29' : '#5a4b8c';
      ctx.beginPath();
      ctx.arc(hx, hy, isTarget ? 7 : 4, 0, Math.PI * 2);
      ctx.fill();

      if (isTarget) {
        ctx.strokeStyle = 'rgba(255,122,41,.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx, hy, 13, 0, Math.PI * 2);
        ctx.stroke();

        // The straight line home. Not a route — the roads are the navigator's
        // problem to solve out loud.
        ctx.setLineDash([5, 6]);
        ctx.strokeStyle = 'rgba(255,122,41,.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px(car.position.x), py(car.position.z));
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Only the destination is labelled: twelve labels on a small pane is
      // noise, and the navigator's job is to name the place out loud anyway.
      if (isTarget) {
        ctx.fillStyle = '#ffd9a8';
        ctx.font = '700 10px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(house.name, hx, hy - 16);
      }
    }

    // The car, as a heading arrow. Direction matters more than position here.
    const carX = px(car.position.x);
    const carY = py(car.position.z);
    ctx.save();
    ctx.translate(carX, carY);
    ctx.rotate(arrowRotation(car.heading));
    ctx.fillStyle = '#9d5cff';
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/**
 * How far to spin the map's car arrow, given the car's heading.
 *
 * The arrow is drawn pointing UP the canvas, and it used to be rotated by
 * MINUS the heading — which is wrong by exactly 180 degrees at every heading,
 * so the whole map read backwards: press forward and the arrow pointed at
 * where you had just come from.
 *
 * The two conventions that have to meet: the car's forward is
 * (sin h, cos h) in world x/z, and the map puts world +z DOWN the canvas,
 * because canvas y grows downwards. So heading 0 — forward along +z — has to
 * draw an arrow pointing down, not up. Solving for the rotation that takes the
 * arrow's tip (0, -1) onto (sin h, cos h) gives pi - h.
 */
export function arrowRotation(heading: number): number {
  return Math.PI - heading;
}

/** Bearing from the car to a world point, relative to where the car is pointing. */
export function relativeBearing(car: Car, target: THREE.Vector3): number {
  const want = Math.atan2(target.x - car.position.x, target.z - car.position.z);
  let d = ((want - car.heading + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
