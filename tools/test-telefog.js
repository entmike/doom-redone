// Regression: teleport fog must spawn as MT_TFOG, never a stale type literal.
// The dense mobjinfo table moved MT_TFOG from 7 to 39; the automap right-click
// cheat and the monster-respawn teleport kept ", 7)" literals, which spawned
// MT_SMOKE (bullet-puff sprite) instead of TFOG puffs.
//
// The cheat handler lives in automap.js (browser code). This gate extracts it
// and evals it against the headless engine, exactly mirroring the live wiring
// (window.G = G, window.Snd = Snd), then asserts the spawned fogs' type ids
// AND their sprites (TFOG frames vs PUFF frames).
'use strict';
const vm = require('vm');
const fs = require('fs');
const boot = require('./wadboot-host.js');

const ctx = { console, Buffer, Math, JSON, Date,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  window: {} };
ctx.window = ctx;                        // window === globalThis, like the page
vm.createContext(ctx);
boot(ctx, 'doom1.wad');
for (const f of ['src/engine.js', 'src/game.js', 'src/sound.js'])
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
vm.runInContext('gamestate="level"', ctx);

let fail = 0;
const ck = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const S = src => vm.runInContext(src, ctx);
S(`Snd.S_Init();`);
S(`G.currentMapJson = WAD.mapJson(__wad, "E1M1"); G.G_InitNew(3, 1, 1); gamestate="level"`);

const meta = JSON.parse(S(`JSON.stringify({
  TFOG: G.MT.TFOG,
  fogSpr: (()=>{ const st = G.states[G.mobjinfo[G.MT.TFOG].spawnstate]; return (G.sprnames ? G.sprnames[st.sprite] : st.sprite) + st.frame; })(),
  smokeSpr: (()=>{ const st = G.states[G.mobjinfo[7].spawnstate]; return (G.sprnames ? G.sprnames[st.sprite] : st.sprite) + st.frame; })()
})`));
console.log('MT_TFOG index', meta.TFOG, '(spawn sprite', meta.fogSpr + ')  index7 spawn sprite =', meta.smokeSpr);
ck(meta.fogSpr.startsWith('TFOG'), 'MT_TFOG spawns the TFOG sprite chain (gospel)');
ck(meta.smokeSpr.startsWith('PUFF'), 'stale literal 7 is MT_SMOKE, PUFF sprite (the reported bug)');

// --- extract the cheat handler from automap.js and eval it verbatim -------
const amap = fs.readFileSync('src/automap.js', 'utf8');
const start = amap.indexOf('function onRightClick');
if (start < 0) { console.log('FAIL onRightClick not found in automap.js'); process.exit(1); }
let i = amap.indexOf('{', start), depth = 0, end = -1;
for (let j = i; j < amap.length; j++) {
  if (amap[j] === '{') depth++;
  else if (amap[j] === '}') { depth--; if (!depth) { end = j + 1; break; } }
}
const handlerSrc = 'FU=65536; SFX_TELEPT=35; SFX_NOWAY=81; cv={getBoundingClientRect:()=>({left:0,top:0})};\n'
  + amap.slice(start, end);
vm.runInContext('var FU,SFX_TELEPT,SFX_NOWAY,cv,ox,oy,scale;' + handlerSrc, ctx);

// place player at known fixed coords; cheat teleports to (0, 1024) units
const res = JSON.parse(S(`(function(){
  const p = G.players[G.consoleplayer|0] || G.players[0];
  p.mo.x = 1024*65536; p.mo.y = 1024*65536; p.mo.health = 100;
  p.mo.z = p.mo.floorz; p.viewz = (p.mo.z + p.viewheight) | 0;
  G.P_TeleportMove(p.mo, p.mo.x, p.mo.y);
  ox = 0; oy = 0; scale = 0.5;
  // count pre-existing fog-family mobjs on the thinker list
  const scan = () => { const t = [];
    for (let th = G.thinkercap.next; th !== G.thinkercap; th = th.next)
      if (th.type === G.MT.TFOG || th.type === 7) t.push(th.type);
    return t; };
  const n0 = scan().length;
  onRightClick({ clientX: 0, clientY: -2048, preventDefault(){} });
  // wx = (0-0)/0.5 = 0 units ; wy = (0-(-2048))/0.5 = 4096 units
  const all = scan();
  return JSON.stringify({ newFogs: all.length - n0, types: all.slice(n0),
    moved: (p.mo.x/65536|0) === 0 && (p.mo.y/65536|0) === 4096,
    x: (p.mo.x/65536)|0, y: (p.mo.y/65536)|0 });
})()`));
console.log('cheat result:', JSON.stringify(res));
ck(res.moved, 'right-click moved the player to the clicked spot');
ck(res.newFogs === 2 && res.types.every(t => t === JSON.parse(S('G.MT.TFOG'))),
   'right-click spawned 2 MT_TFOG fogs (got ' + res.newFogs + ' types ' + JSON.stringify(res.types) + ')');

// source-level guarantee: no literal-7 spawns left in either caller
ck(!/P_SpawnMobj\([^)]*,\s*7\)/.test(amap), 'automap.js: no literal type-7 P_SpawnMobj');
ck(!/P_SpawnMobj\([^)]*,\s*7\)/.test(fs.readFileSync('src/game.js', 'utf8')),
   'game.js: no literal type-7 P_SpawnMobj (respawn fog fixed)');
// sfx ids must flow through G.SFX names (only the fallback line may carry a
// literal, and only paired with G.SFX lookups)
ck(/G\.SFX && G\.SFX\.sfx_telept/.test(amap) && !/S_StartSound\([^)]*,\s*\d/.test(amap),
   'automap.js: teleport sfx via G.SFX names, no raw-id dispatch');

console.log(fail ? '\n' + fail + ' FAILURES' : '\nALL CHECKS PASSED');
process.exit(fail ? 1 : 0);
