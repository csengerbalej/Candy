/**
 * OGG → WAV, tiszta JS dekóderrel.
 *
 * A Kenney-hangok Ogg Vorbisban jönnek, a Safari viszont azt nem játssza
 * megbízhatóan — a játék pedig iPhone-on is fut. A WAV mindenhol megy, és a
 * kiadó is kiszolgálja (a `model/gltf-binary`-t és az `audio/mp4`-et nem).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis';

const [, , ...args] = process.argv;
const decoder = new OggVorbisDecoder();
await decoder.ready;

function wav(channels, rate) {
  const n = channels[0].length;
  const ch = channels.length;
  const bytes = n * ch * 2;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * ch * 2, 28);
  buf.writeUInt16LE(ch * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(bytes, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      buf.writeInt16LE(Math.round(v * 32767), o);
      o += 2;
    }
  }
  return buf;
}

for (let i = 0; i < args.length; i += 2) {
  const src = args[i];
  const dst = args[i + 1];
  const { channelData, sampleRate } = await decoder.decodeFile(readFileSync(src));
  // MONÓBA keverve: egy fél másodperces kattanás sztereóban kétszer akkora,
  // és a térbeliségét úgyis a játék adja, nem a felvétel.
  const mono =
    channelData.length === 1
      ? channelData
      : [channelData[0].map((v, i) => (v + channelData[1][i]) / 2)];
  writeFileSync(dst, wav(mono, sampleRate));
  console.log(`${src.split('/').pop()} -> ${dst.split('/').pop()}  ${(channelData[0].length / sampleRate).toFixed(2)} mp`);
  decoder.reset && (await decoder.reset());
}
decoder.free();
