// Regression probe: every doomednum in every WAD map must spawn without
// "unimplemented" warnings, and the newly-added things must tick cleanly.
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const boot = require('./wadboot-host.js');

let fail = 0;
const ck = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fail++; };

function coverage(wadName, label, expectMaps) {
  const ctx = { console, Buffer, Math, JSON, Date,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary') };
  vm.createContext(ctx);
  boot(ctx, wadName);
  for (const f of ['src/engine.js', 'src/game.js'])
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

  const res = vm.runInContext(`(function(){
    const names = WAD.mapList(__wad).map(m => m.name);
    const miss = {};
    for (const n of names) {
      const mj = WAD.mapJson(__wad, n); if (!mj) { miss[n]='NO-JSON'; continue; }
      G.warned = {};
      G.currentMapJson = mj;
      G.gameskill = 3;                        // hurt-me-plenty: covers most bits
      try { G.loadLevel(); } catch(e) { miss[n]='LOAD-ERR '+e.message; continue; }
      const w = Object.keys(G.warned).filter(k=>k.startsWith('doomednum-')).map(k=>+k.slice(10));
      if (w.length) miss[n]=w.join(',');
    }
    return {count: names.length, miss};
  })()`, ctx);
  ck(res.count === expectMaps, `${label}: ${expectMaps} maps enumerated (got ${res.count})`);
  const bad = Object.keys(res.miss);
  ck(bad.length === 0, `${label}: all maps spawn all things on skill 3` +
    (bad.length ? ' — ' + bad.map(k => k + '→[' + res.miss[k] + ']').join(' ') : ''));
  return ctx;
}

const doom1 = coverage('doom1.wad', 'doom1.wad', 9);
coverage('DOOM2.wad', 'DOOM2.wad', 32);
coverage('ultimate-doom.wad', 'ultimate-doom.wad', 36);

// 2) behavioural: spawn one of each previously-missing thing on E1M1, tick.
const behav = vm.runInContext(`(function(){
  G.currentMapJson = WAD.mapJson(__wad, 'E1M1');
  G.G_InitNew(3, 1, 1);
  G.warned = {};
  const news = [7,16,17,25,26,27,43,44,45,47,54,55,56,57,62,64,65,66,68,69,70,71,80,2004,2022,2047,3005,3006];
  const have = {};
  for (const m of G.mobjinfo) have[m.doomednum] = 1;
  const ps = G.playerstarts[0];
  const warned = [];
  news.forEach((dn,i) => {
    const before = Object.keys(G.warned).length;
    G.P_SpawnMapThing({x: ps.x + 96 + i*48, y: ps.y, angle:0, type:dn, options:0x0f});
    if (Object.keys(G.warned).length > before) warned.push(dn);
  });
  const res = {};
  res.missingOurs = news.filter(n => !have[n]);
  res.realWarn = warned.filter(w => have[w]);
  const find = (dn) => G.mobjlist ? null : null;   // mobjlist not exported; walk sector thinglists
  let head=null, skull=null, cpos=null;
  const seen = {};
  for (const s of G.mapdata.sectors) {
    for (let mo = s.thinglist; mo; mo = mo.snext) {
      if (!mo || seen[mo.id || (seen[mo]=1)]) continue;
      if (!mo.info) continue;
      if (mo.info.doomednum===3005) head=mo;
      else if (mo.info.doomednum===3006) skull=mo;
      else if (mo.info.doomednum===65) cpos=mo;
    }
  }
  res.have3005=!!head; res.have3006=!!skull; res.have65=!!cpos;
  let err=null;
  try { for (let n=0;n<35;n++) G.G_Ticker(G.players[0].cmd); } catch(e){ err=String(e.stack||e); }
  res.tickErr=err;
  const spr = (mo)=> mo ? mo.state.sprite : null;
  res.sprs = [spr(head), spr(skull), spr(cpos)].join('/');
  // caco fireball: aggro and force one attack
  if (head) {
    head.target = G.player.mo;
    head.reactiontime = 0; head.flags &= ~0x80 /*JUSTATTACKED*/;
    head.angle = G.R_PointToAngle2(head.x, head.y, G.player.mo.x, G.player.mo.y) >>> 0;
    G.ACTIONS.A_HeadAttack(head);
    let ball=null;
    for (const s of G.mapdata.sectors)
      for (let mo = s.thinglist; mo; mo = mo.snext)
        if (mo && mo.info && mo.state.num === G.statenames.S_RBALL1) ball = mo;
    res.fireball = ball ? 'fired' : 'no fireball state found';
  } else res.fireball = 'no caco';
  return res;
})()`, doom1);
ck(behav.missingOurs.length === 0, 'all 28 report doomednums in mobjinfo: ' + JSON.stringify(behav.missingOurs));
ck(behav.realWarn.length === 0, 'no spawn warnings for implemented nums: ' + JSON.stringify(behav.realWarn));
ck(behav.have3005 && behav.have3006 && behav.have65, `caco/lost soul/chaingunner mobjs spawned (${behav.have3005}/${behav.have3006}/${behav.have65})`);
ck(!behav.tickErr, '35 tics with new monsters ran clean: ' + (behav.tickErr || 'ok'));
ck(behav.sprs === 'HEAD/SKUL/CPOS', `monster sprites animate (${behav.sprs})`);
ck(behav.fireball === 'fired', 'caco fireball spawned: ' + behav.fireball);

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(fail ? 1 : 0);
