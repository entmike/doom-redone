// Gate: IWAD+PWAD layering for map-only PWADs, and the ZDoom/UDMF tripwire.
//   1. isOverlay(): synthetic map-only PWAD = overlay; doom1/DOOM2 = not.
//   2. missingGraphics(): DOOM2 covers a DOOM2-geometry PWAD 100%; doom1 doesn't.
//   3. overlay() over an installed base: maps swap to the PWAD, ASSETS stay
//      the base's, fingerprint keeps the BASE's (vanilla -file semantics),
//      base bundles stay published.
//   4. R_InitData seam: ASSETS.flats.F_SKY1 survives the overlay (engine.js
//      sky-band read no longer BOOT-ERRORs).
//   5. seedTitleCache override arg: base maps seed first, PWAD wins MAP01.
//   6. detectZDoom(): TEXTMAP/XGL3 build of myhouse flagged; vanilla WADs not.
// The map-only PWAD is SYNTHESIZED here (DOOM2 MAP01 + its 10 lumps) so the
// gate never depends on which build of wads/myhouse.wad is on disk.
// All WAD objects are built INSIDE the vm (host typed arrays would fail the
// sandbox realm's instanceof/DataView checks).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ok: ' + msg); }
  else { fail++; console.log('  FAIL: ' + msg); }
}
const ctx = { console, Buffer, Math, JSON, Date, String, Number, Set, Map, Array,
  Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array,
  Float32Array, Float64Array, DataView, ArrayBuffer, Error, RegExp, Object,
  isNaN, parseInt, parseFloat,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary') };
vm.createContext(ctx);
for (const f of ['src/wad.js', 'src/wadinstall.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

// Load a WAD inside the vm and stash it on a vm global under `slot`.
function vmLoad(slot, name) {
  ctx.__b64 = fs.readFileSync(path.join(root, 'wads', name)).toString('base64');
  vm.runInContext(
    `${slot} = WAD.load(Uint8Array.from(atob(__b64), c => c.charCodeAt(0)).buffer)`, ctx);
}
// Build a map-only PWAD (MAP01 marker + the 10 vanilla map lumps, copied
// byte-for-byte from DOOM2.wad) — a stable overlay fixture.
function synthMapOnly() {
  const d2 = fs.readFileSync(path.join(root, 'wads/DOOM2.wad'));
  const count = d2.readInt32LE(4), dirOfs = d2.readInt32LE(8);
  const lumps = [];
  for (let i = 0; i < count; i++) {
    const o = dirOfs + i * 16;
    lumps.push({ pos: d2.readInt32LE(o), size: d2.readInt32LE(o + 4),
      name: d2.slice(o + 8, o + 16).toString('latin1').replace(/\0.*$/, '') });
  }
  const m01 = lumps.findIndex(l => l.name === 'MAP01');
  if (m01 < 0) throw new Error('DOOM2.wad has no MAP01');
  const keep = [];
  for (let k = 0; k <= 10; k++) keep.push(lumps[m01 + k]);
  const body = Buffer.concat(keep.map(l =>
    d2.slice(l.pos, l.pos + l.size)));
  const out = Buffer.alloc(12 + body.length + keep.length * 16);
  out.write('PWAD', 0); out.writeInt32LE(keep.length, 4);
  out.writeInt32LE(12 + body.length, 8);
  let off = 12; const d = 12 + body.length;
  keep.forEach((l, j) => {
    if (l.size) d2.copy(out, off, l.pos, l.pos + l.size);
    out.writeInt32LE(off, d + j * 16);
    out.writeInt32LE(l.size, d + j * 16 + 4);
    out.write(l.name.padEnd(8, '\0').slice(0, 8), d + j * 16 + 8, 'latin1');
    off += l.size;
  });
  return out;
}
const run = expr => vm.runInContext(expr, ctx);
ctx.__synth = synthMapOnly().toString('base64');
vm.runInContext('__w_pw = WAD.load(Uint8Array.from(atob(__synth),c=>c.charCodeAt(0)).buffer)', ctx);

console.log('--- 1. isOverlay classification');
vmLoad('__w_d1', 'doom1.wad');
vmLoad('__w_d2', 'DOOM2.wad');
ok(run('WadInstall.isOverlay(__w_pw)') === true, 'synthetic map-only PWAD is an overlay');
ok(run('WadInstall.isOverlay(__w_d1)') === false, 'doom1.wad is NOT an overlay');
ok(run('WadInstall.isOverlay(__w_d2)') === false, 'DOOM2.wad is NOT an overlay');

console.log('--- 2. missingGraphics coverage');
let m = JSON.parse(run('JSON.stringify(WadInstall.missingGraphics(__w_d2, __w_pw))'));
ok(m.textures.length === 0 && m.flats.length === 0,
  'DOOM2 covers the DOOM2-geometry PWAD fully');
m = JSON.parse(run('JSON.stringify(WadInstall.missingGraphics(__w_d1, __w_pw))'));
ok(m.textures.length > 0 || m.flats.length > 0,
  'doom1 shareware does NOT cover DOOM2 geometry (' +
  m.textures.length + ' tex + ' + m.flats.length + ' flats missing)');

console.log('--- 3. overlay() over installed base');
vmLoad('__b_d2', 'DOOM2.wad');
run('WadInstall.install(__b_d2)');
const flatsAfterBase = run('Object.keys(ASSETS.flats).length');
const fpBase = run('WadInstall.fingerprint()');
ok(flatsAfterBase > 100, 'DOOM2 install filled ASSETS.flats (' + flatsAfterBase + ')');
run('__r_ov = WadInstall.overlay(__w_pw)');
ok(run('__r_ov.overlay') === true, 'overlay() reports overlay:true');
ok(run('JSON.stringify(WadInstall.maps().map(m=>m.name))') === '["MAP01"]',
  'maps swapped to the PWAD ([MAP01])');
ok(run('Object.keys(ASSETS.flats).length') === flatsAfterBase,
  'ASSETS.flats survived the overlay (base content live)');
ok(run('WadInstall.fingerprint()') === fpBase,
  'fingerprint stayed the BASE iwad (save namespace, vanilla -file)');
ok(run('Object.keys(STATUSBAR.patches).length') > 10,
  'base patch bundles still published after overlay');
ok(run('WadInstall.active() !== WadInstall.base()'),
  'active() = PWAD, base() = IWAD (distinct layering)');

console.log('--- 4. engine F_SKY1 read survives (no BOOT ERROR)');
ok(run('!!(ASSETS.flats.F_SKY1 && ASSETS.flats.F_SKY1[2])'),
  'ASSETS.flats.F_SKY1[2] resolvable after overlay (engine.js:298 path)');

console.log('--- 5. seedTitleCache override + legacy keys');
run('__cache = {}; __n1 = WadInstall.seedTitleCache(__cache, __b_d2); __n2 = WadInstall.seedTitleCache(__cache);');
ok(run('Object.keys(__cache).length') > 32,
  'seeded base(' + run('__n1') + ') + overlay(' + run('__n2') + ') maps: ' +
  run('Object.keys(__cache).length') + ' keys');
const pwThings = run('__cache.MAP01.lumps.THINGS.length');
const d2Things = run('WAD.mapJson(__w_pw, "MAP01").lumps.THINGS.length');
ok(pwThings === d2Things && pwThings > 0,
  'MAP01 in cache is the PWAD map (THINGS b64 len ' + pwThings + ')');
ok(run('__cache["assets/map1.json"].lumps.THINGS.length') === d2Things,
  'legacy assets/map1.json key also carries the PWAD map');

console.log('--- 6. detectZDoom format tripwire');
vmLoad('__w_mhz', 'myhouse.wad');   // disk copy drifts (vanilla build vs UDMF build)
const zd = run('WadInstall.detectZDoom(__w_mhz)');
const isUdmf = run('__w_mhz.find("TEXTMAP") >= 0');
if (isUdmf)
  ok(typeof zd === 'string' && zd.indexOf('UDMF') === 0,
    'UDMF myhouse.wad flagged: ' + JSON.stringify(zd));
else
  ok(zd === null, 'vanilla myhouse.wad not flagged');
ok(run('WadInstall.detectZDoom(__w_d2)') === null, 'DOOM2.wad not flagged');
ok(run('WadInstall.detectZDoom(__w_pw)') === null, 'synthetic vanilla PWAD not flagged');

console.log((fail ? 'OVERLAY-FAIL ' : 'OVERLAY-OK ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
