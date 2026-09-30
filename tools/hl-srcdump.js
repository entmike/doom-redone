// headless twin of cdp-srcdump.js
const fs=require('fs'), vm=require('vm');
const ctx = vm.createContext({console, Buffer, window:undefined});
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js);
vm.runInContext(fs.readFileSync('src/engine.js','utf8'),ctx);
ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, process.env.MAPF || 'E1M1'));
vm.runInContext('loadMap(__map);',ctx,{timeout:30000});
console.log(vm.runInContext(`(function(){
  R_SetViewSize(11,0); R_ExecuteSetViewSize();
  var info={};
  var orig=colfunc;
  var seen=0;
  colfunc=function(){
    if(seen===0){
      info.srcIsArray=Array.isArray(dc_source);
      info.srcCtor=dc_source&&dc_source.constructor?dc_source.constructor.name:'-';
      info.srcLen=dc_source?dc_source.length:'-';
      info.srcoff=dc_srcoff;
      info.first16=dc_source&&dc_source.slice?Array.from(dc_source.slice(dc_srcoff,dc_srcoff+16)):[];
    }
    seen++;
    return orig();
  };
  var X=(-273*FRACUNIT)|0, Y=(-576*FRACUNIT)|0;
  var ssub=subsectors[R_PointInSubsector(X,Y)];
  var vp={x:X,y:Y,angle:0,player:{viewz:2686976,extralight:0,fixedcolormap:0,
    mo:{flags:0,x:X,y:Y,angle:0,subsector:ssub}}};
  R_RenderPlayerView(vp);
  colfunc=orig;
  var lutsum=0;
  for(var i=0;i<65536;i+=7){lutsum=(lutsum+PIX_LUT[i])|0;}
  info.lutHash=lutsum>>>0;
  info.lutFirst8=Array.from(PIX_LUT.slice(0,8),function(v){return (v>>>0).toString(16);});
  info.lut256_8=Array.from(PIX_LUT.slice(256,264),function(v){return (v>>>0).toString(16);});
  try{ info.texCount=textures.length; }catch(e){ info.texCount='U'; }
  try{
    var t=textures.filter(function(t){return t.name==='BRICKV4';})[0];
    info.brickv4=t?('pic num='+t.picnum+' width='+t.width+' height='+t.height):'not found';
    if(t&&t.columns&&t.columns[0]&&t.columns[0].slice) info.col0=Array.from(t.columns[0].slice(0,8));
  }catch(e){info.brickv4='ERR '+e.message;}
  info.ylookup=Array.from(ylookup.slice(0,4));
  info.columnofs=Array.from(columnofs.slice(0,4));
  info.centery=centery; info.viewheight=viewheight;
  return JSON.stringify(info,null,1);
})()`,ctx));
