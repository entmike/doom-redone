// Instrumented run: hook parseMus outputs? parseMus isn't exported. Instead:
// monkey-patch via vm — re-run opl.js source with instrumentation appended
// that exposes internal event flow through the api object.
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
// expose internals for diagnostics: append before the api export
src = src.replace('var api = { init: init', `var _trace = { keyons: [], allocs: 0, nulls: 0 };
  var _origKeyOn = KeyOnEvent;
  KeyOnEvent = function(ch, key, vol) { if (_trace.keyons.length < 500) _trace.keyons.push([Math.round(songUs/1000), ch, key, vol]); return _origKeyOn(ch, key, vol); };
  var api = { _trace: _trace, init: init`);
vm.runInContext(src, sandbox, { filename: 'src/opl.js' });
const OPL = sandbox.OPLMusic;
await OPL.init('src/opl2.wasm', 49716);
OPL.play('E1M1', sandbox.ASSETS.music.E1M1, true);
const SR = 49716;
for (let b = 0; b < Math.floor(SR * 3 / 512); b++) { OPL.newBlock(); for (let i = 0; i < 512; i++) OPL.next(); }
const t = OPL._trace;
console.log('key-ons in first 3 s (songMs, midiCh, key, vel):');
console.log(t.keyons.map(k => k.join('/')).join('\n') || '(NONE)');
const byCh = {};
t.keyons.forEach(k => byCh[k[1]] = (byCh[k[1]] || 0) + 1);
console.log('per MIDI channel:', JSON.stringify(byCh));
