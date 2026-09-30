// scanline probe: pixel colors at row y, per-column colormap id at that pixel's y
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
  var byX={};
  var origCol=colfunc;
  var probe=function(){
    var x=dc_x;
    if(dc_yl<=${ROW} && dc_yh>=${ROW}){
      var cid='?';
      outer:
      for(var L=0;L<LIGHTLEVELS;L++){ var sl=scalelight[L];
        for(var d=0;d<MAXLIGHTSCALE;d++){ if(sl[d]===dc_colormap){ cid='sl'+L+':'+d; break outer; } } }
      if(dc_colormap===zlight[0]||false){}
      var zz='';
      for(var L=0;L<LIGHTLEVELS;L++){ if(zlight[L]===dc_colormap) zz='zl'+L; }
      byX[x]=cid+(zz?'|'+zz:'')+'|'+(curline&&curline.frontsector?('ll'+curline.frontsector.lightlevel):'')
        +(curline?('t'+(curline.sidedef&&curline.sidedef.midtexture||0)+' top'+(curline.sidedef&&curline.sidedef.toptexture||0)+' bot'+(curline.sidedef&&curline.sidedef.bottomtexture||0)):'')
        +'|'+((rw_scale/65536)|0);
    }
    return origCol();
  };
  basecolfunc=probe; colfunc=probe;
  R_RenderPlayerView(vp);
  colfunc=basecolfunc=origCol;
  var px=[];
  for(var x=0;x<320;x++){
    var v=viewbuffer[${ROW}*320+x]>>>0;
    px.push(x+':'+(v>>>0).toString(16)+(byX[x]?' ('+byX[x]+')':''));
  }
  return px.join('\\n');
})()`));
