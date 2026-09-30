// Isolate a single percussion key: synthesize one MUS-like key-on at tick 0
// with the exact E1M1 velocity, mute everything else, render 6 s tail so the
// full envelope is audible. usage: node tools/render-perc.mjs <key> <vel> [secs]
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
const root = new URL('..', import.meta.url).pathname;
const KEY = Number(process.argv[2] || 49), VEL = Number(process.argv[3] || 71);
const SECS = Number(process.argv[4] || 6);
const sandbox = { console, Buffer, atob: s => Buffer.from(s, 'base64').toString('binary'),
  fetch: async (u) => {
    const buf = fs.readFileSync(root + u.replace(/^\.\//, ''));
    return { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  } };
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.ASSETS = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(root + 'assets/audio.js', 'utf8'), sandbox);
let src = fs.readFileSync(root + 'src/opl.js', 'utf8');
// expose parse + synthetic-song hook: replace the play() song source when name==='PERC'
src = src.replace("songEvents = parseMus", "songEvents = (name === 'PERC') ? PERCSONG : parseMus");
src = src.replace('var api = { init: init', 'var PERCSONG = [];\n  var api = { setPercSong: function (s) { PERCSONG = s; }, init: init');
vm.runInContext(src, sandbox, { filename: 'src/opl.js' });
const OPL = sandbox.OPLMusic;
await OPL.init('src/opl2.wasm');
// one MUS-style: patch for ch9 irrelevant; note-on ch9, no note-off (let envelope run)
OPL.setPercSong([[0, ['on', 9, KEY, VEL]]]);
OPL.play('PERC', sandbox.ASSETS.music.E1M1, true);
const SR = OPL.chipRate || 49716;
const out = new Int16Array(SR * SECS);
for (let b = 0; b < SR * SECS / 512; b++) { OPL.newBlock(); const blk = OPL.next(); for (let i = 0; i < 512; i++) out[b * 512 + i] = blk[0]; }
const h = Buffer.alloc(44); const n = out.length * 2;
h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVE', 8); h.write('fmt ', 12);
h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
h.write('data', 36); h.writeUInt32LE(n, 40);
const d = Buffer.alloc(n);
for (let i = 0; i < out.length; i++) d.writeInt16LE(out[i], i * 2);
const w = root + `tools/perc-key${KEY}.wav`;
fs.writeFileSync(w, Buffer.concat([h, d]));
// envelope profile per 250 ms
const prof = [];
for (let s = 0; s < SECS * 4; s++) {
  let sum = 0; const w0 = Math.floor(s * SR / 4); const w1 = Math.floor((s + 1) * SR / 4);
  for (let i = w0; i < w1 && i < out.length; i++) sum += out[i] * out[i];
  prof.push(Math.round(Math.sqrt(sum / (w1 - w0) || 0)));
}
console.log('key', KEY, 'vel', VEL, 'rms/250ms:', prof.join(' '));
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', w, '-c:a', 'aac', '-b:a', '128k', root + `tools/perc-key${KEY}.m4a`]);
console.log('wrote tools/perc-key' + KEY + '.m4a');
