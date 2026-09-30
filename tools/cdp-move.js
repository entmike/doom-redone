// capture browser frames while MOVING (W held) through the map
// usage: node tools/cdp-move.js <mapfile> <startX> <startY> <startAng> <tics> [fwd]
const http=require('http'), fs=require('fs');
const [MAPF,SX,SY,SA,TICS,FWD]=process.argv.slice(2);
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
  console.log('setup:', await ev(`(function(){
    window._frozen=1; window.requestAnimationFrame=function(){return 0;};
    var g=player;
    g.mo.x=(${SX}*65536)|0; g.mo.y=(${SY}*65536)|0;
    g.mo.angle=Math.round(${SA}*4294967296/360)>>>0;
    P_SetThingPosition(g.mo);
    g.mo.z=g.mo.subsector.sector.floorheight; g.mo.floorz=g.mo.z;
    g.viewz=g.mo.z+g.viewheight; g.mo.lastangle=g.mo.angle;
    g.deltaviewheight=0; g.bob=0;
    return 'ok';
  })()`));
  const frames=[];
  const N=+TICS, STEP=5;
  for(let t=0;t<N;t+=STEP){
    const dump = await ev(`(function(){
      for(var k=0;k<${STEP};k++){
        var c={forwardmove:${FWD||50},sidemove:0,angleturn:0,buttons:0};
        G_Ticker(c);
      }
      player.bob=0; player.deltaviewheight=0; player.viewheight=2686976; player.viewz=(player.mo.z+2686976)|0;
      R_RenderPlayerView(player);
      var out=new Array(64000);
      for(var i=0;i<64000;i++)out[i]=viewbuffer[i]&0xffffff;
      return JSON.stringify({x:player.mo.x,y:player.mo.y,a:player.mo.angle>>>0,vz:player.viewz,z:player.mo.z,out:out});
    })()`);
    frames.push(JSON.parse(dump));
  }
  fs.writeFileSync('/tmp/move-browser.json',JSON.stringify(frames));
  frames.forEach((f,i)=>console.log('f'+i+' x='+(f.x>>16)+' y='+(f.y>>16)+' z='+(f.z>>16)+' a='+(f.a*360/4294967296).toFixed(1)));
  console.log('captured', frames.length);
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
