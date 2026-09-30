// headless per-column light probe: for each wall column, dump lightnum inputs
// env: MAPF SX SY SA VIEWZ
const fs=require('fs'), vm=require('vm');
const ctx = vm.createContext({console, Buffer});
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js);
vm.runInContext(fs.readFileSync('src/engine.js','utf8'),ctx);
const E=(c,t=30000)=>vm.runInContext(c,ctx,{timeout:t});
E('loadMap(JSON.parse(__maps[(process.env.MAPF||"E1M1").toUpperCase()]));');
E('R_SetViewSize(11,0); R_ExecuteSetViewSize();');
const [SX,SY,SA]=['SX','SY','SA'].map(k=>+process.env[k]);
const VZ=+(process.env.VIEWZ||4194304);
console.log(E(`(function(){
  var X=(${SX}*FRACUNIT)|0, Y=(${SY}*FRACUNIT)|0, ang=Math.round(${SA}*4294967296/360)>>>0;
  var ssub=subsectors[R_PointInSubsector(X,Y)];
  var vp={x:X,y:Y,angle:ang,player:{viewz:${VZ},extralight:0,fixedcolormap:0,
    mo:{flags:0,x:X,y:Y,angle:ang,subsector:ssub}}};
  var out=[], seen={};
  var origCol=colfunc, wrapped=false;
  var origRender=R_RenderPlayerView;
  // R_RenderPlayerView sets colfunc=basecolfunc early; wrap once at first call.
  var probe=function(){
    var x=dc_x;
    if(seen[x]===undefined){
      seen[x]=1;
      var cid='?';
      outer:
      for(var L=0;L<LIGHTLEVELS;L++){ var sl=scalelight[L];
        for(var d=0;d<MAXLIGHTSCALE;d++){ if(sl[d]===dc_colormap){ cid=L+':'+d; break outer; } } }
      var ll=curline&&curline.frontsector?curline.frontsector.lightlevel:-1;
      var horiz=curline?(curline.v1.y===curline.v2.y?'H':(curline.v1.x===curline.v2.x?'V':'D')):'-';
      out.push('x'+x+' cm='+cid+' ll='+ll+' seg='+horiz+' sc='+((rw_scale/65536)|0)+' y='+dc_yl+'-'+dc_yh);
    }
    return origCol();
  };
  var orig=R_DrawColumn;
  R_DrawColumn=function(){
    var x=dc_x;
    if(seen[x]===undefined){
      seen[x]=1;
      var cid='?';
      outer:
      for(var L=0;L<LIGHTLEVELS;L++){ var sl=scalelight[L];
        for(var d=0;d<MAXLIGHTSCALE;d++){ if(sl[d]===dc_colormap){ cid=L+':'+d; break outer; } } }
      var ll=curline&&curline.frontsector?curline.frontsector.lightlevel:-1;
      var horiz=curline?(curline.v1.y===curline.v2.y?'H':(curline.v1.x===curline.v2.x?'V':'D')):'-';
      out.push('x'+x+' cm='+cid+' ll='+ll+' seg='+horiz+' sc='+((rw_scale/65536)|0));
    }
    orig();
  };
  wrapped=true;
  var ob=basecolfunc;
  colfunc=probe; basecolfunc=probe;   // R_DrawVisSprite resets colfunc=basecolfunc
  R_RenderPlayerView(vp);
  colfunc=basecolfunc=origCol; basecolfunc=ob;
  R_DrawColumn=orig;
  out.sort(function(a,b){return parseInt(a.slice(1))-parseInt(b.slice(1));});
  return 'extralight='+(typeof extralight!=='undefined'?extralight:'?')+'\\n'+out.join('\\n');
})()`));
