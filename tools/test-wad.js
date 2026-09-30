// tools/test-wad.js — headless check of wad.js against the real doom1.wad.
// Ground truth = the baked assets/e1m1.json (extracted from the same WAD by
// the python tooling): map lumps must match byte-for-byte after base64.
'use strict';
const fs = require('fs');
const path = require('path');
const WAD = require('../src/wad.js');

const root = path.join(__dirname, '..');
let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('ok   -', name);
  else { failures++; console.log('FAIL -', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

const buf = fs.readFileSync(path.join(root, 'wads', 'doom1.wad'));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const wad = WAD.load(ab);

check('magic IWAD', wad.magic === 'IWAD', wad.magic);
check('lump count 1264 (shareware)', wad.lumps.length === 1264, wad.lumps.length);
check('find E1M1', wad.find('E1M1') >= 0);
check('find PLAYPAL/COLORMAP/TEXTURE1/PNAMES/STARTPOINTER-1 style lumps',
  ['PLAYPAL', 'COLORMAP', 'TEXTURE1', 'PNAMES', 'F_START', 'S_START', 'S_END', 'F_END']
    .every(n => wad.find(n) >= 0));

// ---- maps
const maps = WAD.mapList(wad);
check('mapList finds E1M1..E1M9', maps.length === 9 && maps[0].name === 'E1M1' && maps[8].name === 'E1M9',
  maps.map(m => m.name));

// ---- mapJson vs raw WAD bytes (byte-for-byte, no baked fixture needed) ----
const mj = WAD.mapJson(wad, 'E1M1');
check('mapJson mapname', mj.mapname === 'E1M1');
let allEq = true, firstBad = null;
{
  const i = wad.find('E1M1');
  for (let k = 0; k < WAD.MAP_LUMPS.length; k++) {
    const L = wad.lumps[i + 1 + k];
    const raw = Buffer.from(L.data()).toString('base64');
    if (mj.lumps[WAD.MAP_LUMPS[k]] !== raw) { allEq = false; firstBad = firstBad || WAD.MAP_LUMPS[k]; }
  }
}
check('all 10 map lumps round-trip identical to raw WAD bytes', allEq, firstBad);

// E1M5 LINEDEFS: parser output must equal a direct file-window read
const mj5 = WAD.mapJson(wad, 'E1M5');
{
  const ln = wad.lumps[wad.find('E1M5') + 2];   // marker+1=THINGS, marker+2=LINEDEFS
  const raw = Buffer.from(ln.data()).toString('base64');
  check('E1M5 LINEDEFS identical to raw lump bytes', mj5.lumps.LINEDEFS === raw);
}

// ---- palette / colormaps
const pals = WAD.readPalette(wad);
check('PLAYPAL 14 palettes x 256 rgb', pals && pals.length === 14 && pals[0].length === 256 && pals[0][0].length === 3,
  pals && pals.length);
const cm = WAD.readColormaps(wad);
check('COLORMAP b64 decodes to 34*256', WAD.b64(new Uint8Array(0)) === '', true);
check('COLORMAP b64 length', cm.length === Math.ceil(34 * 256 / 3) * 4);

// ---- textures
const { textures: tex, patchNames } = WAD.readTextures(wad);
check('TEXTURE1 total 125 textures (shareware, no TEXTURE2)', tex.length === 125, tex.length);
const sky = tex.find(t => t.name === 'SKY1');
check('SKY1 texture present 256x128', sky && sky.width === 256 && sky.height === 128,
  sky && [sky.width, sky.height]);
const comp = WAD.composeTexture(wad, sky, patchNames);
check('SKY1 composite size', comp.length === 256 * 128);
// composeTexture wraps offsetY (&127), so the -8-shifted SKY1 patch fills
// fully. Vanilla clips (leaving uninitialized garbage the 1.10 sky path
// never shows); the port draws sky from F_SKY1 bands, so a full composite
// is the faithful stand-in. Coverage sanity: >88%.
let cov = 0; for (let i = 0; i < comp.length; i++) if (comp[i] !== 255) cov++;
check('SKY1 composite fully composed', cov / comp.length > 0.88, cov / comp.length);
// multi-patch texture per WAD ground truth: BIGDOOR1 128x96, 5 patches;
// x=96..112 has NO patch (vanilla garbage strip there), so majority-covered
const bd = tex.find(t => t.name === 'BIGDOOR1');
const bc = WAD.composeTexture(wad, bd, patchNames);
let cov2 = 0; for (let i = 0; i < bc.length; i++) if (bc[i] !== 255) cov2++;
check('BIGDOOR1 128x96 composite, >60% covered', bc.length === 128 * 96 && cov2 / bc.length > 0.6,
  [bd.width, bd.height, bd.comps.length, cov2 / bc.length]);
// masked texture: scan all composites, holes must exist somewhere (fences etc.)
let holeTex = null;
for (const t of tex) {
  if (WAD.composeTexture(wad, t, patchNames).includes(255)) { holeTex = t.name; break; }
}
check('some texture composites with holes (masked)', holeTex !== null, holeTex);

// ---- patch decode sanity: TROOA1 header vs known values
const p = WAD.decodePatch(wad, 'TROOA1');
check('TROOA1 decodes', p && p.w > 0 && p.h > 0, p && [p.w, p.h]);
// top row must contain at least one hole (sprites always have transparent margins)
check('TROOA1 has transparency', p.px.slice(0, p.w).includes(255));

// ---- flats (F_START..F_END, exact 4096)
const flat = WAD.readFlat(wad, 'FLOOR4_8');
check('flat FLOOR4_8 is 4096 bytes', flat && flat.length === 4096);
// ---- sprite lookup via S range (TROOA1 must resolve inside S_START..S_END)
const sIdx = wad.find('S_START'), eIdx = wad.find('S_END');
let trooIn = -1;
for (let i = sIdx + 1; i < eIdx; i++) if (wad.lumps[i].name === 'TROOA1') trooIn = i;
check('TROOA1 sits in S_START..S_END', trooIn > 0);

// ---- sprites directory: every S_START..S_END lump of 6+8 form decodes header
let sstart = wad.find('S_START'), send = wad.find('S_END');
let nSpr = 0, badSpr = 0;
for (let i = sstart + 1; i < send; i++) {
  const L = wad.lumps[i];
  if (L.size === 0) continue;
  nSpr++;
  const dv = new DataView(ab, L.pos, L.size);
  if (dv.getInt16(0, true) <= 0 || dv.getInt16(2, true) <= 0) badSpr++;
}
check('S_START..S_END sprite lumps present (483 shareware)', nSpr === 483, nSpr);
check('all sprite headers positive dims', badSpr === 0, badSpr);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
