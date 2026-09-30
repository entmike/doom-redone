const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const boot = require('./wadboot-host.js');
const src = fs.readFileSync(path.join(root, 'src/engine.js'), 'utf8');
function run(flagLine, label) {
  const ctx = { console, Buffer, Math, JSON, Date, performance: { now: () => Date.now() },
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary') };
  vm.createContext(ctx);
  boot(ctx, 'doom1.9-retail.wad');
  vm.runInContext(flagLine ? src.replace('MF_NOSECTOR = 8,\n    MF_NOBLOCKMAP = 16,', flagLine) : src, ctx, { filename: 'engine.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/game.js'), 'utf8'), ctx, { filename: 'game.js' });
  return vm.runInContext(`(function(){
    G.currentMapJson = WAD.mapJson(__wad, "E2M1");
    G.G_InitNew(3,2,1);
    const pl = G.player.mo;
    pl.x = 1792 << 16; pl.y = 224 << 16; pl.z = (-64) << 16;
    pl.player ? (pl.player.mo = pl) : 0;
    const ang = Math.round(117.9 * 12928473);   // deg * 2^32/360 as unsigned
    G.player.mo.mobj ? 0 : 0;
    try { R_SetViewSize(10, 0); R_ExecuteSetViewSize(); } catch(e) {}
    // set view angle via player.mo.angle (angle_t may need two's complement)
    pl.angle = ang > 2147483647 ? ang - 4294967296 : ang;
    try { R_RenderPlayerView(G.player); } catch(e) { return 'RENDER-ERR ' + e.message; }
    // which patch lumps came from TROO sprites?
    let troo = 0, total = 0;
    const trooLumps = new Set();
    for (const sd of sprites) if (sd.name === 'TROO') for (const sf of sd.spriteframes)
      if (sf && sf.lump) for (const l of sf.lump) trooLumps.add(l);
    for (let i = 0; i < vissprite_p; i++) { total++; if (trooLumps.has(vissprites[i].patch)) troo++; }
    return JSON.stringify({ total, troo });
  })()`, ctx);
}
const fixed = JSON.parse(run(null));
const broken = JSON.parse(run('MF_NOSECTOR = 4096,\n    MF_NOBLOCKMAP = 8192,'));
console.log(JSON.stringify({ fixed, broken }));
// the ghost is the doomednum-14 teleport destination at (1920,320): the
// engine MUST not sector-link MF_NOSECTOR things (gospel p_mobj.h: 8/16)
const ok = fixed.troo === 0 && broken.troo === 1;
console.log(ok ? 'ALL CHECKS PASSED' : 'FAIL: expected fixed.troo==0 && broken.troo==1');
process.exit(ok ? 0 : 1);
