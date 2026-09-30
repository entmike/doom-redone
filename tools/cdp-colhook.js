// browser twin of /tmp/colhook.js — wrap colfunc, log first dc_* states
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
    var log=[];
    var orig=colfunc;
    window.__n=0;
    colfunc=function(){
      if(window.__n<6){
        log.push('dc_x='+dc_x+' yl='+dc_yl+' yh='+dc_yh+' iscale='+dc_iscale+' tmid='+dc_texturemid+' cm='+dc_colormap);
      }
      window.__n++;
      return orig();
    };
    var g=player;
    g.mo.x=(${SX}*65536)|0; g.mo.y=(${SY}*65536)|0; g.mo.angle=0;
    P_SetThingPosition(g.mo);
    g.mo.z=0; g.mo.floorz=0; g.viewz=${VZ}; g.mo.lastangle=0;
    g.bob=0; g.deltaviewheight=0; g.viewheight=${VZ};
    R_RenderPlayerView(g);
    log.push('total colfunc calls='+window.__n);
    log.push('gviewz='+(viewz>>16)+' centeryfrac='+centeryfrac+' projection='+projection);
    colfunc=orig;
    return log.join('\\n');
  })()`));
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
