// headless: dump scalelight + light computation internals at pose (same as browser probe)
const fs=require('fs'), vm=require('vm');
const ctx = vm.createContext({console, Buffer});
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js);
vm.runInContext(fs.readFileSync('src/engine.js','utf8'),ctx);
ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, process.env.MAPF || 'E1M1'));
vm.runInContext('loadMap(__map);',ctx,{timeout:30000});
console.log(vm.runInContext(`(function(){
  R_SetViewSize(11,0); R_ExecuteSetViewSize();
  var X=(-273*FRACUNIT)|0, Y=(-576*FRACUNIT)|0;
  var ssub=subsectors[R_PointInSubsector(X,Y)];
  var sec=ssub.sector;
  var vp={x:X,y:Y,angle:0,player:{viewz:2686976,extralight:0,fixedcolormap:0,
    mo:{flags:0,x:X,y:Y,angle:0,subsector:ssub}}};
  R_RenderPlayerView(vp);
  var o=[];
  o.push('sector light='+sec.lightlevel+' floor='+sec.floorlight+
         ' ceiling='+sec.ceilinglight+' special='+sec.special+' tag='+sec.tag);
  o.push('LIGHTLEVELS='+LIGHTLEVELS+' MAXLIGHTSCALE='+MAXLIGHTSCALE+' NUMCOLORMAPS='+NUMCOLORMAPS+' DISTMAP='+DISTMAP);
  o.push('scalelight rows='+scalelight.length);
  for(var i=0;i<scalelight.length;i++){
    o.push('sl'+i+': ['+[0,1,2,3,8,16,32,64,127,191].map(function(j){return scalelight[i][j];}).join(',')+']');
  }
  o.push('scalelightfixed[0,1,2]='+[scalelightfixed[0],scalelightfixed[1],scalelightfixed[2]].join(','));
  o.push('colormaps[0] first8='+Array.from(ASSETS.colormaps?ASSETS.colormaps.subarray?ASSETS.colormaps.subarray(0,8):ASSETS.colormaps.slice?ASSETS.colormaps.slice(0,8):[]:[]).join(','));
  return o.join('\\n');
})()`,ctx));
