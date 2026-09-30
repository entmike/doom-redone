// per-paint probe: which texture/source each colfunc paint uses at ROW, and the src byte
// env: MAPF SX SY SA VIEWZ ROW
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
console.log(E(`(function(){
  var X=(${SX}*FRACUNIT)|0, Y=(${SY}*FRACUNIT)|0, ang=Math.round(${SA}*4294967296/360)>>>0;
  var ssub=subsectors[R_PointInSubsector(X,Y)];
  var vp={x:X,y:Y,angle:ang,player:{viewz:${VZ},extralight:0,fixedcolormap:0,
    mo:{flags:0,x:X,y:Y,angle:ang,subsector:ssub}}};
  var hits=[];
  var origCol=colfunc;
  function texId(src){
    for(var i=0;i<texturepix.length;i++) if(texturepix[i]===src) return texturenames[i]+'#'+i;
    for(var i=0;i<flatpix.length;i++) if(flatpix[i]===src) return 'FLAT'+i;
    return src===null?'null':'other';
  }
  var probe=function(){
    if(dc_yl<=${ROW} && dc_yh>=${ROW}){
      // replicate drawer indexing for ROW
      var frac=(dc_texturemid + (${ROW}-centery)*dc_iscale)|0;
      var tcol=(frac>>FRACBITS)&127;
      var byte=dc_source?dc_source[dc_srcoff+tcol]:'?';
      var lutv=(dc_colormap+(byte&0xff))>>>0;
      var painted=(PIX_LUT[lutv]>>>0).toString(16);
      hits.push('x'+dc_x+' tex='+texId(dc_source)+' off='+dc_srcoff+' tcol='+tcol+
        ' byte='+byte+' cmap='+(dc_colormap>>>8)+' px='+painted+
        ' iscale='+(dc_iscale>>>0)+' tmid='+dc_texturemid+' yl='+dc_yl+' yh='+dc_yh+
        ' srcLen='+(dc_source?dc_source.length:'-'));
    }
    return origCol();
  };
  basecolfunc=probe; colfunc=probe;
  // also wrap masked column drawer to catch its calls
  var origM=R_DrawMaskedColumn;
  R_DrawMaskedColumn=function(a,b){
    hits.push('  MASKED x'+dc_x+' args='+(Array.isArray(a)?JSON.stringify(a):typeof a)+' b='+b+' iscale='+dc_iscale);
    return origM(a,b);
  };
  R_RenderPlayerView(vp);
  colfunc=basecolfunc=origCol;
  return hits.join('\\n');
})()`));
