import * as THREE from 'three';

/**
 * The look (spec §4): cel-shading plus thick dark contours.
 *
 * Two independent pieces, because they fail for different reasons:
 *
 *  1. BANDING — MeshToonMaterial quantises diffuse light against a gradient
 *     ramp. A 3-step ramp reads as cartoon; 5+ steps just looks like cheap
 *     lighting. Textures survive, so authored models keep their paint.
 *
 *  2. OUTLINES — the inverted-hull trick: a second copy of the mesh, rendered
 *     back-faces-only, pushed out along its normals. It costs one extra draw
 *     of the same geometry, so it goes on the things the eye tracks (players,
 *     the homeowner, the car, the critters) and never on level geometry.
 */

const rampCache = new Map<string, THREE.DataTexture>();

/**
 * A hard-stepped gradient map. Nearest filtering is what makes the steps hard.
 *
 * `floor` is the darkest band, and it is a per-scene decision rather than a
 * global one: outdoors it has to sit high or the street reads as silhouettes,
 * indoors it has to sit low or the homeowner's flashlight stops being the
 * brightest thing in the room — and the flashlight is how players read his AI.
 */
export function toonRamp(steps = 3, floor = 0.38): THREE.DataTexture {
  const key = `${steps}:${floor}`;
  const cached = rampCache.get(key);
  if (cached) return cached;

  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = (i + 1) / steps;
    data[i] = Math.round((floor + (1 - floor) * Math.pow(t, 0.85)) * 255);
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  rampCache.set(key, tex);
  return tex;
}

const OUTLINE_TAG = 'cp-outline';

/**
 * Live contour shells, so the setting can switch them as a set.
 *
 * The list self-prunes: a shell whose top-level ancestor is no longer a Scene
 * belongs to a section that has ended, so it is dropped and its material
 * released. Without this the array grew for the life of the tab and pinned
 * every disposed house and town in memory.
 */
let outlineShells: THREE.Mesh[] = [];
let outlinesVisible = true;

function isLive(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  while (node.parent) node = node.parent;
  return (node as THREE.Scene).isScene === true;
}

export function setOutlinesVisible(visible: boolean): void {
  outlinesVisible = visible;
  const live: THREE.Mesh[] = [];
  for (const shell of outlineShells) {
    if (!isLive(shell)) {
      (shell.material as THREE.Material).dispose();
      continue;
    }
    shell.visible = visible;
    live.push(shell);
  }
  outlineShells = live;
}

/** Release the contours belonging to a section that has ended. */
export function pruneOutlines(): void {
  setOutlinesVisible(outlinesVisible);
}

// The skinning chunks are not optional for characters: an inverted hull that
// is not skinned stays in the bind pose while the mesh underneath walks away
// from it, leaving a person-shaped shadow standing in the room.
const outlineVertex = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  uniform float thickness;
  attribute vec3 smoothNormal;
  void main() {
    vec3 objectNormal = smoothNormal;
    vec3 transformed = position;
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <skinning_vertex>
    // Push along the normal in VIEW space and scale by depth, so the contour
    // keeps a constant on-screen width instead of thinning out with distance.
    // The clamp matters: past it a distant object gets an outline wider than
    // the object, and a character across the room turns into a black blob.
    vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);
    vec3 viewNormal = normalize(normalMatrix * objectNormal);
    float depth = clamp(-viewPosition.z, 0.0, 60.0);
    viewPosition.xyz += viewNormal * thickness * depth * 0.0012;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const outlineFragment = /* glsl */ `
  uniform vec3 outlineColor;
  void main() { gl_FragColor = vec4(outlineColor, 1.0); }
`;

/**
 * Averaged per-position normals, written as a `smoothNormal` attribute.
 *
 * An inverted hull has to push every vertex along a normal that all its
 * duplicates agree on. Authored meshes split vertices at UV and smoothing
 * seams, and a decimated one splits many more — so pushing along the shading
 * normal tears the contour into spikes exactly where the seams are. Averaging
 * by position closes the hull.
 */
