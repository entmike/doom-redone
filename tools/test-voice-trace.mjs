// Full register trace for ONE voice over first 600 ms, with decoded B0 fields.
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
src = src.replace('function oplWrite(reg, val) {\n    wasm.opl_write_reg(reg, val);',
  'function oplWrite(reg, val) {\n    if (_reglog.length < 8000) _reglog.push([Math.round(songUs / 1000), reg, val]);\n    wasm.opl_write_reg(reg, val);');
src = src.replace('var musL = new Float64Array', 'var _reglog = [];\n  var musL = new Float64Array');
src = src.replace('var api = { init: init', 'var api = { _reglog: _reglog, init: init');
vm.runInContext(src, sandbox, { filename: 'src/opl.js' });
const OPL = sandbox.OPLMusic;
await OPL.init('src/opl2.wasm', 49716);
OPL.play('E1M1', sandbox.ASSETS.music.E1M1, true);
const SR = 49716;
for (let b = 0; b < Math.floor(SR * 0.6 / 512); b++) { OPL.newBlock(); for (let i = 0; i < 512; i++) OPL.next(); }
const rl = OPL._reglog;
// which A0/A1... registers fire repeatedly (the riff voice)?
const a = rl.filter(r => (r[1] & 0xf0) === 0xa0);
const byReg = {};
a.forEach(r => { const k = r[1] - 0xa0; byReg[k] = (byReg[k] || 0) + 1; });
console.log('A0 writes per voice index:', JSON.stringify(byReg));
// dump everything for voice 0 and 1 (regs index%0x0f == 0/1... careful: a0+idx, b0+idx, c0+op1/c0+op2 with op sets (0,3)(1,4)(2,5)(6,9)(7,10)(8,11))
for (const vi of [0]) {
  console.log(`--- all writes touching voice ${vi} (0..600ms) ---`);
  rl.filter(r => {
    const idx = r[1] & 0x0f;
    if ((r[1] & 0xf0) === 0xa0 || (r[1] & 0xf0) === 0xb0) return idx === vi;
    if ((r[1] & 0xf0) === 0xc0 || (r[1] & 0xf0) === 0xe0 || (r[1] & 0xf0) === 0x20 || (r[1] & 0xf0) === 0x40 || (r[1] & 0xf0) === 0x60 || (r[1] & 0xf0) === 0x80) {
      const opers = [[0, 3], [1, 4], [2, 5], [6, 9], [7, 10], [8, 11], [12, 15], [13, 16], [14, 17]];
      return vi < opers.length && (opers[vi][0] === idx || opers[vi][1] === idx);
    }
    if ((r[1] & 0xf0) === 0xc0 && false) return false;
    return false;
  }).forEach(r => {
    let dec = '';
    if ((r[1] & 0xf0) === 0xb0) dec = r[2] & 0x20 ? ` KEYON block=${(r[2] >> 2) & 7} fhi=${r[2] & 3}` : ` keyoff block=${(r[2] >> 2) & 7} fhi=${r[2] & 3}`;
    console.log(`${String(r[0]).padStart(4)}ms reg=${r[1].toString(16).padStart(2, '0')} val=${r[2].toString(16).padStart(2, '0')}${dec}`);
  });
}
