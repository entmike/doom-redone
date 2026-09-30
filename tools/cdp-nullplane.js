// fresh reload -> teleport -> instrument R_CheckPlane/R_StoreWallRange -> render -> report
const http=require('http'), fs=require('fs');
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
  await call('Page.navigate',{url:'http://127.0.0.1:8791/index.html'});
  for(let i=0;i<40;i++){ await sleep(500); if(await ev(`(typeof player!=='undefined'&&player)?'ready':'wait'`)==='ready')break; }
  console.log('boot:', await ev(`(document.getElementById('hud')||{}).textContent`));
  console.log(await ev(`(function(){
    if (!window._frozen){ window._frozen=1; window.requestAnimationFrame=function(){return 0;}; }
    window.__log=[];
    var origCheck=R_CheckPlane;
    R_CheckPlane=function(pl,start,stop){
      if(!pl){
        var fs2=frontsector, bs=backsector, sg=curline;
        window.__log.push('NULLPLANE markC='+markceiling+' markF='+markfloor
          +' seg ld='+(sg&&sg.linedef?sg.linedef.index:'?')+' side='+sg.sidx
          +' fsec='+(fs2?fs2.floorheight/65536+'..'+fs2.ceilingheight/65536+' cpic'+fs2.ceilingpic:'NULL')
          +' bsec='+(bs?bs.floorheight/65536+'..'+bs.ceilingheight/65536:'NULL')
          +' viewz='+(viewz/65536));
        return {minx:320,maxx:-1,top:ceilingclip,bottom:ceilingclip}; // stub to continue
      }
      return origCheck(pl,start,stop);
    };
    var g=player;
    g.mo.x=(-599*65536)|0; g.mo.y=(-581*65536)|0;
    g.mo.angle=Math.round(291.4*4294967296/360)>>>0;
    P_SetThingPosition(g.mo);
    g.mo.z=g.mo.subsector.sector.floorheight; g.mo.floorz=g.mo.z;
    g.viewz=g.mo.z+g.viewheight; g.mo.lastangle=g.mo.angle;
    var ss=g.mo.subsector;
    var out=['viewerss fh/ch='+(ss.sector.floorheight/65536)+'/'+(ss.sector.ceilingheight/65536)+' cpic='+ss.sector.ceilingpic+' viewz='+(g.viewz/65536)];
    try{ R_RenderPlayerView(g); out.push('RENDER OK'); }
    catch(e){ out.push('THROW '+e.message); }
    return out.concat(window.__log.slice(0,12)).join('\\n');
  })()`));
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});