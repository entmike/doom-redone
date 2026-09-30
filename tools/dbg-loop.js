const fs = require('fs'), vm = require('vm');
const ctx = vm.createContext({ console, Buffer });
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js);
vm.runInContext(fs.readFileSync('src/engine.js', 'utf8'), ctx);
ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, process.env.MAPF || 'E1M1'));
vm.runInContext('loadMap(__map);', ctx);
ctx.__X = 400 * 65536 | 0; ctx.__Y = -600 * 65536 | 0;
vm.runInContext(`(function(){
  var ang=(337*67108864+((0.5*67108864)|0))>>>0;
  R_SetViewSize(11,0); R_ExecuteSetViewSize();
  var vp={x:__X,y:__Y,angle:ang,player:{viewz:41*FRACUNIT|0,extralight:0,fixedcolormap:0,
    mo:{flags:0,x:__X,y:__Y,angle:ang,subsector:subsectors[R_PointInSubsector(__X,__Y)]}}};
  R_RenderPlayerView(vp);
})()`, ctx);
