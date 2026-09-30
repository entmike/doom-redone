// in-page R_AddLine decision trace at a pose
const http=require('http');
const [MAPF,SX,SY,SA]=process.argv.slice(2);
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
    if (!window._frozen){ window._frozen=1; window.requestAnimationFrame=function(){return 0;}; }
    var g=player;
    g.mo.x=(${SX}*65536)|0; g.mo.y=(${SY}*65536)|0;
    g.mo.angle=Math.round(${SA}*4294967296/360)>>>0;
    P_SetThingPosition(g.mo);
    g.mo.z=g.mo.subsector.sector.floorheight; g.mo.floorz=g.mo.z;
    g.viewz=g.mo.z+g.viewheight; g.mo.lastangle=g.mo.angle;
    // trace: wrap R_AddLine to log decisions for the viewer subsector segs
    var sub=g.mo.subsector, log=[];
    var orig=R_AddLine;
    R_AddLine=function(sg){
      var ld=sg.linedef;
      var x1=sg.v1?sg.v1.x/65536:(segs2?0:0);
      log.push('seg ld='+(ld?ld.index:'?')+' side='+sg.side+' back='+(ld&&ld.backsector?ld.backsector.index:'none')+' two='+(ld?(ld.flags&4):0));
      var before=ds_p;
      orig(sg);
      log[log.length-1]+=' -> ds_p '+before+'->'+ds_p;
      return;
    };
    try{ R_RenderPlayerView(g); }catch(e){ log.push('THROW '+e.message); }
    R_AddLine=orig;
    log.push('ds_p final='+ds_p);
    // which ssectors were visited? count R_Subsector calls
    return log.join('\\n');
  })()`));
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
