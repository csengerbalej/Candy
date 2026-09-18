import { readFileSync } from 'node:fs';
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis';
const d = new OggVorbisDecoder();
await d.ready;
for (const f of process.argv.slice(2)) {
  const { channelData, sampleRate } = await d.decodeFile(readFileSync(f));
  const x = channelData[0];
  let peak = 0, sum = 0;
  for (const v of x) { const a = Math.abs(v); peak = Math.max(peak, a); sum += a; }
  // Mennyi idő alatt cseng le a csúcs tizedére: ebből látszik, "kattanás"-e vagy "dörrenés".
  let fall = x.length;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= peak) { 
    for (let j = i; j < x.length; j++) if (Math.abs(x[j]) < peak * 0.1) { fall = j - i; break; }
    break;
  }
  console.log(`${f.split('/').pop().padEnd(28)} ${(x.length/sampleRate).toFixed(2)}mp csucs=${peak.toFixed(2)} atlag=${(sum/x.length).toFixed(3)} lecsenges=${(fall/sampleRate*1000).toFixed(0)}ms`);
  await d.reset();
}
d.free();
