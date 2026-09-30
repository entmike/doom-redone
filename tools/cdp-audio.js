// in-page audio probe: node tools/cdp-audio.js
// Verifies: clean boot (no exceptions), Snd/OPL globals, music loaded,
// unlock + ctx running (autoplay flag), S_StartSound -> active channel,
// mixer pump produces non-silent mixbuffer.
const http = require('http');
function getJSON(path){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:9333,path},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>res(JSON.parse(b)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const list=await getJSON('/json');
  const page=list.find(t=>t.type==='page');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r=>ws.onopen=r);
  let id=0; const pend=new Map(); const errs=[];
  ws.onmessage=e=>{const j=JSON.parse(e.data);
    if(j.id&&pend.has(j.id)){pend.get(j.id)(j);pend.delete(j.id);return;}
    if(j.method==='Runtime.exceptionThrown')errs.push((j.params.exceptionDetails.exception||{}).description||j.params.exceptionDetails.text);
    if(j.method==='Runtime.consoleAPICalled'&&j.params.type==='error')errs.push(j.params.args.map(a=>a.value||a.description).join(' '));};
  const call=(m,p={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  const ev=async(expr)=>{const r=await call('Runtime.evaluate',{expression:expr,returnByValue:true});
    if(r.result&&r.result.exceptionDetails)return 'EXC '+JSON.stringify((r.result.exceptionDetails.exception||{}).description||r.result.exceptionDetails.text);
    return (r.result&&r.result.result)?r.result.result.value:'NOVAL';};
  await call('Runtime.enable');
  await call('Page.navigate',{url:'http://127.0.0.1:8791/index.html'});
  let ready=false;
  for(let i=0;i<60;i++){ await sleep(500); if(await ev(`(typeof player!=='undefined'&&player&&player.mo&&window.Snd)?'ready':'w'`)==='ready'){ready=true;break;} }
  if(!ready){ console.log('BOOT TIMEOUT'); process.exit(1); }
  await sleep(2500);                                   // let OPL async init + music start land
  const out=[];
  out.push('Snd='+(await ev('typeof Snd'))+' OPL='+(await ev('typeof OPLMusic')));
  out.push('musPlaying='+await ev('Snd.musPlaying'));
  out.push('S_sfx[1].name='+await ev('Snd.S_sfx[1].name'));
  // gesture unlock (headless launched with autoplay-no-gesture-required)
  await ev('Snd.unlock()');
  await sleep(400);
  out.push('ctxState='+await ev('Snd.ctxState'));
  // fire a pistol at the listener and pump the mixer manually
  out.push('fire->'+await ev('(function(){Snd.S_StartSound(player.mo, 1); return Snd.activeChannels;})()'));
  out.push('pump peak='+await ev('(function(){Snd._pumpSilent(256);var b=Snd._mixbuffer,p=0;for(var i=0;i<b.length;i++){var v=b[i]<0?-b[i]:b[i];if(v>p)p=v;}return p;})()'));
  // real tic path: G_Ticker then S_UpdateSounds
  out.push('tic='+await ev('(function(){G.G_Ticker({forwardmove:0,sidemove:0,angleturn:0,buttons:0});Snd.setGametic(Snd.gametic+1);Snd.S_UpdateSounds(player.mo);return Snd.gametic;})()'));
  console.log(out.join('\n'));
  console.log(errs.length ? 'ERRORS:\n'+errs.join('\n') : 'NO-JS-ERRORS');
  process.exit(0);
})().catch(e=>{console.error('PROBE FAIL',e.message);process.exit(1);});
