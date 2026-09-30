// multi-shot: pose -> blit -> screenshot, for visual debugging
const http = require('http'); const fs = require('fs');
const PORT = 9333;
function getJSON(path){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:PORT,path},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(e)}})}).on('error',rej)})}
let ws, msgId=0; const pending=new Map(); const errors=[];
function send(m,p={}){return new Promise((res,rej)=>{const id=++msgId;pending.set(id,{res,rej});ws.send(JSON.stringify({id,method:m,params:p}))})}
async function main(){
  let target; for(let i=0;i<60;i++){ try{ const l=await getJSON('/json'); target=l.find(t=>t.type==='page'); if(target)break; }catch(e){} await new Promise(r=>setTimeout(r,500)); }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r));
  ws.addEventListener('message', ev => { const m=JSON.parse(ev.data);
    if(m.id&&pending.has(m.id)){const {res,rej}=pending.get(m.id);pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}
    if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:8791/index.html'});
  await new Promise(r=>setTimeout(r,4000));
  const evalr = async e => { const r = await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails) throw new Error('EVAL: '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text)); return r.result.value; };
  await evalr(`(function(){
    window.__pose=function(x,y,angDeg){
      G.player.mo.x=x*65536; G.player.mo.y=y*65536; G.player.mo.momx=G.player.mo.momy=0;
      G.player.mo.angle=Math.floor(angDeg*4294967296/360)>>>0;
      var c={forwardmove:0,sidemove:0,angleturn:0,buttons:0};
      for(var i=0;i<10;i++) G.G_Ticker(c);
      G.R_RenderPlayerView(G.player);
      var cv=document.getElementById('screen'); var g=cv.getContext('2d');
      var im=g.createImageData(320,200); new Uint32Array(im.data.buffer).set(viewbuffer);
      g.putImageData(im,0,0);
      return true;
    };
  })()`);
  const shots = [['secret', 160,60,90], ['court', 400,-600,340], ['pit', -450,100,0]];
  for (const [name,x,y,a] of shots) {
    console.log(name, await evalr(`window.__pose(${x},${y},${a})`));
    for (let _w = 0; _w < 100; _w++) { const _r = await send('Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true, awaitPromise: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
    const png = await send('Page.captureScreenshot',{format:'png',fromSurface:false});
    fs.writeFileSync(`/tmp/doom-${name}.png`, Buffer.from(png.data,'base64'));
  }
  console.log('errors:', errors.length?errors.slice(0,4):'NONE');
  ws.close();
}
main().then(()=>process.exit(0)).catch(e=>{console.error('FATAL',e.message);process.exit(1)});
