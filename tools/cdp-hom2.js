// browser: render A over sentinel, render B, return stale-retention px map
// usage: node tools/cdp-hom2.js <mapf> <AX> <AY> <AA> <BX> <BY> <BA>
const http=require('http'), fs=require('fs');
const [MAPF,AX,AY,AA,BX,BY,BA]=process.argv.slice(2);
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
  const out=await ev(`(function(){
    window._frozen=1; window.requestAnimationFrame=function(){return 0;};
    R_SetViewSize(11,0); R_ExecuteSetViewSize();
    var SENT=0xFF00FEED;
    function clr(){for(var i=0;i<viewbuffer.length;i++)viewbuffer[i]=SENT;}
    function render(x,y,angDeg){
      var X=(x*FRACUNIT)|0, Y=(y*FRACUNIT)|0, ang=Math.round(angDeg*4294967296/360)>>>0;
      var ssub=subsectors[R_PointInSubsector(X,Y)];
      var vp={x:X,y:Y,angle:ang,player:{viewz:4194304,extralight:0,fixedcolormap:0,
        mo:{flags:0,x:X,y:Y,angle:ang,subsector:ssub}}};
      R_RenderPlayerView(vp);
      return Array.from(viewbuffer,function(v){return v>>>0;});
    }
    clr(); var freshB=render(${BX},${BY},${BA});
    var painted=[]; for(var i=0;i<64000;i++) if(freshB[i]!==SENT) painted.push(i);
    clr(); var A=render(${AX},${AY},${AA});
    var staleB=render(${BX},${BY},${BA});
    var stale=[];
    for(var k=0;k<painted.length;k++){var i=painted[k];
      if(staleB[i]!==freshB[i] && staleB[i]===A[i]) stale.push(i);}
    return JSON.stringify({painted:painted.length, stale:stale.map(function(i){return i;})});
  })()`);
  const r=JSON.parse(out);
  console.log('painted='+r.painted,'STALE='+r.stale.length);
  if(r.stale.length){
    const cols={};
    for(const i of r.stale){const x=i%320,y=(i/320)|0;(cols[x]=cols[x]||[]).push(y);}
    const cx=Object.keys(cols).map(Number).sort((a,b)=>a-b);
    console.log('stale cols='+cx.length, cx.slice(0,40).map(x=>x+':['+cols[x][0]+'-'+cols[x][cols[x].length-1]+']').join(' '));
  }
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
