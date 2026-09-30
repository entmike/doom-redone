// Repro: retail boot -> E2M1 load + ticks, expecting "reading '3148'"
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
for (const f of ['src/tables.js', 'src/engine.js', 'src/game.js', 'src/f_wipe.js']) {
  try { vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }); } catch (e) { console.log('load fail', f, e.message); }
}
vm.runInContext(`
  globalThis.screen = { width: 320, height: 200 };
  G.currentMapName = 'E2M1';
  G.currentMapJson = WAD.mapJson(__wad, 'E2M1');
`, ctx);
try {
  vm.runInContext('G.G_InitNew(2, 2, 1);', ctx);
  console.log('InitNew ok');
  vm.runInContext('for (let t = 0; t < 700; t++) G.G_Ticker();', ctx);
  console.log('ticks ok');
} catch (e) {
  console.log('THREW:', e.message);
  console.log((e.stack || '').split('\n').slice(0, 6).join('\n'));
}
