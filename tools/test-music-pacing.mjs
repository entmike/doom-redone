// Render E1M1 through the REAL player path -> stereo 16-bit 11025 WAV for
// human listening + objective onset measurement (file truth: riff note every
// 19 ticks = 135.7 ms @140Hz).
import fs from 'node:fs';
import vm from 'node:vm';
const root = new URL('..', import.meta.url).pathname;
const sandbox = { console, Buffer, atob: s => Buffer.from(s, 'base64').toString('binary'),
  fetch: async (u) => {
    const buf = fs.readFileSync(root + u.replace(/^\.\//, ''));
    return { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  } };
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.ASSETS = {};
vm.createContext(sandbox);
for (const f of ['assets/audio.js', 'src/opl.js']) {
  vm.runInContext(fs.readFileSync(root + f, 'utf8'), sandbox, { filename: f });
}
const OPL = sandbox.OPLMusic;
await OPL.init('src/opl2.wasm', 49716);
OPL.play('E1M1', sandbox.ASSETS.music.E1M1, true);
const SR = 49716, SECS = Number(process.argv[2] || 20);
const out = new Int16Array(SR * SECS * 2);
const blocks = Math.floor(SR * SECS / 512);
for (let b = 0; b < blocks; b++) {
  OPL.newBlock();
  for (let i = 0; i < 512; i++) {
    const s = OPL.next();               // exactly one frame per call
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
const outPath = root + `tools/sample-e1m1-${SECS}s.wav`;
fs.writeFileSync(outPath, wav(out, SR));
// mono view for onset analysis
const mono = new Int16Array(SR * SECS);
for (let i = 0; i < SR * SECS; i++) mono[i] = out[i * 2];
const F = 256, frames = Math.floor(mono.length / F);
const env = new Float64Array(frames);
for (let f = 0; f < frames; f++) {
  let s = 0;
  for (let i = 0; i < F; i++) { const v = mono[f * F + i]; s += v * v; }
  env[f] = Math.sqrt(s / F);
}
const onsets = [];
for (let f = 2; f < frames; f++) {
  if (env[f] > 800 && env[f] > env[f - 1] * 1.7) {
    const t = f * F / SR;
    if (!onsets.length || t - onsets[onsets.length - 1] > 0.035) onsets.push(t);
  }
}
const gaps = [];
for (let i = 1; i < Math.min(onsets.length, 500); i++) gaps.push(onsets[i] - onsets[i - 1]);
gaps.sort((a, b) => a - b);
console.log('wrote', outPath, `(${(fs.statSync(outPath).size / 1024).toFixed(0)} KB, ${SECS} s)`);
console.log('onsets:', onsets.length, '| first 12 (s):', onsets.slice(0, 12).map(x => x.toFixed(3)).join(' '));
console.log('median onset gap:', (gaps[gaps.length >> 1] * 1000).toFixed(0), 'ms | truth: ~136 ms (19 ticks @140Hz)');

// --- envelope autocorrelation in the riff region (16-32 s) ---
const a0 = Math.floor(16 * SR / F) * F, a1 = Math.floor(32 * SR / F) * F;
const ef = [];
for (let f = Math.floor(a0 / F); f < Math.floor(a1 / F); f++) ef.push(env[f]);
const mean = ef.reduce((x, y) => x + y, 0) / ef.length;
const ac = new Float64Array(200);
for (let lag = 1; lag < 200; lag++) {
  let s = 0;
  for (let i = 0; i + lag < ef.length; i++) s += (ef[i] - mean) * (ef[i + lag] - mean);
  ac[lag] = s;
}
const lagMs = l => (l * F / SR * 1000);
let peak1 = 1;
for (let l = 2; l < 200; l++) if (ac[l] > ac[peak1]) peak1 = l;
console.log('envelope autocorr peak lag:', peak1, '=', lagMs(peak1).toFixed(1), 'ms | expect 122ms (13t dur/140Hz) or 244ms if 2x slow; riff grid 135.7ms');
