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
  // 1) start pose screenshot
  await evalr('document.getElementById("hud").textContent');
  for (let _w = 0; _w < 100; _w++) { const _r = await send('Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true, awaitPromise: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
  let {data}=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('/tmp/v-start.png',Buffer.from(data,'base64'));
  // 2) teleport into courtyard, face middle, render, shot
  await evalr(`(function(){var p=G.player;p.mo.x=400*FRACUNIT|0;p.mo.y=-400*FRACUNIT|0;p.mo.momx=0;p.mo.momy=0;p.mo.z=0;p.mo.angle=350*4294967296/360>>>0;})();`);
  await new Promise(r=>setTimeout(r,300));
  for (let _w = 0; _w < 100; _w++) { const _r = await send('Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true, awaitPromise: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
  ({data}=await send('Page.captureScreenshot',{format:'png'}));
  fs.writeFileSync('/tmp/v-court.png',Buffer.from(data,'base64'));
  // 3) give pistol and check psprite draws
  console.log(await evalr(`(function(){
    var p=G.player;
    p.weaponowned[1]=true; p.ammo[1]=50;
    var noop={forwardmove:0,sidemove:0,angleturn:0,buttons:0};
    G.G_InitNew(2);
    return 'reborn ok';
  })()`));
  console.log('shots saved');
  process.exit(0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
