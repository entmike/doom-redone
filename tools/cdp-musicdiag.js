// music diagnostic against CDP port arg2 (default 9335)
const http=require('http');
const PORT=process.argv[2]||9335;
function getJSON(path){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:PORT,path},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>res(JSON.parse(b)));}).on('error',rej);});}
(async()=>{
  const list=await getJSON('/json');
  const page=list.find(t=>t.type==='page'&&/8791/.test(t.url));
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r=>ws.onopen=r);
  let id=0;const pend=new Map();
  ws.onmessage=e=>{const j=JSON.parse(e.data);if(j.id&&pend.has(j.id)){pend.get(j.id)(j);pend.delete(j.id);}};
  const call=(m,p={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  const ev=async(expr)=>{const r=await call('Runtime.evaluate',{expression:expr,returnByValue:true});
    if(r.result&&r.result.exceptionDetails)return 'EXC '+((r.result.exceptionDetails.exception||{}).description||r.result.exceptionDetails.text);
    return (r.result&&r.result.result)?JSON.stringify(r.result.result.value):'NOVAL';};
  console.log('probe:', await ev('Snd._probe()'));
  console.log('oplWasm loaded:', await ev('(typeof OPLMusic!=="undefined") && OPLMusic._dbg ? "hasdbg" : (OPLMusic?"api":"none")'));
  console.log('S_Start again:', await ev('(function(){Snd.S_Start();return Snd.musPlaying;})()'));
  await new Promise(r=>setTimeout(r,1500));
  console.log('probe2:', await ev('Snd._probe()'));
  // sample music bytes: is OPL producing nonzero output after block render?
  console.log('music sample:', await ev('(function(){if(!Snd._probe().musicAttached)return "no-music"; var O=window.OPLMusic; if(O._musSample)return O._musSample(); return "no-hook";})()'));
  process.exit(0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
