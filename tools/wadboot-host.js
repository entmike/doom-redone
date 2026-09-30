// Host-side vm bootstrap: wads/doom1.wad -> wad.js -> wadinstall.js shim +
// install. Replaces the deleted baked assets/assets.js bundles for the vm
// test tools, so every test context now runs on real WAD data exactly like
// the browser does. Call AFTER vm.createContext(ctx), before engine/game.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

module.exports = function bootWad(ctx, wadName) {
  const root = path.join(__dirname, '..');
  ctx.Buffer = ctx.Buffer || Buffer;
  for (const f of ['src/wad.js', 'src/wadinstall.js'])
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  ctx.__wadB64 = fs.readFileSync(path.join(root, 'wads', wadName || 'doom1.wad')).toString('base64');
  vm.runInContext(`(() => {
    const u8 = new Uint8Array(Buffer.from(__wadB64, 'base64'));
    globalThis.__wad = WAD.load(u8.buffer);
    WadInstall.install(__wad);
    globalThis.__maps = {};
    for (const n of ['E1M1','E1M2','E1M3','E1M4','E1M5','E1M6','E1M7','E1M8','E1M9']) {
      const mj = WAD.mapJson(__wad, n);
      if (mj) globalThis.__maps[n] = JSON.stringify(mj);
    }
  })()`, ctx);
};

// Host-side accessor: WAD map JSON for a map name (replaces deleted
// assets/e1mN.json fixtures). Requires bootWad() first.
module.exports.mapJSON = function (ctx, name) {
  return vm.runInContext(`__maps[${JSON.stringify(name.toUpperCase())}]`, ctx);
};
