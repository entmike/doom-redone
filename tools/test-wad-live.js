// tools/test-wad-live.js — full-pipeline hot-load test:
// real doom1.wad -> wad.js -> wadinstall.js -> real engine.js + game.js.
// Boots E1M1 from WAD-derived data only and ticks it.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Buffer, performance: { now: () => Date.now() } });

require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js)
// wadboot-host already loaded wad.js/wadinstall.js (const re-decl would throw)
for (const f of ['src/tables.js', 'src/engine.js', 'src/game.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('ok   -', name);
  else { failures++; console.log('FAIL -', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const run = (expr) => vm.runInContext(expr, ctx);

// ---- load the WAD and install
const buf = fs.readFileSync(path.join(root, 'wads', 'doom1.wad'));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
run('globalThis.__ab = null');
ctx.__buf = buf;
run('globalThis.__buf = new Uint8Array(__buf)');
run('var __wad = WAD.load(__buf.buffer)');
const before = run('JSON.stringify({tex:Object.keys(ASSETS.textures).length,fl:Object.keys(ASSETS.flats).length,sp:Object.keys(ASSETS.sprites).length})');
run('var __rep = WadInstall.install(__wad)');
run('WadInstall.applyBundles()');   // browser flow re-applies after title.js loads
const rep = JSON.parse(run('JSON.stringify(__rep)'));
const after = run('JSON.stringify({tex:Object.keys(ASSETS.textures).length,fl:Object.keys(ASSETS.flats).length,sp:Object.keys(ASSETS.sprites).length})');
check('install report', rep.textures === 125 && rep.sprites > 400 && rep.maps === 9 && rep.palette && rep.colormaps, rep);
console.log('   ASSETS before:', before, ' after:', after);
check('ASSETS swapped to WAD content', JSON.parse(after).tex === 125);
check('SKY1 now present in ASSETS.textures', run('"SKY1" in ASSETS.textures'));
check('real flat FLOOR4_8 present (shareware)', run('"FLOOR4_8" in ASSETS.flats && "F_SKY1" in ASSETS.flats'));
check('real sprite BON1A0 present', run('"BON1A0" in ASSETS.sprites'));

// ---- every category now WAD-sourced
check('statusbar patches from WAD (STBAR present)', run('typeof STATUSBAR !== "undefined" && !!STATUSBAR.patches.STBAR'));
check('statusbar glyph set complete (hud.js patch() deps)', (() => {
  // vanilla face/number set exactly as doom1.wad ships it (STGNUM starts at 2;
  // digits 0/1 come from AMMNUM — that's why hud.js reads both families)
  const need = ['STTNUM0','STTNUM9','STTMINUS','STTPRCNT','STYSNUM0','STYSNUM9',
    'STGNUM2','STGNUM7','STKEYS0','STKEYS5','STARMS','STBAR','STFB0','STFST00',
    'STFTR00','STFTL00','STFOUCH0','STFEVL0','STFKILL0','STFGOD0','STFDEAD0',
    'AMMNUM0','AMMNUM1','AMMNUM9'];
  const miss = need.filter(n => !run(`!!STATUSBAR.patches['${n}'] || !!INTERLUDE.patches['${n}']`));
  // hud.js only needs its own names; report extras as info
  if (miss.length) { console.log('   missing statusbar names:', miss.join(',')); return false; }
  return true;
})());
check('intermission patches from WAD (WILV00 + full STCFN 33-95)', (() => {
  if (!run('!!INTERLUDE.patches.WILV00')) return false;
  const miss = [];
  for (let c = 33; c <= 95; c++) {
    const nm = 'STCFN' + String(c).padStart(3, '0');
    if (!run(`!!INTERLUDE.patches['${nm}']`)) miss.push(nm);
  }
  if (miss.length) { console.log('   missing glyphs:', miss.join(',')); return false; }
  return true;
})());
check('intermission flat from WAD', run('INTERLUDE.flat.length === Math.ceil(4096/3)*4'));
check('title patches from WAD (TITLEPIC/HELP1/HELP2)', run('!!globalThis.TITLE.patches.TITLEPIC && !!globalThis.TITLE.patches.HELP1 && !!globalThis.TITLE.patches.HELP2'));
check('title demos from WAD (DEMO1-3)', run('!!TITLE.demos.DEMO1 && !!TITLE.demos.DEMO2 && !!TITLE.demos.DEMO3'));
check('sounds from WAD (PISTOL/SSGTNT…)', run('!!ASSETS.sounds.PISTOL && !!ASSETS.sounds.SHOTGN && Object.keys(ASSETS.sounds).length === 55'), null);
check('music from WAD (13 tracks, E1M1 present, no bunny)', run('Object.keys(ASSETS.music).length === 13 && !!ASSETS.music.E1M1 && !ASSETS.music.BUNNY'));
ctx.__gm = run('ASSETS.genmidi');
const gmHead = Buffer.from(ctx.__gm.slice(0, 12), 'base64').toString('latin1');
check('GENMIDI from WAD (OPL_ magic)', gmHead.startsWith('OPL_I') || gmHead.startsWith('#OPL'), gmHead);
// palette sanity: WAD PLAYPAL pal0 col 0 must be 0,0,0 and 14 palettes
check('WAD PLAYPAL active', run('ASSETS.palettes.length === 14 && ASSETS.palette[0][0] === 0'));

// ---- seed map cache and boot E1M1 from WAD data
const cache = {};
ctx.__cache = cache;
const nseed = run('WadInstall.seedTitleCache(__cache)');
check('seedTitleCache maps both keys', nseed === 9 &&
  run('!!__cache["E1M1"]') && run('!!__cache["assets/e1m1.json"]') &&
  run('__cache["E1M1"] === __cache["assets/e1m1.json"]'), nseed);

run('G.loadMap = loadMap');            // same seam main.js wires
run('SndCall = function(){}');
ctx.__map = cache['E1M1'];
run('G.currentMapJson = __map');
// engine R_InitData must run on new ASSETS: loadLevel -> G.loadMap does that.
try { run('G_InitNew(2,1,1)'); check('G_InitNew on WAD E1M1 boots', true); }
catch (e) { check('G_InitNew on WAD E1M1 boots', false, e.message); }

// tick 120 tics; player must exist, be on floor, no throw
run('for (var i=0;i<120;i++) G_Ticker();');
const st = JSON.parse(run('JSON.stringify({t:G.leveltime,h:G.players[0].health,x:G.players[0].mo.x|0,nsub:numsubsectors,ntex:numtextures,nflat:numflats})'));
check('120 tics advanced', st.t === 120, st);
check('E1M1 BSP from WAD lumps (237 subsectors)', st.nsub === 237, st.nsub);
check('engine numtextures == 125 (WAD)', st.ntex === 125, st.ntex);
check('engine numflats == 54 (WAD shareware)', st.nflat === 54, st.nflat);

// render one frame to prove texture/sprite tables are usable end-to-end
try {
  run('viewbuffer = viewbuffer || new Uint32Array(320*200); R_SetViewSize(10,0); R_ExecuteSetViewSize(); R_RenderPlayerView(G.players[0]);');
  const nz = run('(function(){var n=0;for(var i=0;i<viewbuffer.length;i++) if(viewbuffer[i]!==0xff000000) n++; return n})()');
  check('render produced non-black pixels', nz > 30000, nz);
} catch (e) { check('render produced non-black pixels', false, e.message); }

// sprite lookup uses WAD patch offsets: troo sprite cache entry exists
const sprOK = run('(function(){return Object.keys(typeof spriteCacheIdx!=="undefined"?spriteCacheIdx:{}).length})()');
check('sprite patches decoded from WAD during render', sprOK > 0, sprOK);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
