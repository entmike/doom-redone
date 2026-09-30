// in-page state probe at a pose: node tools/cdp-state.js <mapfile> <x> <y> <ang>
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
  const expr = `(function(){
    if (!window._frozen){ window._frozen=1; window.requestAnimationFrame=function(){return 0;}; }
    var g=player;
    g.mo.x=(${SX}*65536)|0; g.mo.y=(${SY}*65536)|0;
    g.mo.angle=Math.round(${SA}*4294967296/360)>>>0;
    P_SetThingPosition(g.mo);
    g.mo.z=g.mo.subsector.sector.floorheight; g.mo.floorz=g.mo.z;
    g.viewz=g.mo.z+g.viewheight; g.mo.lastangle=g.mo.angle;
    var out=[];
    try{ R_RenderPlayerView(g); out.push('RENDER OK'); }catch(e){ out.push('THROW '+e.message); }
    out.push('viewx='+(viewx>>16)+' viewy='+(viewy>>16)+' viewz='+(viewz>>16));
    out.push('viewangle='+((viewangle>>>0)*360/4294967296).toFixed(2));
    out.push('vieww='+viewwidth+' viewh='+viewheight+' svw='+scaledviewwidth+' centery='+centery+' centeryfrac='+centeryfrac);
    out.push('numnodes='+numnodes+' numsegs='+numsegs+' numsubs='+numsubsectors);
    out.push('ds_p='+ds_p+' lastvisplane='+lastvisplane+' vis_p='+(typeof vis_p!=='undefined'?vis_p:'-'));
    var sub=g.mo.subsector;
    out.push('sub firstline='+sub.firstline+' n='+sub.numlines+' fh='+(sub.sector.floorheight>>16)+' ch='+(sub.sector.ceilingheight>>16));
    var v0=viewbuffer[0]&0xffffff, v50=viewbuffer[50*320+160]&0xffffff, v199=viewbuffer[199*320+160]&0xffffff;
    out.push('vb(0,0)='+v0.toString(16)+' vb(160,50)='+v50.toString(16)+' vb(160,199)='+v199.toString(16));
    return out.join('\\n');
  })()`;
  console.log(await ev(expr));
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
