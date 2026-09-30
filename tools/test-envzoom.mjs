// Per-10ms peak envelope of the first 2 s of sample-e1m1-30s.wav +
// correlation with file-truth key-on times (ticks*7.143ms).
import fs from 'node:fs';
const wav = fs.readFileSync(new URL('../tools/sample-e1m1-30s.wav', import.meta.url));
let off = 12, dataOff = 0;
while (off < wav.length) {
  const id = wav.toString('ascii', off, off + 4), sz = wav.readUInt32LE(off + 4);
  if (id === 'data') { dataOff = off + 8; break; }
  off += 8 + sz;
}
const SR = 11025;
const S = 110; // 10 ms
const peaks = [];
for (let t = 0; t < 220; t++) { // 2.2 s
  let p = 0;
  for (let i = 0; i < S; i++) {
    const v = Math.abs(wav.readInt16LE(dataOff + (t * S + i) * 4)); // stereo L
    if (v > p) p = v;
  }
  peaks.push(p);
}
console.log('peaks per 10ms (0..2.2s):');
console.log(peaks.join(' '));
// derivative sign changes = articulation count
let arts = 0;
for (let i = 3; i < peaks.length; i++)
  if (peaks[i] > peaks[i - 1] * 1.5 && peaks[i] > 800) { arts++; }
console.log('big positive jumps in 2.2 s:', arts, '(riff alone: ~16 notes + chords)');
