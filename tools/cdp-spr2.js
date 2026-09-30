const http = require('http'); const fs = require('fs');
const PORT = 9333;
function getJSON(path){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:PORT,path},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej);});}
let ws, msgId=0; const pending=new Map(); const errors=[];
function send(method,params={}){return new Promise((res,rej)=>{const id=++msgId;pending.set(id,{res,rej});ws.send(JSON.stringify({id,method,params}));});}
(async()=>{
  let target;
  for(let i=0;i<60;i++){ try{ const l=await getJSON('/json'); target=l.find(t=>t.type==='page'); if(target)break; }catch(e){} await new Promise(r=>setTimeout(r,500)); }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r));
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);
    if(m.id&&pending.has(m.id)){const{res,rej}=pending.get(m.id);pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}});
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:8791/index.html'});
  await new Promise(r=>setTimeout(r,4000));
  const evalr=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw new Error('EVAL: '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text));return r.result.value;};
  console.log(await evalr(`(function(){
    var p=G.player;
    p.mo.x=-512*FRACUNIT|0; p.mo.y=-576*FRACUNIT|0; p.mo.momx=0; p.mo.momy=0;
    p.mo.z=0;
    var out=[];
    // dump things: sprite type, position, and try manual project
    var sec=p.mo.subsector.sector;
    out.push('playsector things:');
    for (var t=sec.thinglist;t;t=t.snext)
      out.push('  sp='+JSON.stringify(t.sprite)+' frame='+t.frame+' @'+((t.x>>16)+','+(t.y>>16))+' flags='+t.flags);
    // all sectors
    var n=0; for (var s of G.sectors) for (var t=s.thinglist;t;t=t.snext) n++;
    out.push('total sectorlinked='+n);
    // what is spriteNameIdx keyed by?
    out.push('sprites count='+sprites.length+' nameIdx keys sample='+Object.keys(spriteNameIdx).slice(0,6).join(','));
    // run full view + check vissprite_p, plus instrument R_ProjectSprite failure
    G.R_RenderPlayerView(p);
    out.push('after view vissprite_p='+vissprite_p);
    return out.join('\\n');
  })()`));
  process.exit(0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
