// Capture real register traffic in the first 3 s: verify keyoff (B0 without
// 0x20) actually gets written when notes end, and B0/C0 values are sane.
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
const hookSrc = `
  var _reglog = [];
  var __origWasm = null;
  Object.defineProperty(this, '_noop', { value: 0 });
`;
// simplest: wrap wasm after init — patch oplWrite body via string replace
src = src.replace('function oplWrite(reg, val) {\n    wasm.opl_write_reg(reg, val);',
  'function oplWrite(reg, val) {\n    if (typeof _reglog !== "undefined" && _reglog.length < 6000) _reglog.push([Math.round(songUs / 1000), reg, val]);\n    wasm.opl_write_reg(reg, val);');
src = src.replace('var musL = new Float64Array', 'var _reglog = [];\n  var musL = new Float64Array');
src = src.replace('var api = { init: init', 'var api = { _reglog: _reglog, init: init');
vm.runInContext(src, sandbox, { filename: 'src/opl.js' });
const OPL = sandbox.OPLMusic;
await OPL.init('src/opl2.wasm', 49716);
OPL.play('E1M1', sandbox.ASSETS.music.E1M1, true);
const SR = 49716;
for (let b = 0; b < Math.floor(SR * 3 / 512); b++) { OPL.newBlock(); for (let i = 0; i < 512; i++) OPL.next(); }
const rl = OPL._reglog;
console.log('total writes 0-3s:', rl.length);
const cnt = {};
rl.forEach(r => { const hi = (r[1] & 0xf0).toString(16); cnt[hi] = (cnt[hi] || 0) + 1; });
console.log('writes by reg hi-nibble:', JSON.stringify(cnt));
const b0 = rl.filter(r => (r[1] & 0xf0) === 0xb0);
console.log('B0 events (first 16):', b0.slice(0, 16).map(r => `${r[0]}ms:${r[1].toString(16)}=${r[2].toString(16)}`).join(' '));
const keyons = b0.filter(r => r[2] & 0x20).length, keyoffs = b0.filter(r => !(r[2] & 0x20)).length;
console.log('B0 key-ons:', keyons, 'key-offs:', keyoffs);
const a0 = rl.filter(r => (r[1] & 0xf0) === 0xa0);
console.log('A0 writes (first 12):', a0.slice(0, 12).map(r => `${r[0]}ms:${r[1].toString(16)}=${r[2]}`).join(' '));
