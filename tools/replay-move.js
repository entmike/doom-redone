// headless replay of /tmp/move-browser.json: same game loop, diff frames
const fs=require('fs'), vm=require('vm');
const ctx = vm.createContext({console, Buffer});
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js);
vm.runInContext(fs.readFileSync('src/engine.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('src/game.js','utf8'),ctx);
ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, process.env.MAPF || 'E1M1'));
const [MAPF,SX,SY,SA,TICS,FWD]=process.argv.slice(2);
const browser=JSON.parse(fs.readFileSync('/tmp/move-browser.json'));
const out = vm.runInContext(`(function(){
  loadMap(__map);
  G.currentMapJson = __map;
  G.onLevelExit = function(){};
  try { G_InitNew(2); } catch(e) { return 'G_InitNew fail: '+e.message; }
  if (typeof player==='undefined'||!player) return 'no player';
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
      var c={forwardmove:${FWD||50},sidemove:0,angleturn:0,buttons:0};
      G_Ticker(c);
    }
    player.bob=0; player.deltaviewheight=0; player.viewheight=2686976; player.viewz=(player.mo.z+2686976)|0;
    R_RenderPlayerView(player);
    var o=new Array(64000);
    for(var i=0;i<64000;i++)o[i]=viewbuffer[i]&0xffffff;
    res.push({x:player.mo.x,y:player.mo.y,z:player.mo.z,a:player.mo.angle>>>0,vz:player.viewz,out:o});
  }
  return JSON.stringify(res);
})()`,ctx);
if (typeof out==='string' && (out.includes('fail')||out.includes('no player'))) { console.log(out); process.exit(1); }
const hf=JSON.parse(out);
let worst=0,worstF=-1;
for(let f=0;f<Math.min(hf.length,browser.length);f++){
  const a=browser[f], b=hf[f];
  let n=0, firstAt=null;
  for(let i=0;i<64000;i++){
    if(a.out[i]!==b.out[i]){n++; if(firstAt===null)firstAt=(i%320)+','+((i/320)|0);}
  }
  const st = (a.x!==b.x||a.y!==b.y||a.a!==b.a||a.vz!==b.vz)
    ? ` STATE br(${a.x>>16},${a.y>>16} z${a.z>>16} a${(a.a*360/4294967296).toFixed(1)} vz${a.vz}) vs hl(${b.x>>16},${b.y>>16} z${b.z>>16} a${(b.a*360/4294967296).toFixed(1)} vz${b.vz})` : '';
  console.log('f'+f+' diff='+n+(firstAt!==null?' first@'+firstAt:'')+st);
  if(n>worst){worst=n;worstF=f;}
}
console.log('WORST frame',worstF,'diff',worst);
