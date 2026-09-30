// which lines paint each column at ROW? env: MAPF SX SY SA VIEWZ ROW
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
  var probe=function(){
    if(dc_yl<=${ROW} && dc_yh>=${ROW}){
      var cid='?';
      outer:
      for(var L=0;L<LIGHTLEVELS;L++){ var sl=scalelight[L];
        for(var d=0;d<MAXLIGHTSCALE;d++){ if(sl[d]===dc_colormap){ cid=L+':'+d; break outer; } } }
      var v=viewbuffer[dc_yl*320+dc_x]>>>0; // value BEFORE this draw paints it
      // verify LUT: pixel painted at ROW should equal PIX_LUT[src_tixel + cmap]
      var n=0;
      if(dc_source){
        var texx=dc_xfrac, iscale=dc_iscale;
        // walk from dc_yl to ROW (cheap: ROW-yl<=200)
        var frac=dcTexxAt(dc_yl);
        for(var yy=dc_yl; yy<=dc_yh && yy<=${ROW}; yy++){
          var tcol=(frac>>>14)&0xfc; // flat? no: texture column 64 wide? use mask per tex width
          // for textures: index = (frac>>16)&(texwidth-1) — approximate: use texturewidth via R_GetColumn semantics; fallback 63
          var pidx=dc_source[dc_srcoff + ((frac>>>16)&63) ] ;
          frac=(frac+iscale)>>>0;
          if(yy===${ROW}){
            var exp=(PIX_LUT[(dc_colormap+pidx)>>>0]>>>0);
            var got=(viewbuffer[${ROW}*320+dc_x]>>>0);
            n='src='+pidx+' exp='+exp.toString(16)+' got='+got.toString(16);
          }
        }
      }
      function dcTexxAt(y){ return (dc_texturtop!==undefined?0:0); }
      hits.push('x'+dc_x+' cm='+cid+' LUT:'+n+'
        ' line='+(curline?('('+((curline.v1.x>>16))+','+((curline.v1.y>>16))+')->('+((curline.v2.x>>16))+','+((curline.v2.y>>16))+') f'+curline.side+' mid'+(curline.sidedef?curline.sidedef.midtexture:'-')):'?')+' tex='+dc_texturemid+' yl='+dc_yl+' yh='+dc_yh);
    }
    return origCol();
  };
  basecolfunc=probe; colfunc=probe;
  R_RenderPlayerView(vp);
  colfunc=basecolfunc=origCol;
  return hits.join('\\n');
})()`));
