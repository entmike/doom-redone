// replay /tmp/liveb-browser.json frames headless at captured (x,y,angle,viewz), diff
const fs=require('fs'), vm=require('vm');
const ctx = vm.createContext({console, Buffer});
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js);
vm.runInContext(fs.readFileSync('src/engine.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('src/game.js','utf8'),ctx);
ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, process.env.MAPF || 'E1M1'));
vm.runInContext('loadMap(__map); G.currentMapJson=__map;',ctx,{timeout:30000});
const d=JSON.parse(fs.readFileSync('/tmp/liveb-browser.json','utf8'));
const head=JSON.stringify(d.state[0],null,0);
for(let fi=0; fi<d.frames.length; fi++){
  const s=d.state[fi];
  const res=vm.runInContext(`(function(){
    R_SetViewSize(11,0); R_ExecuteSetViewSize();
    var X=${s.x|0}, Y=${s.y|0}, ang=${s.angle}>>>0;
    var ssub=subsectors[R_PointInSubsector(X,Y)];
    var vp={x:X,y:Y,angle:ang,player:{viewz:${s.viewz|0},extralight:${s.extralight|0},fixedcolormap:${s.pfixed||0},
      mo:{flags:${s.flags|0},x:X,y:Y,angle:ang,subsector:ssub}}};
    R_RenderPlayerView(vp);
    return Array.from(viewbuffer,function(v){return v>>>0;});
  })()`,ctx,{timeout:30000});
  const br=d.frames[fi].out;
  let n=0, first=[];
  for(let i=0;i<64000;i++) if(res[i]!==br[i]){n++; if(first.length<5)first.push((i%320)+','+((i/320)|0));}
  console.log('frame',fi,'n='+s.n,'diff='+n, first.join(' '));
}
