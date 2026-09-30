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
    if(m.id&&pending.has(m.id)){const{res,rej}=pending.get(m.id);pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:8791/index.html'});
  await new Promise(r=>setTimeout(r,4000));
  const evalr=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw new Error('EVAL: '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text));return r.result.value;};
  console.log('hud:', await evalr('document.getElementById("hud").textContent'));
  console.log(await evalr(`(function(){
    var X=-512*FRACUNIT|0, Y=-576*FRACUNIT|0, ang=330*4294967296/360>>>0;
    var p=G.player;
    p.mo.x=X; p.mo.y=Y; p.mo.momx=0; p.mo.momy=0; p.mo.angle=ang; p.mo.z=0;
    var noop={forwardmove:0,sidemove:0,angleturn:0,buttons:0}; for (var i=0;i<15;i++) G.G_Ticker(noop);
    G.R_RenderPlayerView(G.player);
    var n=0; for (var s of G.sectors){ for (var t=s.thinglist;t;t=t.snext)n++; }
    return JSON.stringify({vissprites:vissprite_p, sectorThings:n});
  })()`));
  for (let _w = 0; _w < 100; _w++) { const _r = await send('Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true, awaitPromise: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
  const {data}=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('/tmp/doom-sprites.png',Buffer.from(data,'base64'));
  console.log('errors:',errors.length?errors.slice(0,3):'NONE');
  process.exit(0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
