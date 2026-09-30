// walk test on any map: node tools/cdp-walkmap.js <mapfile> <tics> <outbase>
const http=require('http'), fs=require('fs');
const [MAPF,TICS,OUTP]=process.argv.slice(2);
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
  console.log('boot:', await ev(`(document.getElementById('hud')||{}).textContent`));
  // drive forward via ticcmd the game loop already builds from `cmd`
  console.log(await ev(`(function(){
    keys['KeyW']=true;
    return 'cmd hook '+(typeof cmd!=='undefined'?'ok':'missing');
  })()`));
  await sleep((+TICS/35*1000)+300);
  console.log('after walk:', await ev(`(function(){var p=player;return 'X:'+(p.mo.x>>16)+' Y:'+(p.mo.y>>16)+' Z:'+(p.mo.z>>16);})()`));
  for (let _w = 0; _w < 100; _w++) { const _r = await call('Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
  await call('Page.captureScreenshot',{format:'png'}).then(r=>{fs.writeFileSync(OUTP+'.png',Buffer.from(r.result.data,'base64'));});
  console.log('shot:',OUTP+'.png');
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
