// Render E1M1 filtered to ONE MUS channel to find which channels are audible.
// usage: node tools/render-channel.mjs <MUSCH|all> <SECS> <out>
import fs from 'node:fs';
import vm from 'node:vm';
const root = new URL('..', import.meta.url).pathname;
const CH = process.argv[2] || 'all', SECS = Number(process.argv[3] || 12);
const OUT = process.argv[4] || root + `tools/sample-ch${CH}.wav`;
const sandbox = { console, Buffer, atob: s => Buffer.from(s, 'base64').toString('binary'),
  fetch: async (u) => {
    const buf = fs.readFileSync(root + u.replace(/^\.\//, ''));
    return { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  } };
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.ASSETS = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(root + 'assets/audio.js', 'utf8'), sandbox);
let src = fs.readFileSync(root + 'src/opl.js', 'utf8');
// filter parseMus events by MUS channel — instrument parseMus's event tuples:
// events store MIDI-mapped channel, so filter earlier: wrap getMidiChannel to record mus->midi map,
// then filter songEvents after parse via wrapper on play(): simplest = filter in ProcessEvent?
// Events: ["on", midiCh, key, vel] etc. We need musCh: parseMus maps mus_ch -> midi ch
// sequentially; instead filter by midi ch is ambiguous. Do it inside parseMus: tag events with mus channel.
// robust: wrap all parseMus pushes with a tagger that stamps the current MUS ch
src = src.replace('var channel = getMidiChannel(desc & 0x0f);',
  '_curMusCh = desc & 0x0f; var channel = getMidiChannel(_curMusCh);');
src = src.replace('function parseMus(bytes) {',
  'var _curMusCh = -1;\n  function _tag(t, tup) { return [t, tup, _curMusCh]; }\n  function parseMus(bytes) {');
src = src.replace(/events\.push\(\[queuedtime, (\[[^\n]*?\])\]\)/g, 'events.push(_tag(queuedtime, $1))');
// process ev[2] in ProcessEvent to carry tag: events are [tick, tuple, musCh]; scheduler passes ev[1]=tuple; tag is third elem
src = src.replace('ProcessEvent(ev[1]);', `if (CHFILTER === "all" || ev[2] === Number(CHFILTER) || ev[1][0] === "eot") ProcessEvent(ev[1]);`);
src = src.replace('function parseMus(bytes) {', 'var CHFILTER = "all";\n  function parseMus(bytes) {');
src = src.replace('var api = { init: init', 'var api = { setFilter: function (f) { CHFILTER = f; }, init: init');
vm.runInContext(src, sandbox, { filename: 'src/opl.js' });
const OPL = sandbox.OPLMusic;
await OPL.init('src/opl2.wasm', 49716);
OPL.setFilter(CH);
OPL.play('E1M1', sandbox.ASSETS.music.E1M1, true);
const SR = 49716;
const out = new Int16Array(SR * SECS);
for (let b = 0; b < SR * SECS / 512; b++) { OPL.newBlock(); for (let i = 0; i < 512; i++) out[b * 512 + i] = OPL.next()[0]; }
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + out.length * 2, 4); h.write('WAVE', 8); h.write('fmt ', 12);
h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28);
h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(out.length * 2, 40);
fs.writeFileSync(OUT, Buffer.concat([h, Buffer.from(out.buffer)]));
let pk = 0, sum = 0;
for (let i = 0; i < out.length; i++) { pk = Math.max(pk, Math.abs(out[i])); sum += Math.abs(out[i]); }
// rms per 500 ms
const segs = [];
for (let t = 0; t < SECS * 2; t++) {
  let s = 0;
  for (let i = t * SR / 2; i < (t + 1) * SR / 2; i++) s += out[i] * out[i];
  segs.push(Math.round(Math.sqrt(s / (SR / 2))));
}
console.log(`ch=${CH}: peak ${pk} mean ${Math.round(sum / out.length)} | rms per 500ms: ${segs.join(' ')}`);
console.log('wrote', OUT);
