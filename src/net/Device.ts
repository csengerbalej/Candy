/**
 * Ennek az ESZKÖZNEK az azonosítója.
 *
 * Nem a fülé: a `peer` már az, és pont az a baj vele, hogy ugyanannak az
 * embernek a két megnyitott lapja két peer. Ez viszont a böngésző tárolójában
 * él, tehát ugyanazon a gépen minden lap ugyanazt mondja — ebből lehet
 * megállapítani, hogy „ez ugyanaz a készülék, nem egy második játékos".
 *
 * Ha a tároló nem elérhető (privát ablak, letiltott sütik), marad egy
 * futásidejű véletlen szám. Ilyenkor a két lap megint két eszköznek látszik —
 * de ez a rosszabbik eset, nem az alapeset, és nem is dől el tőle semmi más.
 */
const KEY = 'cp.device';

function make(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

let cached: string | null = null;

export function deviceId(): string {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) {
      cached = stored;
      return cached;
    }
    const fresh = make();
    localStorage.setItem(KEY, fresh);
    cached = fresh;
    return cached;
  } catch {
    cached = make();
    return cached;
  }
}
