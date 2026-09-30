// drive live page via native WebSocket: teleport to pose, screenshot + pixel runs
const http=require('http');
function getJSON(path){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:9333,path},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>res(JSON.parse(b)));}).on('error',rej);});}
(async()=>{
  const list=await getJSON('/json');
  const page=list.find(t=>t.type==='page');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r=>ws.onopen=r);
  let id=0; const pend=new Map();
  ws.onmessage=e=>{const j=JSON.parse(e.data);if(j.id&&pend.has(j.id)){pend.get(j.id)(j);pend.delete(j.id);}};
  const call=(m,p={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  const ev=async(expr)=>{const r=await call('Runtime.evaluate',{expression:expr,returnByValue:true});return r.result&&r.result.result?r.result.result.value:JSON.stringify(r);};
  console.log(await ev(`(function(){
    var g=player;
    g.mo.x=(-340*65536)|0; g.mo.y=(-375*65536)|0;
    g.mo.angle=Math.round(134.1*4294967296/360)>>>0;
    P_SetThingPosition(g.mo);
    g.mo.z=g.mo.subsector.sector.floorheight; g.mo.floorz=g.mo.z;
    g.viewz=g.mo.z+g.mo.viewheight;
    return 'sub='+g.mo.subsector.index+' sec='+g.mo.subsector.sector.index;
  })()`));
  await new Promise(r=>setTimeout(r,300));
  for (let _w = 0; _w < 100; _w++) { const _r = await call('Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
  const shot=await call('Page.captureScreenshot',{format:'png'});
  if(shot.result) require('fs').writeFileSync('/tmp/browser-pose.png',Buffer.from(shot.result.data,'base64'));
  console.log(await ev(`(function(){
    var o=[];
    [150,160,170,180].forEach(function(y){
      var runs=[],last=-1;
      for(var x=40;x<280;x++){var i=(y*320+x)*4;var col=(viewbuffer[y*320+x])&0xffffff;if(col!==last){runs.push(x+':'+col.toString(16));last=col;}}
      o.push('y'+y+' '+runs.slice(0,12).join(' '));
    });
    return o.join('\\n');
  })()`));
  ws.close();
})();
