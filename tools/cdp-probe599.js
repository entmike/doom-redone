// browser-side state probe at the crashing pose
const http=require('http');
function getJSON(path){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:9333,path},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>res(JSON.parse(b)));}).on('error',rej);});}
(async()=>{
  const list=await getJSON('/json');
  const page=list.find(t=>t.type==='page');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r=>ws.onopen=r);
  let id=0; const pend=new Map();
  ws.onmessage=e=>{const j=JSON.parse(e.data);if(j.id&&pend.has(j.id)){pend.get(j.id)(j);pend.delete(j.id);}};
  const call=(m,p={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  const ev=async(expr)=>{const r=await call('Runtime.evaluate',{expression:expr,returnByValue:true});if(r.result&&r.result.exceptionDetails)return 'EXC '+JSON.stringify(r.result.exceptionDetails.exception&&r.result.exceptionDetails.exception.description||r.result.exceptionDetails.text);return r.result&&r.result.result?r.result.result.value:JSON.stringify(r.result);};
  console.log(await ev(`(function(){
    var g=player;
    var ssi=R_PointInSubsector(g.mo.x,g.mo.y);
    var ss=subsectors[ssi], s=ss.sector;
    var out=[];
    out.push('skyflatnum='+skyflatnum);
    out.push('viewz='+(g.viewz>>16)+' fh='+(s.floorheight>>16)+' ch='+(s.ceilingheight>>16)+' fpic='+s.floorpic+' cpic='+s.ceilingpic);
    out.push('viewheight='+(g.mo.viewheight>>16)+' z='+(g.mo.z>>16));
    var sky=[];for(var i=0;i<sectors.length;i++){if(sectors[i].ceilingpic===skyflatnum)sky.push(i);}out.push('skyceils=['+sky+']');
    // reproduce the crash path deterministically
    try{ R_RenderPlayerView(g); out.push('RENDER OK'); }
    catch(e){ out.push('RENDER THROW: '+e.message); }
    return out.join('\\n');
  })()`));
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});