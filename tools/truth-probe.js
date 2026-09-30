// ground truth probe: inside colfunc, replicate drawer stepping EXACTLY, report
// src byte, table, expected LUT color, and the ACTUAL framebuffer pixel at ROW.
// env: MAPF SX SY SA VIEWZ ROW COLS (comma list of x)
const fs=require('fs'), vm=require('vm');
const ctx = vm.createContext({console, Buffer});
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js);
vm.runInContext(fs.readFileSync('src/engine.js','utf8'),ctx);
const E=(c,t=30000)=>vm.runInContext(c,ctx,{timeout:t});
E('loadMap(JSON.parse(__maps[(process.env.MAPF||"E1M1").toUpperCase()]));');
E('R_SetViewSize(11,0); R_ExecuteSetViewSize();');
const [SX,SY,SA]=['SX','SY','SA'].map(k=>+process.env[k]);
const VZ=+(process.env.VIEWZ||4194304);
const ROW=+(process.env.ROW||100);
const COLS=(process.env.COLS||'24,25,26,140,150').split(',').map(Number);
console.log(E(`(function(){
  var want={}; (${JSON.stringify(COLS)}).forEach(function(c){want[c]=1;});
  var X=(${SX}*FRACUNIT)|0, Y=(${SY}*FRACUNIT)|0, ang=Math.round(${SA}*4294967296/360)>>>0;
  var ssub=subsectors[R_PointInSubsector(X,Y)];
  var vp={x:X,y:Y,angle:ang,player:{viewz:${VZ},extralight:0,fixedcolormap:0,
    mo:{flags:0,x:X,y:Y,angle:ang,subsector:ssub}}};
  var hits=[];
  var origCol=colfunc;
  var probe=function(){
    var x=dc_x, paint=want[x]&&dc_yl<=${ROW}&&dc_yh>=${ROW};
    var snap=paint?{yl:dc_yl,src:dc_source,off:dc_srcoff,cm:dc_colormap,tm:dc_texturemid,is:dc_iscale>>>0}:null;
    var r=origCol();
    if(snap){
      // replicate drawer loop to ROW
      var frac=(snap.tm + (snap.yl-centery)*snap.is)|0;
      for(var yy=snap.yl; yy<${ROW}; yy++) frac=(frac+snap.is)|0;
      var tcol=(frac>>FRACBITS)&127;
      var byte=snap.src[snap.off+tcol];
      var exp=(PIX_LUT[(snap.cm+byte)>>>0]>>>0).toString(16);
      var got=(viewbuffer[${ROW}*320+x]>>>0).toString(16);
      hits.push('x'+x+' cmRaw=0x'+(snap.cm>>>0).toString(16)+' byte='+byte+' tcol='+tcol+' exp='+exp+' got='+got+
        ' iscale='+snap.is+' yl='+snap.yl);
    }
    return r;
  };
  basecolfunc=probe; colfunc=probe;
  R_RenderPlayerView(vp);
  colfunc=basecolfunc=origCol;
  return hits.join('\\n')||'no hits';
})()`));
