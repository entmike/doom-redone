const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const ctx = { console, Buffer, Math, JSON, Date,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary') };
vm.createContext(ctx);
require(path.join(root, 'tools/wadboot-host.js'))(ctx);
for (const f of ['src/engine.js', 'src/game.js']) {
  try { vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }); }
  catch (e) { console.log(f, 'ERROR:', e.stack.split('\n').slice(0, 8).join('\n')); }
}
console.log('statenames:', vm.runInContext('Object.keys(G.statenames).length', ctx));
