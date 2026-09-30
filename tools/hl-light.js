// headless twin of cdp-light.js
const fs=require('fs'), vm=require('vm');
const ctx = vm.createContext({console, Buffer});
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js);
vm.runInContext(fs.readFileSync('src/engine.js','utf8'),ctx);
ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, process.env.MAPF || 'E1M1'));
vm.runInContext('loadMap(__map);',ctx,{timeout:30000});
const [SX,SY,VZ]=process.argv.slice(2);
console.log(vm.runInContext(`(function(){
  R_SetViewSize(11,0); R_ExecuteSetViewSize();
  var X=${SX}*FRACUNIT|0, Y=${SY}*FRACUNIT|0;
  var ssub=subsectors[R_PointInSubsector(X,Y)];
  var vp={x:X,y:Y,angle:0,player:{viewz:${VZ}|0,extralight:0,fixedcolormap:0,
    mo:{flags:0,x:X,y:Y,angle:0,subsector:ssub}}};
  R_RenderPlayerView(vp);
  var o=[];
  o.push('scalelight.length='+scalelight.length+' LIGHTLEVELS='+LIGHTLEVELS+' MAXLIGHTSCALE='+MAXLIGHTSCALE);
  o.push('scalelight[17][0..3]='+[0,1,2,3].map(function(j){return scalelight[17][j];}).join(','));
  o.push('scalelightfixed[0..3]='+[0,1,2,3].map(function(j){return scalelightfixed[j];}).join(','));
  o.push('PIX_LUT len='+PIX_LUT.length);
  o.push('PIX_LUT[0]='+ (PIX_LUT[0]>>>0).toString(16) +' [256]='+ (PIX_LUT[256]>>>0).toString(16) +' [8000]='+ (PIX_LUT[8000]>>>0).toString(16));
  o.push('table1 row0 first8='+ [0,1,2,3,4,5,6,7].map(function(s){return (PIX_LUT[256+s]>>>0).toString(16);}).join(' '));
  o.push('vb@(160,50)='+(viewbuffer[50*320+160]>>>0).toString(16));
  return o.join('\\n');
})()`,ctx));
