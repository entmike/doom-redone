// Gate: IWAD+PWAD layering for map-only PWADs (wads/myhouse.wad).
//   1. isOverlay(): myhouse = overlay; doom1/DOOM2 = not.
//   2. missingGraphics(): DOOM2 covers myhouse 100%; doom1 does not.
//   3. overlay() over an installed base: maps swap to the PWAD, ASSETS stay
//      the base's, fingerprint keeps the BASE's (vanilla -file semantics),
//      base bundles stay published.
//   4. R_InitData seam: ASSETS.flats.F_SKY1 survives the overlay (engine.js
//      sky-band read no longer BOOT-ERRORs).
//   5. seedTitleCache override arg: base maps seed first, PWAD wins MAP01.
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
const run = expr => vm.runInContext(expr, ctx);

console.log('--- 1. isOverlay classification');
vmLoad('__w_mh', 'myhouse.wad');
vmLoad('__w_d1', 'doom1.wad');
vmLoad('__w_d2', 'DOOM2.wad');
ok(run('WadInstall.isOverlay(__w_mh)') === true, 'myhouse.wad is an overlay (map-only PWAD)');
ok(run('WadInstall.isOverlay(__w_d1)') === false, 'doom1.wad is NOT an overlay');
ok(run('WadInstall.isOverlay(__w_d2)') === false, 'DOOM2.wad is NOT an overlay');

console.log('--- 2. missingGraphics coverage');
let m = JSON.parse(run('JSON.stringify(WadInstall.missingGraphics(__w_d2, __w_mh))'));
ok(m.textures.length === 0 && m.flats.length === 0, 'DOOM2 fully covers myhouse graphics');
m = JSON.parse(run('JSON.stringify(WadInstall.missingGraphics(__w_d1, __w_mh))'));
ok(m.textures.length > 0 || m.flats.length > 0,
  'doom1 shareware does NOT cover myhouse (' +
  m.textures.length + ' tex + ' + m.flats.length + ' flats missing)');

console.log('--- 3. overlay() over installed base');
vmLoad('__b_d2', 'DOOM2.wad');
run('WadInstall.install(__b_d2)');
const flatsAfterBase = run('Object.keys(ASSETS.flats).length');
const fpBase = run('WadInstall.fingerprint()');
ok(flatsAfterBase > 100, 'DOOM2 install filled ASSETS.flats (' + flatsAfterBase + ')');
run('__r_ov = WadInstall.overlay(__w_mh)');
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
// MAP01 key must now be the PWAD's (seeded last): THINGS b64 2400 bytes = 3200 chars
const mhThingsLen = run('__cache.MAP01.lumps.THINGS.length');
ok(mhThingsLen === 3200, 'MAP01 in cache is the PWAD map (THINGS b64 len ' +
  mhThingsLen + ' = 2400 bytes), not DOOM2 MAP01');
ok(run('__cache["assets/map1.json"].lumps.THINGS.length') === 3200,
  'legacy assets/map1.json key also carries the PWAD map');

console.log((fail ? 'OVERLAY-FAIL ' : 'OVERLAY-OK ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