function ensureSmoothNormals(geometry: THREE.BufferGeometry): void {
  if (geometry.getAttribute('smoothNormal')) return;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (!position || !normal) return;

  const accumulated = new Map<string, [number, number, number]>();
  const keyFor = (i: number) =>
    `${position.getX(i).toFixed(4)}|${position.getY(i).toFixed(4)}|${position.getZ(i).toFixed(4)}`;

  for (let i = 0; i < position.count; i++) {
    const key = keyFor(i);
    const sum = accumulated.get(key) ?? [0, 0, 0];
    sum[0] += normal.getX(i);
    sum[1] += normal.getY(i);
    sum[2] += normal.getZ(i);
    accumulated.set(key, sum);
  }

  const smooth = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const [x, y, z] = accumulated.get(keyFor(i))!;
    const length = Math.hypot(x, y, z) || 1;
    smooth[i * 3] = x / length;
    smooth[i * 3 + 1] = y / length;
    smooth[i * 3 + 2] = z / length;
  }
  geometry.setAttribute('smoothNormal', new THREE.BufferAttribute(smooth, 3));
}

/** Convert every standard/physical material under `root` to banded toon shading. */
/**
 * Source material + look → toon material, kept for the life of the tab.
 *
 * The town's assets are cloned per section and clones share their materials,
 * so a per-call cache built a brand new set of toon materials on every drive
 * and leaked the old ones to the GPU.
 */
const toonCache = new Map<string, THREE.Material>();

export function toonify(
  root: THREE.Object3D,
  options: { steps?: number; floor?: number; fill?: number; tint?: number } = {}
): void {
  const steps = options.steps ?? 3;
  const floor = options.floor ?? 0.38;
  const ramp = toonRamp(steps, floor);
  const fill = options.fill ?? floor * 0.75;
  const lookKey = `${steps}:${floor}:${fill}:${options.tint ?? 'none'}`;
  // A tint multiplies the base texture, so a daylight-grey wall becomes a
  // moonlit one without touching the asset. Emissive is NOT multiplied by it,
  // which is exactly right: the lit windows stay warm while the walls go blue.
  const tint = options.tint !== undefined ? new THREE.Color(options.tint) : null;

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData[OUTLINE_TAG]) return;
    // Some things in a cel-shaded world keep their own materials: the
    // characters do, and so does the sweet bucket, because they are sculpts
    // with their own painted detail and flattening them throws it away. The
    // flag lives on the object so the world that OWNS the thing decides, not
    // whichever scene happens to toonify it.
    if (mesh.userData.cpKeepPBR) return;

    const swap = (material: THREE.Material): THREE.Material => {
      const key = `${material.uuid}|${lookKey}`;
      const existing = toonCache.get(key);
      if (existing) return existing;
      const std = material as THREE.MeshStandardMaterial;
      if (!std.isMeshStandardMaterial) return material;

      // Normal maps are dropped on purpose: fine surface detail fights the flat
      // banding and reads as noise rather than form.
      //
      // An AUTHORED emissive map is kept exactly as it is — that is the glow in
      // a jack-o'-lantern and the light in a window, and replacing it with a
      // flat fill would make the whole town glow evenly and none of it glow
      // where it should. Only a material with no emissive of its own gets the
      // fill, so the unlit side of a greybox prop still reads as a shape rather
      // than a hole.
      const authored = Boolean(std.emissiveMap);
      const hasTexture = Boolean(std.map);
      const toon = new THREE.MeshToonMaterial({
        color: tint ? new THREE.Color().copy(std.color).multiply(tint) : std.color,
        map: std.map,
        // A CSÚCSSZÍN ÁTMEGY A CEL-SHADINGEN.
        //
        // Enélkül a kúria vakítóan fehér lett: a falak festése csúcsszínben
        // van (a generált háznak nincs UV-kiterítése, tehát képet nem lehet
        // ráfeszíteni), az alapszíne pedig fehér — és a cserénél a
        // csúcsszín-kapcsoló lemaradt. A szoba nem „túl világos" volt,
        // hanem FESTETLEN.
        vertexColors: std.vertexColors,
        emissive: authored ? std.emissive : hasTexture ? new THREE.Color(0xffffff) : std.emissive,
        emissiveMap: std.emissiveMap ?? (hasTexture ? std.map : null),
        emissiveIntensity: authored ? std.emissiveIntensity : hasTexture ? fill : std.emissiveIntensity,
        gradientMap: ramp,
        transparent: std.transparent,
        opacity: std.opacity,
        side: std.side,
      });
      toonCache.set(key, toon);
      return toon;
    };

    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(swap)
      : swap(mesh.material);
  });
}

