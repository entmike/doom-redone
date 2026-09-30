// Audit: which gospel doomednums have mobjinfo + full state chains in the port
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const ctx = { console, Buffer, Math, JSON, Date,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary') };
vm.createContext(ctx);
require(path.join(root, 'tools/wadboot-host.js'))(ctx);
for (const f of ['src/engine.js', 'src/game.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

const nums = vm.runInContext(
  'G.mobjinfo.filter(m=>m.doomednum>0).map(m=>m.doomednum).sort((a,b)=>a-b)', ctx);
console.log('PORT doomednums (' + nums.length + '):', nums.join(','));

const st = vm.runInContext('Object.keys(G.statenames)', ctx);
for (const p of ['S_VILE_', 'S_SKEL_', 'S_FATT_', 'S_CPOS_', 'S_CPOSS_', 'S_BSPI_',
                 'S_PAIN_', 'S_SPID_', 'S_CYBR_', 'S_BOS2_', 'S_WOLF_', 'S_HEAD_', 'S_SKULL_']) {
  console.log(p.padEnd(9), st.filter(n => n.startsWith(p)).length);
}
// gospel spawnable set
const g = fs.readFileSync(path.join(root, 'reference/linuxdoom-1.10/info.c'), 'utf8');
const gnums = new Set();
const blocks = g.split(/\{\s*\/\/\s*/).slice(1);
for (const b of blocks) {
  const name = (b.match(/^MT_[A-Z0-9_]+/) || [''])[0];
  if (!name) continue;
  const lines = b.split('\n').map(l => l.replace(/\/\/.*/, '').trim()).filter(Boolean);
  const dn = parseInt(lines[1], 10);   // field[0]=doomednum after name token
  if (dn > 0) gnums.add(dn);
}
const have = new Set(nums);
const missing = [...gnums].filter(n => !have.has(n)).sort((a, b) => a - b);
console.log('gospel spawnable:', gnums.size, 'port:', have.size, 'MISSING:', missing.join(','));
// chain integrity: every implemented mobj's states resolve
const bad = vm.runInContext(`(function(){
  const out=[]; const st=G.states, names=G.statenames;
  for (const m of G.mobjinfo) {
    for (const k of ['spawnstate','seestate','painstate','deathstate','raisestate','missilestate','meleestate']) {
      const s=m[k]; if(!s) continue;
      if (!st[s] || st[s].sprite===null) out.push(m.doomednum+':'+k+'->'+s);
    }
  }
  return out.join(' ')||'ALL RESOLVE';
})()`, ctx);
console.log('chain integrity:', bad);
