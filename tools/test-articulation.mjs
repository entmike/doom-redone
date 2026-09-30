// Minimal articulation test: drive the OPL player with a synthetic 4-note
// event stream through the real KeyOn/KeyOff path -> WAV + envelope print.
// If this renders distinct decaying notes, chip+voice path is fine and the
// bug lives upstream (song parsing/scheduling). If it drones, chip/envelope.
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
// inject a forced event schedule into play() directly
src = src.replace('var songEvents = null, eventIndex = 0,',
`var TEST_EVENTS = [
    [0,   ["patch", 1, 0]],
    [0,   ["cc", 1, 7, 100]],
    [0,   ["on",  1, 45, 110]],
    [21,  ["off", 1, 45]],
    [42,  ["on",  1, 52, 110]],
    [63,  ["off", 1, 52]],
    [84,  ["on",  1, 57, 110]],
    [105, ["off", 1, 57]],
    [126, ["on",  1, 64, 110]],
    [147, ["off", 1, 64]],
    [280, ["eot"]],
  ];
  var songEvents = null, eventIndex = 0,`);
src = src.replace('songEvents = parseMus(bytes);', 'songEvents = TEST_EVENTS;');
vm.runInContext(src, sandbox, { filename: 'src/opl.js' });
const OPL = sandbox.OPLMusic;
await OPL.init('src/opl2.wasm', 49716);
// play any song then RestartSong will swap in test events
OPL.play('E1M1', sandbox.ASSETS.music.E1M1, false);
const SR = 49716, SECS = 2;
const out = new Int16Array(SR * SECS);
for (let b = 0; b < SR * SECS / 512; b++) { OPL.newBlock(); for (let i = 0; i < 512; i++) out[b * 512 + i] = OPL.next()[0]; }
// WAV mono
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + out.length * 2, 4); h.write('WAVE', 8); h.write('fmt ', 12);
h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28);
h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(out.length * 2, 40);
fs.writeFileSync(root + 'tools/sample-E-testnotes.wav', Buffer.concat([h, Buffer.from(out.buffer)]));
// envelope per 10 ms
const S = 110, pk = [];
for (let t = 0; t < 200; t++) { let p = 0; for (let i = 0; i < S; i++) p = Math.max(p, Math.abs(out[t * S + i])); pk.push(p); }
console.log('peaks per 10ms over 2 s (notes at 0,300,600,900ms; offs +150ms):');
console.log(pk.join(' '));
