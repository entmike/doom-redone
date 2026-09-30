// single-pose shot via node vm headless: render to a PNG the simple way
const fs=require('fs'), vm=require('vm');
const ctx = vm.createContext({console, Buffer});
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js);
vm.runInContext(fs.readFileSync('src/engine.js','utf8'),ctx);
ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, process.env.MAPF || 'E1M1'));
vm.runInContext('loadMap(__map);',ctx,{timeout:30000});
const [sx,sy,adeg]=process.argv.slice(2).map(Number);
const out = vm.runInContext(`(function(){
  R_SetViewSize(11,0); R_ExecuteSetViewSize();
  var X=${sx}*FRACUNIT|0, Y=${sy}*FRACUNIT|0, ang=${adeg}*4294967296/360>>>0;
  var vp={x:X,y:Y,angle:ang,player:{viewz:41*FRACUNIT|0,extralight:0,fixedcolormap:0,
    mo:{flags:0,x:X,y:Y,angle:ang,subsector:subsectors[R_PointInSubsector(X,Y)]}}};
  R_RenderPlayerView(vp);
  // histogram rows: which y bands have light
  var rows=[]; for(var y=0;y<200;y+=10){ var lit=0;
    for(var x=0;x<320;x++){ var px=viewbuffer[y*320+x]; if((px&0xffffff)>0x181818) lit++; }
    rows.push(lit); }
  var cols={}; for(var i=0;i<viewbuffer.length;i++){ var c=viewbuffer[i]&0xffffff; cols[c]=(cols[c]||0)+1; }
  var top=Object.entries(cols).sort((a,b)=>b[1]-a[1]).slice(0,6);
  return JSON.stringify({rows:rows, top:top});
})()`,ctx,{timeout:20000});
console.log(out);
