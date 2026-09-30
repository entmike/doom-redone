// What instrument do channels 0-2 use, and does our lookup match choco's?
// Also: synthesize program 29/30/34 patches alone with a fixed riff so the
// user can A/B which one sounds wrong at 8s.
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
const g = Buffer.from(sandbox.ASSETS.genmidi, 'base64');
console.log('lump len', g.length, '= 8 + 175*68 +', g.length - (8 + 175 * 68), 'trailing');
// names: main names should follow ALL instrument data (choco layout), or per-instr?
// choco: instrs[175] packed 36B, then main_instr_names[128]+percussion_names[47] of 32B.
const dataEnd = 8 + 175 * 36;
const latin = g.slice(dataEnd).toString('latin1');
console.log('first name after data:', JSON.stringify(latin.slice(0, 32).replace(/\x00+$/, '')));
console.log('name[128] (first percussion):', JSON.stringify(latin.slice(128 * 32, 128 * 32 + 32).replace(/\x00+$/, '')));
console.log('name[30] :', JSON.stringify(latin.slice(30 * 32, 30 * 32 + 32).replace(/\x00+$/, '')));
console.log('name[29] :', JSON.stringify(latin.slice(29 * 32, 29 * 32 + 32).replace(/\x00+$/, '')));
console.log('name[34] :', JSON.stringify(latin.slice(34 * 32, 34 * 32 + 32).replace(/\x00+$/, '')));
