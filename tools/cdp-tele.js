// reload the live page fresh (any map via ?map=), wait for boot, teleport to pose,
// freeze loop, render+blit, dump canvas pixels as JSON + page screenshot
// usage: node tools/cdp-tele.js <mapfile> <x> <y> <angDeg> <outbase>
const http=require('http'), fs=require('fs');
const [MAPF,SX,SY,SA,OUTP]=process.argv.slice(2);
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
  const ev=async(expr)=>{const r=await call('Runtime.evaluate',{expression:expr,returnByValue:true});if(r.result&&r.result.exceptionDetails)return 'EXC '+JSON.stringify((r.result.exceptionDetails.exception||{}).description||r.result.exceptionDetails.text);return r.result&&r.result.result?r.result.result.value:JSON.stringify(r.result);};
  await call('Page.navigate',{url:'http://127.0.0.1:8791/index.html?map='+encodeURIComponent(MAPF)});
  for(let i=0;i<40;i++){ await sleep(500); const st=await ev(`(typeof player!=='undefined'&&player)?'ready':'wait'`); if(st==='ready')break; }
  console.log('boot:', await ev(`(document.getElementById('hud')||{}).textContent`));
  console.log(await ev(`(function(){
    if (!window._frozen){ window._frozen=1; window.requestAnimationFrame=function(){return 0;}; }
    var g=player;
    g.mo.x=(${SX}*65536)|0; g.mo.y=(${SY}*65536)|0;
    g.mo.angle=Math.round(${SA}*4294967296/360)>>>0;
    P_SetThingPosition(g.mo);
    g.mo.z=g.mo.subsector.sector.floorheight; g.mo.floorz=g.mo.z;
    g.viewz=g.mo.z+g.viewheight; g.mo.lastangle=g.mo.angle;
    var res;
    try{ R_RenderPlayerView(g);
         if (typeof HUD!=='undefined'){ HUD.ST_refresh(g,true); HUD.blitToViewbuffer(viewbuffer); }
         blit(); res='RENDER OK'; }
    catch(e){ res='THROW '+e.message; }
    var c=document.querySelector('canvas');
    var d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    window.__pix=Array.from(d);
    return res+' cw='+c.width+' ch='+c.height;
  })()`));
  const pix=await ev('JSON.stringify(window.__pix)');
  if(pix && pix[0]!=='E'){ fs.writeFileSync(OUTP+'.json',pix); console.log('pixels saved', JSON.parse(pix).length/4); }
  else console.log('pix fail', String(pix).slice(0,120));
  for (let _w = 0; _w < 100; _w++) { const _r = await call('Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
  await call('Page.captureScreenshot',{format:'png'}).then(r=>{fs.writeFileSync(OUTP+'.png',Buffer.from(r.result.data,'base64'));console.log('shot saved');});
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
