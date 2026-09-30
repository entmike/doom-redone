// headless replay of /tmp/temporal-browser.json: fresh vm with assets+engine+game,
// G_InitNew(2), same teleport, same angle-turn tics; diff each frame vs browser.
const fs=require('fs'), vm=require('vm');
const ctx = vm.createContext({console, Buffer, window:{}, document:undefined, location:{search:''}, fetch:undefined, requestAnimationFrame:undefined});
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js);
vm.runInContext(fs.readFileSync('src/engine.js','utf8'),ctx);
try { vm.runInContext(fs.readFileSync('src/game.js','utf8'),ctx); } catch(e){ console.log('game.js load note:', e.message); }
ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, process.env.MAPF || 'E1M1'));
const [MAPF,SX,SY,SA,TICS,TURN]=process.argv.slice(2);
const frames=JSON.parse(fs.readFileSync('/tmp/temporal-browser.json'));
const out = vm.runInContext(`(function(){
  loadMap(__map);
  G.currentMapJson = __map;
  // mimic boot: viewsize + init game
  if (typeof G_InitNew==='function') { try { G_InitNew(2); } catch(e) { return 'G_InitNew fail: '+e.message; } }
  if (typeof player==='undefined'||!player) return 'no player after G_InitNew';
  R_SetViewSize(11,0); R_ExecuteSetViewSize();
  var g=player;
  g.mo.x=(${SX}*65536)|0; g.mo.y=(${SY}*65536)|0;
  g.mo.angle=Math.round(${SA}*4294967296/360)>>>0;
  P_SetThingPosition(g.mo);
  g.mo.z=g.mo.subsector.sector.floorheight; g.mo.floorz=g.mo.z;
  g.viewz=g.mo.z+g.viewheight; g.mo.lastangle=g.mo.angle;
  g.deltaviewheight=0; g.bob=0;
  var res=[];
  for(var f=0;f<${Math.floor(+TICS/5)};f++){
    for(var k=0;k<5;k++){
      player.mo.angle=(player.mo.angle+(${TURN}|0))>>>0;
      player.mo.lastangle=player.mo.angle;
      var c={forwardmove:0,sidemove:0,angleturn:0,buttons:0};
      if (typeof G_Ticker==='function') G_Ticker(c);
    }
    R_RenderPlayerView(player);
    var o=new Array(64000);
    for(var i=0;i<64000;i++)o[i]=viewbuffer[i]&0xffffff;
    res.push({x:player.mo.x>>16,y:player.mo.y>>16,a:(player.mo.angle>>>0),vz:player.viewz,out:o});
  }
  return JSON.stringify(res);
})()`,ctx);
if (typeof out==='string' && out.startsWith('no player') || (typeof out==='string'&&out.includes('fail'))) { console.log(out); process.exit(1); }
const hf = typeof out==='string' ? JSON.parse(out) : out;
const browser = frames;
let maxdiff=0, maxf=-1;
for(let f=0;f<Math.min(hf.length,browser.length);f++){
  let n=0, state='';
  const a=browser[f], b=hf[f];
  if (a.a!==b.a || a.vz!==b.vz || a.x!==b.x || a.y!==b.y)
    state = ` STATE browser(a=${a.a>>>0} vz=${a.vz} xy=${a.x},${a.y}) headless(a=${b.a>>>0} vz=${b.vz} xy=${b.x},${b.y})`;
  for(let i=0;i<64000;i++){
    const d=Math.abs((a.out[i]&255)-(b.out[i]&255))+Math.abs(((a.out[i]>>8)&255)-((b.out[i]>>8)&255))+Math.abs(((a.out[i]>>16)&255)-((b.out[i]>>16)&255));
    if(d>24)n++;
  }
  console.log('frame'+f+' diff='+n+state);
  if(n>maxdiff){maxdiff=n;maxf=f;}
}
console.log('WORST frame',maxf,'diff',maxdiff);
