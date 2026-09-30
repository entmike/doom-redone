// User symptom: after switching WADs OR reloading the page, the LOAD menu
// shows no saves. Simulate: save under DOOM2, hot-install doom1 (nuke runs),
// save there, switch back to DOOM2 (nuke runs again), list slots each time.
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const boot = require('./wadboot-host.js');
let fail = 0;
const ck = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };

const mem = new Map();
const localStorage = {
  get length() { return mem.size; },
  key(i) { return [...mem.keys()][i]; },
  getItem(k) { return mem.has(k) ? mem.get(k) : null; },
  setItem(k, v) { mem.set(k, String(v)); },
  removeItem(k) { mem.delete(k); },
};

const ctx = { console, Buffer, Math, JSON, Date, localStorage,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary') };
vm.createContext(ctx);
const S = (c) => vm.runInContext(c, ctx);
boot(ctx, 'DOOM2.wad');
for (const f of ['src/engine.js', 'src/game.js', 'src/p_saveg.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

// stash both WADs as base64 globals (never interpolated into code strings)
ctx.__d2b64 = fs.readFileSync(path.join(root, 'wads/DOOM2.wad')).toString('base64');
ctx.__d1b64 = fs.readFileSync(path.join(root, 'wads/doom1.wad')).toString('base64');

function install(which, map, epsd, mapnum) {
  ctx.__which = which;
  S(`(() => { const b64 = __which === 'doom1' ? __d1b64 : __d2b64;
      const u8 = new Uint8Array(Buffer.from(b64, 'base64'));
      globalThis.__wad = WAD.load(u8.buffer); })()`);
  S(`WadInstall.install(__wad);`);
  S(`SAVE.nukeForeignSaves();`);                                  // boot-time nuke
  S(`G.currentMapJson = WAD.mapJson(__wad, ${JSON.stringify(map)}); G.G_InitNew(3, ${epsd}, ${mapnum});`);
}
function save(name) {
  S(`SAVE.G_SaveGame(2, ${JSON.stringify(name)});`);
  S(`SAVE.DoSaveGame();`);
}
const listing = () => S(`[0,1,2,3,4,5].map(i => SAVE.readSlot(i)).filter(Boolean).join(',')`);

install('DOOM2', 'MAP01', 0, 1);
save('doom2 save');
ck(listing().includes('doom2 save'), 'DOOM2: save visible right after saving');

install('doom1', 'E1M1', 1, 1);
ck(!listing().includes('doom2 save'), 'doom1: DOOM2 save correctly hidden');
save('doom1 save');
ck(listing().includes('doom1 save'), 'doom1: own save visible');

install('DOOM2', 'MAP01', 0, 1);
ck(listing().includes('doom2 save'), 'DOOM2 after switch-back: save STILL THERE');
ck(!listing().includes('doom1 save'), 'doom1 save now hidden');

install('DOOM2', 'MAP01', 0, 1);   // page reload same WAD
ck(listing().includes('doom2 save'), 'same-WAD reload: save STILL THERE');

const loaded = S(`(function(){ SAVE.DoLoadGame(2, function(v){ window.__ld = v; }); return window.__ld; })()`);
ck(loaded === true, 'surviving save actually loads');
console.log('keys:', JSON.stringify([...mem.keys()].map(k => k.slice(0, 40))));
console.log(fail ? '\n' + fail + ' FAILURES' : '\nALL CHECKS PASSED');
process.exit(fail ? 1 : 0);
