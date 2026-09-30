// For each browser frame in /tmp/move-browser.json: render headless at the EXACT
// captured (x,y,angle,viewz) and diff. Isolates renderer state from sim phase.
const fs=require('fs'), vm=require('vm');
const ctx = vm.createContext({console, Buffer});
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js);
vm.runInContext(fs.readFileSync('src/engine.js','utf8'),ctx);
ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, process.env.MAPF || 'E1M1'));
vm.runInContext('loadMap(__map);',ctx,{timeout:30000});
const browser=JSON.parse(fs.readFileSync('/tmp/move-browser.json'));
const res = vm.runInContext(`(function(){
  R_SetViewSize(11,0); R_ExecuteSetViewSize();
  var frames=${JSON.stringify(browser.map(f=>({x:f.x,y:f.y,a:f.a,vz:f.vz})))};
  var out=[];
  frames.forEach(function(fr){
    var ssub=subsectors[R_PointInSubsector(fr.x,fr.y)];
    var vp={x:fr.x,y:fr.y,angle:fr.a>>>0,player:{viewz:fr.vz,extralight:0,fixedcolormap:0,
      mo:{flags:0,x:fr.x,y:fr.y,angle:fr.a>>>0,subsector:ssub}}};
    R_RenderPlayerView(vp);
    var diffs=0, firstAt=null, blackH=0, blackV=0;
    // per-pixel diff vs provided? we can't pass 64000 numbers in cheaply; instead
    // return a compact hash + black-run stats
    var h=0;
    for(var i=0;i<64000;i++){var v=viewbuffer[i]&0xffffff;h=(Math.imul(h,31)+v)|0;}
    // max horizontal black run rows 33..167
    var best=0;
    for(var y=33;y<168;y++){var run=0;
      for(var x=0;x<321;x++){
        var blk=x<320 && (viewbuffer[y*320+x]&0xffffff)===0;
        if(blk)run++; else {if(run>best)best=run;run=0;}
      }}
    out.push({hash:h>>>0, maxBlackH:best});
  });
  return JSON.stringify(out);
})()`,ctx);
const hf=JSON.parse(res);
browser.forEach((br,i)=>{
  let h=0;
  for(let k=0;k<64000;k++){h=(Math.imul(h,31)+(br.out[k]&0xffffff))|0;}
  h=h>>>0;
  const same=h===hf[i].hash;
  console.log('f'+i+' pos('+(br.x>>16)+','+(br.y>>16)+') headless hash='+hf[i].hash.toString(16)+' browser hash='+h.toString(16)+(same?'  IDENTICAL':'  DIFFERS')+' headless maxBlackH='+hf[i].maxBlackH);
});
