// browser vs headless visplane internals at identical pose
const http=require('http');
const [MAPF,SX,SY,VZ]=process.argv.slice(2);
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
  console.log(await ev(`(function(){
    window._frozen=1; window.requestAnimationFrame=function(){return 0;};
    var g=player;
    g.mo.x=(${SX}*65536)|0; g.mo.y=(${SY}*65536)|0; g.mo.angle=0;
    P_SetThingPosition(g.mo);
    g.mo.z=0; g.mo.floorz=0; g.viewz=${VZ}; g.mo.lastangle=0;
    g.bob=0; g.deltaviewheight=0; g.viewheight=${VZ};
    R_RenderPlayerView(g);
    var o=['ds_p='+ds_p+' lvp='+lastvisplane+' viewheight='+(g.viewheight>>16)];
    for(var p=0;p<lastvisplane;p++){var pl=visplanes[p];
      var marked=0,gaps=[],run=null;
      for(var x=0;x<320;x++){var m=pl.top[x]!==-1;if(m)marked++;if(!m&&run===null)run=x;if(m&&run!==null){gaps.push(run+'-'+(x-1));run=null;}}
      if(run!==null)gaps.push(run+'-319');
      var tops=[];for(var x=0;x<320;x+=40)tops.push(pl.top[x]);
      o.push('vp'+p+' h='+(pl.height>>16)+' pic='+pl.picnum+' light='+pl.lightlevel+' marked='+marked+' gaps=['+gaps.join(',')+'] tops@40='+tops.join(','));
    }
    o.push('vb@(160,50)='+(viewbuffer[50*320+160]&0xffffff).toString(16)+
      ' @(160,100)='+(viewbuffer[100*320+160]&0xffffff).toString(16)+
      ' @(160,150)='+(viewbuffer[150*320+160]&0xffffff).toString(16)+
      ' @(10,10)='+(viewbuffer[10*320+10]&0xffffff).toString(16));
    return o.join('\\n');
  })()`));
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
