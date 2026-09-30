const http = require('http'); const fs = require('fs');
const PORT = 9333;
function getJSON(path){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:PORT,path},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej);});}
let ws, msgId=0; const pending=new Map();
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
  // shot 0: at spawn
  let {data}=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('/tmp/walk-0.png',Buffer.from(data,'base64'));
  // walk forward 3 seconds (105 tics) via the game's own tic loop
  console.log(await evalr(`(function(){
    var p=G.player;
    // face open direction (east toward the switch/door from spawn room)
    p.mo.angle=0; p.mo.momx=0; p.mo.momy=0;
    var fwd={forwardmove:50,sidemove:0,angleturn:0,buttons:0};
    for (var i=0;i<105;i++) G.G_Ticker(fwd);
    G.R_RenderPlayerView(p);
    return 'after 105 tics: x='+(p.mo.x>>16)+' y='+(p.mo.y>>16)+' z='+(p.mo.z>>16);
  })()`));
  for (let _w = 0; _w < 100; _w++) { const _r = await send('Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true, awaitPromise: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
  ({data}=await send('Page.captureScreenshot',{format:'png'}));
  fs.writeFileSync('/tmp/walk-3s.png',Buffer.from(data,'base64'));
  // another second of walking then shot
  await evalr(`(function(){var fwd={forwardmove:50,sidemove:0,angleturn:0,buttons:0};for(var i=0;i<35;i++)G.G_Ticker(fwd);G.R_RenderPlayerView(G.player);})()`);
  for (let _w = 0; _w < 100; _w++) { const _r = await send('Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true, awaitPromise: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
  ({data}=await send('Page.captureScreenshot',{format:'png'}));
  fs.writeFileSync('/tmp/walk-4s.png',Buffer.from(data,'base64'));
  console.log('shots: /tmp/walk-0.png /tmp/walk-3s.png /tmp/walk-4s.png');
  process.exit(0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
