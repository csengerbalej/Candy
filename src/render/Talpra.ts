import * as THREE from 'three';

/** Amit a mérés talált: a talp és a fejtető magassága a modell tokjában. */
export interface Talpmeres {
  /** A legalsó pont a felállítás ELŐTT. Ennyivel kellett emelni. */
  talp: number;
  /**
   * A fejtető a TOK SAJÁT koordinátáiban — ide való a szem.
   *
   * Nem a padlótól mért magasság: a szem a tok gyereke, és a tok emelése a
   * gyerekek helyi koordinátáit nem mozdítja. (Egyszer már elrontottam:
   * a padlótól mért értéket írtam be helyinek, és a szemek nyolcvan
   * centivel a fej fölött lebegtek — ugyanaz a hiba, csak kisebben.)
   */
  fej: number;
}

/**
 * TALPRA ÁLLÍTJA A MODELLT — MÉRÉSSEL, NEM HITTEL.
 *
 * A betöltő a KÖTÉSI PÓZ befoglalójából számolja, hova tegye a modellt, és ez
 * addig jó, amíg a kötési póz és az első képkocka ugyanott áll. A letöltött
 * rigeknél nem áll ott: mérve a Követő talpa a padló alatt 0,78 méteren volt,
 * a Lesőé 0,73-on, sőt a régi Vaké is 0,84-en. Ami ebből látszott, az a test
 * felső fele — és fölötte a szemek, amik nem csontozottak, tehát a helyükön
 * maradtak. Pontosan ez volt a „két szem lebeg a sötétben, test nélkül".
 *
 * A javítás nem tippel a klip tartalmára: LEMÉRI, hol van a test legalsó
 * pontja abban a pózban, amiben tényleg megjelenik — bőrözött csúcsokból,
 * nem a kötési pózból —, és annyival emel. Bármilyen rigre működik, mert
 * nem tud semmit a rigről.
 *
 * Egyszeri költség: néhány száz csúcs egyetlen képkockán, karakterenként.
 *
 * FONTOS: a keverőnek már futnia kellett egyszer (`rig.update(0)`), különben
 * megint a kötési pózt méri — ugyanazt a hibát, csak drágábban.
 */
export function talpraAllit(art: THREE.Object3D, minta = 400): Talpmeres {
  art.updateMatrixWorld(true);

  const v = new THREE.Vector3();
  let also = Infinity;
  let felso = -Infinity;

  // CSAK A CSONTOZOTT TEST SZÁMÍT. A szemek, a jelzések és a tok nem a
  // testhez tartoznak, és pont ezek rontanák el a mérést.
  const testek: THREE.SkinnedMesh[] = [];
  art.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) testek.push(o as THREE.SkinnedMesh);
  });
  if (!testek.length) return { talp: 0, fej: 0 };

  for (const test of testek) {
    const pos = test.geometry.attributes.position;
    const lepes = Math.max(1, Math.floor(pos.count / minta));
    for (let i = 0; i < pos.count; i += lepes) {
      test.getVertexPosition(i, v);
      test.localToWorld(v);
      art.worldToLocal(v);
      if (v.y < also) also = v.y;
      if (v.y > felso) felso = v.y;
    }
  }

  if (!Number.isFinite(also)) return { talp: 0, fej: 0 };
  art.position.y -= also;
  return { talp: also, fej: felso };
}
