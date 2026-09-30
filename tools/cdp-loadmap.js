// Load ?map=<file>, report load stats + JS errors, screenshot.
// usage: node tools/cdp-loadmap.js <mapfile.json> <out.png>
const http=require('http'), fs=require('fs');
const [MAPF,OUT]=process.argv.slice(2);
function getJSON(path){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:9333,path},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>res(JSON.parse(b)));}).on('error',rej);});}
(async()=>{
  const list=await getJSON('/json');
  const page=list.find(t=>t.type==='page');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r=>ws.onopen=r);
  let id=0; const pend=new Map();
  ws.addEventListener('message',e=>{const j=JSON.parse(e.data);if(j.id&&pend.has(j.id)){pend.get(j.id)(j);pend.delete(j.id);}});
  const call=(m,p={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  const ev=async(expr)=>{const r=await call('Runtime.evaluate',{expression:expr,returnByValue:true});
    return (r.result&&r.result.result)?r.result.result.value:'EXC';};
  await call('Runtime.enable'); await call('Page.enable');
  let errs=[];
  ws.addEventListener('message',e=>{
    const j=JSON.parse(e.data);
    if(j.method==='Runtime.exceptionThrown') errs.push(JSON.stringify(j.params.exceptionDetails.exception?.description||'').slice(0,160));
    if(j.method==='Runtime.consoleAPICalled'&&j.params.type==='error') errs.push('console: '+j.params.args.map(a=>a.value||a.description||'').join(' ').slice(0,120));
  });
  await call('Page.navigate',{url:'http://127.0.0.1:8791/index.html?map='+encodeURIComponent(MAPF)+'&nc='+Date.now()});
  for(let i=0;i<60;i++){ await new Promise(r=>setTimeout(r,500));
    const st=await ev(`(typeof player!=='undefined'&&player)?((typeof G!=='undefined'&&G?G.leveltime:leveltime)):-1`);
    if(st>=0&&st<120)break; }
  console.log('loaded:', await ev(`'player='+(typeof player!=='undefined'&&!!player)+' mapname='+(G.currentMapJson?G.currentMapJson.mapname:'?')+' lines='+numlines+' segs='+numsegs+' ssecs='+numsubsectors+' sectors='+numsectors+' things='+things.length`));
  await new Promise(r=>setTimeout(r,2500));
  console.log('after 2.5s live: leveltime=', await ev('G.leveltime'),
    'kills=', await ev('G.totalkills'), 'pos=', await ev(`(player.mo.x>>16)+','+(player.mo.y>>16)`),
    'sec=', await ev('sectors.indexOf(player.mo.subsector.sector)'),
    'viewz=', await ev('player.viewz>>16'));
  for (let _w = 0; _w < 100; _w++) { const _r = await call('Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
  const shot=await call('Page.captureScreenshot',{format:'png'});
  if(shot.result) fs.writeFileSync(OUT||'/tmp/loadmap.png',Buffer.from(shot.result.data,'base64'));
  console.log('ERRORS:', errs.length?errs.slice(0,5):'NONE');
  ws.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
