// headless twin of cdp-vpdiff.js: same pose, dump visplanes + viewbuffer samples
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
  var o=['ds_p='+ds_p+' lvp='+lastvisplane+' viewheight=41(headless vp has none)'];
  for(var p=0;p<lastvisplane;p++){var pl=visplanes[p];
    var marked=0,gaps=[],run=null;
    for(var x=0;x<320;x++){var m=pl.top[x]!==-1;if(m)marked++;if(!m&&run===null)run=x;if(m&&run!==null){gaps.push(run+'-'+(x-1));run=null;}}
    if(run!==null)gaps.push(run+'-319');
    var tops=[];for(var x=0;x<320;x+=40)tops.push(pl.top[x]);
    o.push('vp'+p+' h='+(pl.height>>16)+' pic='+pl.picnum+' light='+pl.lightlevel+' marked='+marked+' gaps=['+gaps.join(',')+'] tops@40='+tops.join(','));
  }
  o.push('vb@(160,50)='+(viewbuffer[50*320+160]&0xffffff).toString(16)+
    ' @(160,100)='+(viewbuffer[100*320+160]&0xffffff).toString(16)+
    ' @(160,150)='+(viewbuffer[150*320+160]&0xffffff).toString(16)+
    ' @(10,10)='+(viewbuffer[10*320+10]&0xffffff).toString(16));
  return o.join('\\n');
})()`,ctx));
