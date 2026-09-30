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
  // list all things with sprite + sector linkage
  console.log(await evalr(`(function(){
    var out=[]; var n=0;
    for (var s of G.sectors) for (var t=s.thinglist;t;t=t.snext){ n++;
      out.push(JSON.stringify(t.sprite)+'@'+((t.x>>16)+','+(t.y>>16))+' fr'+t.frame);
    }
    return n+' things: '+out.join('  ');
  })()`));
  // stand in hall near courtyard, face nearest POSS, render, screenshot
  console.log(await evalr(`(function(){
    var p=G.player;
    // find nearest POSS
    var best=null,bd=1e18,px=400*FRACUNIT|0,py=-400*FRACUNIT|0;
    for (var s of G.sectors) for (var t=s.thinglist;t;t=t.snext){
      if (t.sprite==='POSS'||t.sprite==='SPOS'){ var d=(t.x-px)*(t.x-px)+(t.y-py)*(t.y-py); if(d<bd){bd=d;best=t;} }
    }
    if(!best) return 'no POSS found';
    p.mo.x=px; p.mo.y=py; p.mo.z=0;
    p.mo.angle=R_PointToAngle2(px,py,best.x,best.y);
    p.viewz=41*FRACUNIT|0;
    G.R_RenderPlayerView(p);
    return 'facing POSS at '+((best.x>>16)+','+(best.y>>16))+' vissprites='+vissprite_p;
  })()`));
  for (let _w = 0; _w < 100; _w++) { const _r = await send('Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true, awaitPromise: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
  const {data}=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('/tmp/doom-monster.png',Buffer.from(data,'base64'));
  console.log('saved /tmp/doom-monster.png');
  process.exit(0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
