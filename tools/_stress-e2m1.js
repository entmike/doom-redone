// E2M1 stress repro: move, shoot all weapons, use, render frames — headless.
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = process.cwd();
const boot = require('./wadboot-host.js');
const ctx = vm.createContext({
  console, Buffer, Math, JSON, Date,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => {}, addEventListener: () => {},
  document: { getElementById: () => null, addEventListener: () => {}, hidden: false },
});
vm.runInContext('globalThis.window = globalThis;', ctx);
boot(ctx, 'doom1.9-retail.wad');
for (const f of ['src/tables.js', 'src/engine.js', 'src/game.js', 'src/f_wipe.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
try {
  vm.runInContext(`
    G.currentMapName = 'E2M1';
    G.currentMapJson = WAD.mapJson(__wad, 'E2M1');
    G.G_InitNew(2, 2, 1);
    var pl = G.player;
    // full arsenal for stress
    pl.ammo[0]=200; pl.ammo[1]=200; pl.ammo[2]=200; pl.ammo[3]=200; pl.ammo[4]=200;
    for (var w=0; w<9; w++) pl.weaponowned[w] = true;
    var R = 16807, seed = 1;
    function rnd(){ seed = (seed * R) % 2147483647; return seed / 2147483647; }
    var err = null;
    try {
      for (var i = 0; i < 60 && !err; i++) {
        // teleport somewhere random in playerstart-ish area then move
        pl.mo.momx = 0; pl.mo.momy = 0;
        pl.cmd.forwardmove = 30 * 65536; pl.cmd.sidemove = (rnd()*2-1)*20*65536 | 0;
        pl.mo.angle = (rnd()*4294967296)>>>0;
        pl.cmd.buttons = 0;
        for (var t = 0; t < 25; t++) { G.G_Ticker(); }
        pl.readyweapon = i % 9; pl.pendingweapon = 10;
        pl.cmd.buttons = 1 | 2;                      // fire + use held
        for (var t = 0; t < 60; t++) {
          pl.cmd.angleturn = ((rnd()*2-1)*160*65536)|0;
          G.G_Ticker();
        }
      }
    } catch (e) { err = e; }
    if (err) { console.log('THREW:', err.message); console.log((err.stack||'').split('\\n').slice(0,10).join('\\n')); }
    else console.log('stress OK, pos', pl.mo.x>>16, pl.mo.y>>16, 'health', pl.health);
  `, ctx, { filename: 'stress' });
} catch (e) {
  console.log('HOST THREW:', e.message);
  console.log((e.stack || '').split('\n').slice(0, 8).join('\n'));
}