/**
 * Add inverted-hull contours to every mesh under `root`.
 * Safe to call twice: already-outlined meshes are skipped.
 */
/**
 * Contour the silhouette of `root`.
 *
 * `thickness` is a fraction of the model's own size, not a world distance, and
 * each part is contoured in proportion to ITS size rather than the model's.
 * Both details matter on an authored asset: a jeep is dozens of separate
 * meshes — pumpkins, lamps, decals, roll cage — and giving a 20cm pumpkin the
 * same contour as the 4m body buries the whole vehicle in black smear.
 *
 * Parts below `minRatio` of the model's radius are skipped entirely: they are
 * detail, and detail does not get its own outline in cel-shaded art.
 */
export function addOutlines(
  root: THREE.Object3D,
  thickness = 1,
  color = 0x0a0616,
  minRatio = 0.18
): void {
  const targets: THREE.Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    // `cpNoOutline`: ami nem TEST, az nem kaphat körvonalat.
    //
    // A lakó zseblámpakúpja egy 20 egység széles, áttetsző, összeadó
    // keveréssel rajzolt mesh — vagyis FÉNY, nem tárgy. Körvonalat kapva
    // viszont egy TÖMÖR, kifordított héj került köré, és az a szobánál is
    // nagyobb sápadt test volt az, amit a játékban „nagy fehérként" láttál.
    // A fénynek nincs körvonala.
    if (
      mesh.isMesh &&
      !mesh.userData[OUTLINE_TAG] &&
      !mesh.userData.hasOutline &&
      !mesh.userData.cpNoOutline
    ) {
      targets.push(mesh);
    }
  });

  // Measure the whole model once, so "big part" means big relative to the car
  // rather than big in absolute metres.
  const rootBox = new THREE.Box3().setFromObject(root);
  const rootRadius = rootBox.getSize(new THREE.Vector3()).length() * 0.5 || 1;

  for (const mesh of targets) {
    mesh.geometry.computeBoundingSphere();
    const radius = mesh.geometry.boundingSphere?.radius ?? rootRadius;
    if (targets.length > 1 && radius / rootRadius < minRatio) {
      mesh.userData.hasOutline = true;
      continue;
    }
    mesh.userData.hasOutline = true;
    ensureSmoothNormals(mesh.geometry);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        // Proportional to this part, so every contour reads at the same
        // on-screen weight regardless of how big the part is.
        thickness: { value: thickness * radius },
        outlineColor: { value: new THREE.Color(color) },
      },
      vertexShader: outlineVertex,
      fragmentShader: outlineFragment,
      side: THREE.BackSide,
    });

    const skinned = mesh as THREE.SkinnedMesh;
    let shell: THREE.Mesh;
    if (skinned.isSkinnedMesh) {
      const skinnedShell = new THREE.SkinnedMesh(mesh.geometry, material);
      // Share the skeleton rather than copying it: one pose, two meshes.
      skinnedShell.bind(skinned.skeleton, skinned.bindMatrix);
      skinnedShell.bindMode = skinned.bindMode;
      shell = skinnedShell;
    } else {
      shell = new THREE.Mesh(mesh.geometry, material);
    }

    shell.userData[OUTLINE_TAG] = true;
    shell.visible = outlinesVisible;
    shell.castShadow = false;
    shell.receiveShadow = false;
    shell.frustumCulled = false;
    // Parented to the mesh, so it inherits every transform for free — including
    // the squash-and-stretch the players apply to themselves.
    mesh.add(shell);
    outlineShells.push(shell);
  }
}
