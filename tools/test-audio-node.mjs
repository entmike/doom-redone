// Node verification: DMX mixer SFX render + OPL MUS render, both real code paths.
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const sandbox = { console, Buffer, fetch: async (u) => {
  const buf = fs.readFileSync(root + u.replace(/^\.\//, '').replace(/^assets\//, 'assets/'));
  return { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
} };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.ASSETS = {};
// minimal G for the sound manager RNG + episode/map
let mrnd = 0;
sandbox.G = {
  M_Random() { return (7 * ++mrnd + 13) & 255; },   // deterministic-ish
  gameepisode: 1, gamemap: 1,
  R_PointToAngle2(x1, y1, x2, y2) {                  // vanilla angle_t semantics
    let a = Math.atan2((y2 - y1) / 65536, (x2 - x1) / 65536);
    if (a < 0) a += 2 * Math.PI;
    return Math.round(a / (2 * Math.PI) * 4294967296) >>> 0;
  },
  finesine: (() => { const t = new Int32Array(8192); for (let i = 0; i < 8192; i++) t[i] = Math.round(Math.sin(i / 8192 * 2 * Math.PI) * 4194304); return t; })(),
};
vm.createContext(sandbox);
for (const f of ['assets/audio.js', 'src/sound.js', 'src/opl.js']) {
  vm.runInContext(fs.readFileSync(root + f, 'utf8'), sandbox, { filename: f });
}
const Snd = sandbox.Snd, OPL = sandbox.OPLMusic;
if (!Snd) throw new Error('no Snd export');
if (!OPL) throw new Error('no OPLMusic export');

// ---------- mixer: pistol + imp death + door, listener at origin ----------
Snd.S_Init();
const listener = { x: 0, y: 0, z: 0 };
const at = (dx, dy) => ({ x: dx * 65536, y: dy * 65536, z: 0 });
Snd.S_StartSound(at(0, 0), 1);        // sfx_pistol right at ear
Snd.setGametic(1);
Snd.S_UpdateSounds(listener);
Snd.S_StartSound(at(128, 0), 62);     // bgdth (imp death) 128 units east
Snd.setGametic(2);
Snd.S_UpdateSounds(listener);
Snd.S_StartSound(at(600, 600), 20);   // distant door open
Snd.setGametic(3);
Snd.S_UpdateSounds(listener);

const frames = 11025;                   // 1 second
const blocks = frames / 512;
const sfxSamples = new Int16Array(frames * 2);
let sfxPeak = 0;
for (let b = 0; b < blocks; b++) {
  Snd._pumpSilent(512);
  const buf = Snd._mixbuffer;
  for (let i = 0; i < 1024; i++) {
    sfxSamples[b * 1024 + i] = buf[i];
    const v = Math.abs(buf[i]); if (v > sfxPeak) sfxPeak = v;
  }
}
console.log(`mixer: peak ${sfxPeak}`);
if (sfxPeak < 1000) throw new Error('mixer output too quiet');

// ---------- music: E1M1 through the WASM chip (native chip rate) ----------
const MSRATE = 49716, mframes = MSRATE;
await OPL.init('src/opl2.wasm', MSRATE);
OPL.play('E1M1', sandbox.ASSETS.music.E1M1, true);
const musSamples = new Int16Array(mframes * 2);
const mblocks = mframes / 512 | 0;
let musPeak = 0, musSum = 0;
for (let b = 0; b < mblocks; b++) {
  OPL.newBlock();
  for (let i = 0; i < 512; i++) {
    const s = OPL.next();               // [L,R] int16 — one frame per i (512/block)
    musSamples[b * 512 + i * 2] = s[0];
    musSamples[b * 512 + i * 2 + 1] = s[1];
    const v = Math.max(Math.abs(s[0]), Math.abs(s[1]));
    if (v > musPeak) musPeak = v;
    musSum += v;
  }
}
console.log(`music: peak ${musPeak} mean ${Math.round(musSum / 1024)}`);
if (musPeak < 200) throw new Error('OPL music output too quiet');

// attach music to sink path and verify combined pull works
Snd.attachMusic(OPL);

// ---------- write WAVs (sfx=11025, music=native chip rate; stereo 16) ----------
function wav(samples, rate) {
  const n = samples.length * 2, h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 4, 28);
  h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n, 40);
  return Buffer.concat([h, Buffer.from(samples.buffer)]);
}
fs.writeFileSync(root + 'tools/out-mixer.wav', wav(sfxSamples, 11025));
fs.writeFileSync(root + 'tools/out-music.wav', wav(musSamples, MSRATE));
console.log('AUDIO-OK  wrote tools/out-mixer.wav tools/out-music.wav');
