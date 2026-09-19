import * as THREE from 'three';
import { repairTextures } from './textureRepair';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export interface FitOptions {
  /** Desired size along the model's longest horizontal axis, in game units. */
  length?: number;
  /** Desired height, in game units. Use this for characters; `length` for vehicles. */
  height?: number;
  /** Extra Y rotation, in radians, to bring the model's nose onto +Z. */
  yaw?: number;
  /** Sit the model on the ground plane instead of centring it vertically. */
  onGround?: boolean;
}

/**
 * Loads a GLB and normalises it into game space.
 *
 * Authored assets arrive at whatever scale and facing the tool felt like —
 * these two are ~1.9 units long and face +X. Every consumer would otherwise
 * repeat the same guesswork, so it happens exactly once, here.
 */
export class ModelLoader {
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<LoadedModel>>();
  private readonly clipCache = new Map<string, Promise<THREE.AnimationClip[]>>();

  load(url: string): Promise<LoadedModel> {
    let pending = this.cache.get(url);
    if (!pending) {
      pending = this.fetchModel(url);
      this.cache.set(url, pending);
    }
    return pending;
  }

  /**
   * Models ship as base64 inside JSON rather than as raw .glb, because the
   * publish host only serves standard web media types and model/gltf-binary is
   * not one. Decoding here keeps every caller unaware of it.
   */
  private async fetchModel(url: string): Promise<LoadedModel> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const { glb } = (await response.json()) as { glb: string };

    const binary = atob(glb);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(
      (resolve, reject) => {
        this.loader.parse(
          bytes.buffer,
          '',
          (result) =>
            resolve({ scene: result.scene as THREE.Group, animations: result.animations }),
          reject
        );
      }
    );
    // A kiadott oldal házirendje elnyelheti a beágyazott képeket; ha ez történt,
    // itt kapjuk vissza őket. Lásd `repairTextures`.
    await repairTextures(bytes.buffer, gltf.scene);
    return gltf;
  }

  /** Animation clips from a GLB that carries nothing else. */
  clips(url: string): Promise<THREE.AnimationClip[]> {
    let pending = this.clipCache.get(url);
    if (!pending) {
      pending = this.fetchClips(url);
      this.clipCache.set(url, pending);
    }
    return pending;
  }

  private async fetchClips(url: string): Promise<THREE.AnimationClip[]> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const { glb } = (await response.json()) as { glb: string };
    const binary = atob(glb);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Promise((resolve, reject) => {
      this.loader.parse(bytes.buffer, '', (gltf) => resolve(gltf.animations), reject);
    });
  }

  /** Clips shipped inside the base model itself. */
  async ownClips(url: string): Promise<THREE.AnimationClip[]> {
    return (await this.load(url)).animations;
  }

  /** A fresh, normalised instance. Geometry and textures stay shared. */
  async instance(url: string, fit: FitOptions): Promise<THREE.Group> {
    const { scene: source } = await this.load(url);
    // A plain clone() copies bones as ordinary children and leaves the new
    // SkinnedMesh bound to the ORIGINAL skeleton, so two players would share
    // one pose. SkeletonUtils rebinds each copy to its own bones.
    const model = cloneSkinned(source) as THREE.Group;

    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    if (fit.yaw) model.rotation.y = fit.yaw;

    // Measure AFTER the yaw, so `length` always means "along the model's nose".
    //
    // A CSONTOZOTT HÁLÓT A CSONTVÁZÁVAL EGYÜTT KELL MÉRNI.
    //
    // A `Box3.setFromObject` a geometria nyers befoglalóját veszi, és a
    // háló saját mátrixával szorozza — a csontok méretezéséről viszont nem
    // tud. A letöltött rigekben az armatúra gyakran visz egy szorzót, és
    // ilyenkor a mért magasság sokszorosa vagy törtrésze a valódinak. A
    // következménye pontosan az volt, amit a képen látni: háznyi szörny.
    //
    // A `SkinnedMesh.computeBoundingBox` a CSONTOK állását is beleszámolja,
    // tehát azt méri, ami tényleg megjelenik.
    model.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    let volt = false;
    model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      if (mesh.isSkinnedMesh && typeof mesh.computeBoundingBox === 'function') {
        mesh.computeBoundingBox();
        if (mesh.boundingBox) {
          box.union(mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
          volt = true;
          return;
        }
      }
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) {
        box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
        volt = true;
      }
    });
    if (!volt) box.setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale =
      fit.height !== undefined
        ? fit.height / size.y
        : (fit.length ?? 1) / Math.max(size.x, size.z);
    model.scale.setScalar(scale);

    // Re-measure and re-centre: scaling moves the box. Ugyanazzal a
    // módszerrel, különben a középre igazítás mást mérne, mint a méretezés.
    model.updateWorldMatrix(true, true);
    const scaled = box.clone().applyMatrix4(
      new THREE.Matrix4().makeScale(scale, scale, scale)
    );
    const centre = new THREE.Vector3();
    scaled.getCenter(centre);
    model.position.x -= centre.x;
    model.position.z -= centre.z;
    model.position.y -= fit.onGround === false ? centre.y : scaled.min.y;

    // A group wrapper keeps the caller's transform separate from the fit.
    const wrapper = new THREE.Group();
    wrapper.add(model);
    return wrapper;
  }
}

export const models = new ModelLoader();
