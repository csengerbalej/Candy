import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

let cached: THREE.Texture | null = null;

/**
 * A soft studio environment, for characters only.
 *
 * Three point lights approximate a lighting rig; they cannot approximate a
 * ROOM. Velvet, fur and skin in the reference renders get their character from
 * light arriving from every direction at once, and that is what an environment
 * map is. It is generated procedurally rather than loaded, so it costs one
 * render at startup and no download.
 *
 * It is attached per material rather than set on the scene, because the house
 * is deliberately near-black — lighting the whole room with a studio would
 * undo the one thing that makes the homeowner's torch readable.
 */
export function studioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (cached) return cached;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  cached = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return cached;
}

/** Give every standard material under `root` the environment, at `intensity`. */
export function applyEnvironment(
  root: THREE.Object3D,
  environment: THREE.Texture,
  intensity: number
): void {
  const seen = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData['cp-outline']) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = material as THREE.MeshStandardMaterial;
      if (!std.isMeshStandardMaterial || seen.has(std)) continue;
      seen.add(std);
      std.envMap = environment;
      std.envMapIntensity = intensity;
      std.needsUpdate = true;
    }
  });
}

/**
 * The night sky, as a gradient dome.
 *
 * `scene.background` was a single flat colour, and a flat background is the
 * reason the town read as cut-out shapes floating in nothing: a roofline, a
 * bare tree and a street lamp all met the same value at the top of the frame,
 * so nothing had a silhouette. A dome gives the skyline something to be dark
 * AGAINST, and the horizon band is what makes a long street read as going
 * somewhere.
 *
 * It costs one draw call and no texture. The moon is a disc in the shader
 * rather than a sprite so it never needs to be sorted against anything.
 */
export function nightSky(options: {
  zenith?: number;
  horizon?: number;
  moon?: THREE.Vector3;
} = {}): THREE.Mesh {
  const zenith = new THREE.Color(options.zenith ?? 0x0a0819);
  const horizon = new THREE.Color(options.horizon ?? 0x2a2150);
  const moonDir = (options.moon ?? new THREE.Vector3(0.5, 0.55, 0.4)).clone().normalize();

  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: zenith },
      horizon: { value: horizon },
      moonDir: { value: moonDir },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        // Rotation only, and z forced to w: the dome sits exactly on the far
        // plane in every direction, so it never has to be moved with the
        // camera and can never be driven out of or clipped into.
        vec4 clip = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
        gl_Position = clip.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 moonDir;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        // Biased towards the horizon: a linear ramp puts the bright band
        // halfway up the sky, where no horizon has ever been.
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 sky = mix(horizon, zenith, pow(h, 0.45));

        // Below the eyeline the dome only has to not be a seam.
        sky = mix(sky, horizon * 0.45, clamp(-dir.y * 3.0, 0.0, 1.0));

        float d = dot(dir, moonDir);
        // Disc plus halo. The halo is the part that does the work — it is what
        // tells you which way the moon is when it is off-screen, and the town's
        // shadows are cast from that same direction.
        sky += vec3(0.75, 0.80, 1.0) * smoothstep(0.9992, 0.9997, d);
        sky += vec3(0.10, 0.12, 0.22) * pow(max(d, 0.0), 220.0);
        sky += vec3(0.05, 0.05, 0.11) * pow(max(d, 0.0), 14.0);

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}


/**
 * A KONYHA, ahol az üveg áll.
 *
 * Egy 360°-os panoráma, az égbolt helyén. Eddig egy kódból számolt éjszakai
 * ég volt ott: szép, de SEMMIT nem mondott arról, hol vagytok. Az intró
 * elmondta, hogy befőttbe zártak titeket, aztán a játék egy csillagos eget
 * mutatott — a kettő nem találkozott.
 *
 * Ez viszont körbeér: ahova fordulsz, ott a pult, a szekrény, a holdfényes
 * ablak, a függőlámpa. És nem csak HÁTTÉR: ugyanez a kép adja a környezeti
 * fényt is, tehát a lámpa narancsa és az ablak kékje rákerül az autóra és a
 * házakra. Ettől áll a város ABBAN a konyhában, nem csak előtte.
 *
 * `null`, ha a kép nem tölt be — a játék ilyenkor a számolt éggel megy
 * tovább, mert egy hiányzó háttérkép nem teheti játszhatatlanná az estét.
 */
export async function kitchenSurround(
  renderer: THREE.WebGLRenderer,
  url = 'art/kitchen.webp'
): Promise<THREE.Texture | null> {
  try {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    // Az equirectangular leképezés az, ami a 2:1-es képet gömbre teríti.
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    // Előszűrés: enélkül a tükröződés szemcsés lenne a fényes felületeken.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromEquirectangular(texture);
    pmrem.dispose();
    (target.texture as THREE.Texture & { userData: Record<string, unknown> }).userData.raw = texture;
    return target.texture;
  } catch {
    return null;
  }
}
