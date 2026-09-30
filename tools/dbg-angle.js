// debug: per-angle render at court spot
const fs = require('fs'), vm = require('vm');
const deg = parseInt(process.argv[2], 10);
const X = parseInt(process.argv[3] || '400', 10);
const Y = parseInt(process.argv[4] || '-600', 10);
const ctx = vm.createContext({ console, Buffer });
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js);
vm.runInContext(fs.readFileSync('src/engine.js', 'utf8'), ctx);
ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, process.env.MAPF || 'E1M1'));
vm.runInContext('loadMap(__map);', ctx);
ctx.__deg = deg; ctx.__X = X * 65536 | 0; ctx.__Y = Y * 65536 | 0;
console.log(deg, vm.runInContext(`(function(){
  var ang=((__deg*45)*67108864)>>>0;
  R_SetViewSize(11,0); R_ExecuteSetViewSize();
  var vp={x:__X,y:__Y,angle:ang,player:{viewz:41*FRACUNIT|0,extralight:0,fixedcolormap:0,
    mo:{flags:0,x:__X,y:__Y,angle:ang,subsector:subsectors[R_PointInSubsector(__X,__Y)]}}};
  viewbuffer.fill(0xff000000); R_RenderPlayerView(vp);
  var d=0; for(var i=0;i<64000;i++) if((viewbuffer[i]>>>0)!==0xff000000)d++;
  return 'ok px='+d+' ds='+ds_p+' vp='+vissprite_p;
})()`, ctx));
