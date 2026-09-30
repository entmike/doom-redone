// Render E1M1 at a given MUS tick rate (Hz) -> WAV for A/B listening.
// usage: node tools/render-music-at.mjs <HZ> <SECS> <outfile>
import fs from 'node:fs';
import vm from 'node:vm';
const root = new URL('..', import.meta.url).pathname;
const HZ = Number(process.argv[2] || 140), SECS = Number(process.argv[3] || 20);
const OUT = process.argv[4] || root + `tools/sample-e1m1-${HZ}hz.wav`;
const sandbox = { console, Buffer, atob: s => Buffer.from(s, 'base64').toString('binary'),
  fetch: async (u) => {
    const buf = fs.readFileSync(root + u.replace(/^\.\//, ''));
    return { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  } };
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.ASSETS = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(root + 'assets/audio.js', 'utf8'), sandbox);
// patch tick rate inside the closure: keep us_per_beat=1e6, ticks=HZ
let src = fs.readFileSync(root + 'src/opl.js', 'utf8')
  .replace('var MUS_TICKS_PER_BEAT = 140;', `var MUS_TICKS_PER_BEAT = ${HZ};`);
vm.runInContext(src, sandbox, { filename: 'src/opl.js' });
const OPL = sandbox.OPLMusic;
await OPL.init('src/opl2.wasm', 49716);
OPL.play('E1M1', sandbox.ASSETS.music.E1M1, true);
const SR = 49716;
const out = new Int16Array(SR * SECS * 2);
const blocks = Math.floor(SR * SECS / 512);
for (let b = 0; b < blocks; b++) {
  OPL.newBlock();
  for (let i = 0; i < 512; i++) {
    const s = OPL.next();
    out[(b * 512 + i) * 2] = s[0];
    out[(b * 512 + i) * 2 + 1] = s[1];
  }
}
function wav(samples, rate) {
  const n = samples.length * 2, h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + out.length * 2, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 4, 28);
  h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n, 40);
  return Buffer.concat([h, Buffer.from(samples.buffer)]);
}
fs.writeFileSync(OUT, wav(out, SR));
const loopSecs = (13440 / HZ).toFixed(1);
console.log(`wrote ${OUT}  (${HZ} Hz: full E1M1 loop would be ${loopSecs} s; rendered first ${SECS} s)`);
