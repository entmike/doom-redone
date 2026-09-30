// which drawsegs/lines are visible at pose; plus column ownership at black-smear xs
const http=require('http');
const [MAPF,SX,SY,SA,PXS]=process.argv.slice(2);
const xs=PXS.split(',').map(Number);
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
    if (!window._frozen){ window._frozen=1; window.requestAnimationFrame=function(){return 0;}; }
    var g=player;
    g.mo.x=(${SX}*65536)|0; g.mo.y=(${SY}*65536)|0;
    g.mo.angle=Math.round(${SA}*4294967296/360)>>>0;
    P_SetThingPosition(g.mo);
    g.mo.z=g.mo.subsector.sector.floorheight; g.mo.floorz=g.mo.z;
    g.viewz=g.mo.z+g.viewheight; g.mo.lastangle=g.mo.angle;
    R_RenderPlayerView(g);
    var out=['ds_p='+ds_p];
    for(var i=0;i<ds_p;i++){
      var ds=drawsegs[i]; if(!ds||!ds.curline) continue;
      var ld=ds.curline.linedef, v1=ld.v1, v2=ld.v2;
      out.push('ds'+i+' x='+ds.x1+'-'+ds.x2+' ld='+(ld.index!==undefined?ld.index:'?')
        +' ('+(v1.x>>16)+','+(v1.y>>16)+')->('+(v2.x>>16)+','+(v2.y>>16)+')'
        +' side='+ds.curline.side
        +' back='+(ds.backsector?ds.backsector.index:'-')
        +' top='+(ds.top?ds.top.length:'-')+' bot='+(ds.bottom?ds.bottom.length:'-'));
    }
    return out.join('\\n');
  })()`));
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
