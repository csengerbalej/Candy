/**
 * Textúra-leltár: minden GLB-ben szereplő kép valódi felbontása, formátuma és
 * mérete, csatorna szerint (alapszín / normál / fém-érdesség / …).
 *
 * Az inspect-glb.mjs csak azt mondja meg, HOGY van-e textúra; ez azt, hogy
 * MEKKORA. A texel/méter arányhoz kell, ami az egyetlen becsületes mérőszám:
 * egy 2K lap egy 143 méteres falun más, mint egy 1,9 méteres karakteren.
 *
 *   node tools/texture-report.mjs raw/village.glb public/models/village.json
 */
import { readFileSync } from 'node:fs';

/** A .json csomagolás base64-ben hordozza a GLB-t; csomagoljuk ki menet közben. */
function loadGlb(path) {
  if (path.endsWith('.json')) return Buffer.from(JSON.parse(readFileSync(path, 'utf8')).glb, 'base64');
  return readFileSync(path);
}

/** Fejlécből olvasott képméret — nem dekódoljuk a képet, csak a méretmezőt. */
function imageSize(buf) {
  // PNG: IHDR a 16. bájttól
  if (buf[0] === 0x89 && buf[1] === 0x50) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  // WEBP: RIFF….WEBP, utána VP8 / VP8L / VP8X blokk
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X') return [(buf.readUIntLE(24, 3) & 0xffffff) + 1, (buf.readUIntLE(27, 3) & 0xffffff) + 1];
    if (kind === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1];
    }
    if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  }
  // JPEG: az első SOFn keret
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const marker = buf[o + 1];
      const len = buf.readUInt16BE(o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return [buf.readUInt16BE(o + 7), buf.readUInt16BE(o + 5)];
      o += 2 + len;
    }
  }
  return [0, 0];
}

function report(path) {
  const buf = loadGlb(path);
  let offset = 12, json = null, bin = null;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(start, start + len).toString('utf8'));
    else bin = buf.subarray(start, start + len);
    offset = start + len;
  }

  // Melyik kép melyik csatornán ül? A textúra → kép indirekción át követjük.
  // A webp az EXT_texture_webp kiterjesztésben tartja a forrást, nem a `source`
  // mezőben — enélkül minden lebaked textúra „nem hivatkozott"-nak látszana.
  const imageOf = (texIndex) => {
    const t = json.textures?.[texIndex];
    if (!t) return -1;
    if (t.source !== undefined) return t.source;
    for (const ext of Object.values(t.extensions ?? {})) if (ext?.source !== undefined) return ext.source;
    return -1;
  };
  const role = new Map();
  const tag = (idx, name) => {
    if (idx < 0) return;
    role.set(idx, [...(role.get(idx) ?? []), name]);
  };
  for (const m of json.materials ?? []) {
    const p = m.pbrMetallicRoughness ?? {};
    if (p.baseColorTexture) tag(imageOf(p.baseColorTexture.index), 'alapszín');
    if (p.metallicRoughnessTexture) tag(imageOf(p.metallicRoughnessTexture.index), 'fém-érdesség');
    if (m.normalTexture) tag(imageOf(m.normalTexture.index), 'normál');
    if (m.emissiveTexture) tag(imageOf(m.emissiveTexture.index), 'emisszió');
    if (m.occlusionTexture) tag(imageOf(m.occlusionTexture.index), 'takarás');
  }

  console.log(`\n=== ${path}  (${(buf.length / 1e6).toFixed(2)} MB)`);
  let total = 0;
  (json.images ?? []).forEach((img, i) => {
    const view = json.bufferViews[img.bufferView];
    const data = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const [w, h] = imageSize(data);
    total += view.byteLength;
    const kind = (role.get(i) ?? ['— nem hivatkozott —']).join('+');
    console.log(
      `  #${i} ${String(kind).padEnd(16)} ${String(w).padStart(5)}×${String(h).toString().padEnd(5)}` +
        ` ${(img.mimeType ?? '?').replace('image/', '').padEnd(5)} ${(view.byteLength / 1e6).toFixed(2)} MB`
    );
  });
  console.log(`  textúra összesen ${(total / 1e6).toFixed(2)} MB`);
}

for (const p of process.argv.slice(2)) report(p);
