// Envelope of first 3 s of rendered E1M1: is ANY energy before the first
// detected onset at 2.136s? Plus what instrument registers got written.
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
vm.runInContext(fs.readFileSync(root + 'assets/audio.js', 'utf8'), sandbox);
let src = fs.readFileSync(root + 'src/opl.js', 'utf8');
// log every register write with song time
src = src.replace('function oplWrite(', `var _reglog = [];
  var _origOplWrite = null;
  function oplWriteLogged(reg, val) { if (_reglog.length < 4000) _reglog.push([Math.round(songUs/1000), reg, val]); }
  function oplWrite(`);
src = src.replace('var api = { init: init', 'var api = { _reglog: _reglog, init: init');
vm.runInContext(src, sandbox, { filename: 'src/opl.js' });
const OPL = sandbox.OPLMusic;
await OPL.init('src/opl2.wasm', 49716);
OPL.play('E1M1', sandbox.ASSETS.music.E1M1, true);
const SR = 49716;
const out = new Int16Array(SR * 3);
for (let b = 0; b < Math.floor(SR * 3 / 512); b++) { OPL.newBlock(); for (let i = 0; i < 512; i++) { const s = OPL.next(); out[b * 512 + i] = s[0]; } }
// rms per 100 ms
const seg = [];
for (let t = 0; t < 30; t++) {
  let s = 0;
  for (let i = t * 1102; i < (t + 1) * 1102; i++) s += out[i] * out[i];
  seg.push(Math.round(Math.sqrt(s / 1102)));
}
console.log('rms per 100ms (0..2.9s):', seg.join(' '));
// register writes in first 3 s: A0/B0 keyons and C0 levels
const rl = OPL._reglog;
const a0 = rl.filter(r => (r[1] & 0xf0) === 0xa0), b0 = rl.filter(r => (r[1] & 0xf0) === 0xb0), c0 = rl.filter(r => (r[1] & 0xf0) === 0xc0);
console.log('A0 writes:', a0.length, a0.slice(0, 6).map(r => `${r[0]}ms:R${r[1].toString(16)}=${r[2]}`).join(' '));
console.log('B0 keyons:', b0.length, b0.slice(0, 6).map(r => `${r[0]}ms:R${r[1].toString(16)}=${r[2].toString(16)}`).join(' '));
console.log('C0 levels:', c0.length, c0.slice(0, 8).map(r => `${r[0]}ms:R${r[1].toString(16)}=${r[2].toString(16)}`).join(' '));
