/**
 * KÖZÖS VÉLETLEN: ugyanaz a sorsolás két gépen.
 *
 * A fogó pálya sorsolással születik — hatvan pontból a két legtávolabbi lesz
 * a gyűjtősarok, negyven másikra kerülnek a fegyverek. Egy gépen ez pont jó:
 * minden kör más. KÉT gépen viszont katasztrófa, mert a `Math.random` a két
 * gépen mást ad: a te sarkod a konyhában volna, a társadé a fürdőben, és
 * mindketten meg volnátok győződve róla, hogy a másik csal.
 *
 * A megoldás nem az, hogy a gazda átküldi a pályát — az csomag, ami
 * elveszhet, és amire várni kell. Hanem hogy MINDKÉT GÉP UGYANAZT SORSOLJA:
 * ha a véletlenszám-generátor ugyanabból a magból indul, ugyanazt a sorozatot
 * adja. A mag pedig kéznél van — a szoba résztvevőinek azonosítója mindkét
 * gépen ugyanaz, csak rendezni kell.
 *
 * A generátor mulberry32: harminc sornyi, gyors, és egyenletes. Kriptográfiára
 * alkalmatlan, de itt nem titkot őrzünk, hanem egy szobát rendezünk be.
 */
export function makeRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
