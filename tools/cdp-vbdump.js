// browser full-frame + table dump at pose -> /tmp/<out>.json + .png-ish info
const http=require('http'), fs=require('fs');
const [MAPF,SX,SY,VZ,OUTP]=process.argv.slice(2);
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
  console.log('meta:', await ev(`(function(){
    window._frozen=1; window.requestAnimationFrame=function(){return 0;};
    var g=player;
    g.mo.x=(${SX}*65536)|0; g.mo.y=(${SY}*65536)|0; g.mo.angle=0;
    P_SetThingPosition(g.mo);
    g.mo.z=0; g.mo.floorz=0; g.mo.lastangle=0;
    g.bob=0; g.deltaviewheight=0;
    var ssub=subsectors[R_PointInSubsector(g.mo.x,g.mo.y)];
    var vp={x:g.mo.x,y:g.mo.y,angle:0,player:{viewz:${VZ},extralight:0,fixedcolormap:0,
      mo:{flags:g.mo.flags,x:g.mo.x,y:g.mo.y,angle:0,subsector:ssub}}};
    R_RenderPlayerView(vp);
    window.__vb=Array.from(viewbuffer,function(v){return v>>>0;});
    var m={};
    try{ m.ds_p=ds_p; }catch(e){ m.ds_p='U'; }
    try{ m.lvp=lastvisplane; }catch(e){ m.lvp='U'; }
    try{ m.sl=scalelight.length; }catch(e){ m.sl='U'; }
    try{ m.sl17=[scalelight[17][0],scalelight[17][1],scalelight[17][2]].join(','); }catch(e){ m.sl17='U'; }
    try{ m.plen=PIX_LUT.length; m.p0=(PIX_LUT[0]>>>0).toString(16); m.p256=(PIX_LUT[256]>>>0).toString(16); }catch(e){ m.plen='U'; }
    try{ m.dshift=String(detailshift); }catch(e){ m.dshift='U'; }
    try{ m.lightgam=typeof gammatable!=='undefined'?'y':'n'; }catch(e){}
    return JSON.stringify(m);
  })()`));
  const vb=await ev('JSON.stringify(window.__vb)');
  if(vb && vb[0] === '['){ fs.writeFileSync(OUTP+'.json', vb); console.log('vb saved', JSON.parse(vb).length); }
  else console.log('vb fail', String(vb).slice(0,100));
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
