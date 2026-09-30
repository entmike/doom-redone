// Dump: instrument 29 data (ch1's patch), instrument percussion ~key40 data,
// and C0 level writes for ch1-voice vs perc-voice in first 3 s.
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
const bin = Buffer.from(sandbox.ASSETS.genmidi, 'base64');
const hex = (b) => [...b].map(x => x.toString(16).padStart(2, '0')).join(' ');
for (const i of [29, 34, 0]) {
  const off = 8 + i * 36;
  console.log(`instr[${i}] @${off}: ${hex(bin.slice(off, off + 36))}`);
  const v0 = bin.slice(off + 4, off + 20);
  console.log(`  v0 mod[am,vib,ksr,frq,mul,level]=${hex(v0.slice(0, 6))} fb=${v0[6].toString(16)} car[am,vib,ksr,frq,mul,level]=${hex(v0.slice(7, 13))} wave=${v0[13].toString(16)} off=${v0.readInt16LE(14)}`);
}
let src = fs.readFileSync(root + 'src/opl.js', 'utf8');
src = src.replace('function oplWrite(reg, val) {\n    wasm.opl_write_reg(reg, val);',
  'function oplWrite(reg, val) {\n    if (_reglog.length < 9000) _reglog.push([Math.round(songUs / 1000), reg, val]);\n    wasm.opl_write_reg(reg, val);');
src = src.replace('var musL = new Float64Array', 'var _reglog = [];\n  var musL = new Float64Array');
src = src.replace('var api = { init: init', 'var api = { _reglog: _reglog, init: init');
vm.runInContext(src, sandbox, { filename: 'src/opl.js' });
const OPL = sandbox.OPLMusic;
await OPL.init('src/opl2.wasm', 49716);
OPL.play('E1M1', sandbox.ASSETS.music.E1M1, true);
const SR = 49716;
for (let b = 0; b < Math.floor(SR * 3 / 512); b++) { OPL.newBlock(); for (let i = 0; i < 512; i++) OPL.next(); }
// C0 writes per operator
const c0 = OPL._reglog.filter(r => (r[1] & 0xf0) === 0xc0);
const per = {};
c0.forEach(r => { const k = (r[1] - 0xc0).toString(); per[k] = (per[k] || []).concat(r[2]); });
console.log('C0 writes per operator (vals):');
Object.keys(per).sort((a, b) => a - b).forEach(k => console.log(` op${k}: n=${per[k].length} distinct=${[...new Set(per[k])].map(v => '0x' + v.toString(16)).join(',')}`));
