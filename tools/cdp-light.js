// browser: dump lighting tables + wall draw state at pose
const http=require('http');
const [MAPF,SX,SY,VZ]=process.argv.slice(2);
function getJSON(path){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:9333,path},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>res(JSON.parse(b)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const list=await getJSON('/json');
  const page=list.find(t=>t.type==='page');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r=>ws.onopen=r);
  let id=0; const pend=new Map();
  ws.onmessage=e=>{const j=JSON.parse(e.data);if(j.id&&pend.has(j.id)){pend.get(j.id)(j);pend.delete(j.id);}};
  const call=(m,p={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  const ev=async(expr)=>{const r=await call('Runtime.evaluate',{expression:expr,returnByValue:true});
    if(r.result&&r.result.exceptionDetails)return 'EXC '+JSON.stringify((r.result.exceptionDetails.exception||{}).description||r.result.exceptionDetails.text);
    return (r.result&&r.result.result)?r.result.result.value:'NOVAL';};
  await call('Page.navigate',{url:'http://127.0.0.1:8791/index.html?map='+encodeURIComponent(MAPF)});
  for(let i=0;i<40;i++){ await sleep(500); if(await ev(`(typeof player!=='undefined'&&player)?'ready':'w'`)==='ready')break; }
  console.log(await ev(`(function(){
    window._frozen=1; window.requestAnimationFrame=function(){return 0;};
    var g=player;
    g.mo.x=(${SX}*65536)|0; g.mo.y=(${SY}*65536)|0; g.mo.angle=0;
    P_SetThingPosition(g.mo);
    g.mo.z=0; g.mo.floorz=0; g.viewz=${VZ}; g.mo.lastangle=0;
    g.bob=0; g.deltaviewheight=0; g.viewheight=${VZ};
    // instrument the masked wall drawer: capture first call args
    var log=[];
    var fns=['R_DrawWallColumn','R_DrawMaskedWall','R_DrawSingleSidedWall'];
    fns.forEach(function(n){
      if (typeof window[n]==='function'){
        var orig=window[n];
        window[n]=function(){ if(log.length<3){var ds=window.ds?{x:ds_x1,yl:dc_yl,yh:dc_yh,cm:dc_colormap,tm:dc_texturemid,is:dc_iscale}:{}; log.push(n+' dc_yl='+dc_yl+' dc_yh='+dc_yh+' cm='+dc_colormap+' tm='+dc_texturemid+' is='+dc_iscale);} return orig.apply(null,arguments); };
      }
    });
    R_RenderPlayerView(g);
    var o=[];
    o.push('walllights['+walllights[0]+','+walllights[8]+','+walllights[16]+','+walllights[127]+','+walllights[191]+']');
    o.push('scalelight L17 j0..3: '+scalelight[17][0]+','+scalelight[17][1]+','+scalelight[17][2]+','+scalelight[17][3]);
    o.push('PIX_LUT len='+(typeof PIX_LUT!=='undefined'?PIX_LUT.length:'-')+' @0='+(PIX_LUT[0]||0).toString(16)+' @256='+(PIX_LUT[256]||0).toString(16)+' @8000='+(PIX_LUT[8000]||0).toString(16));
    o.push('drawcalls: '+(log.length?log.join(' || '):'(none of those fn names exist)'));
    o.push('fnames: '+['R_DrawWallColumn','R_DrawMaskedWall','R_DrawSingleSidedWall','R_RenderSegLoop','R_DrawMasked'].map(function(n){return n+'='+(typeof window[n]);}).join(' '));
    return o.join('\\n');
  })()`));
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
