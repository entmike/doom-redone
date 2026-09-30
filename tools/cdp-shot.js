// Reproduce the user's screenshot: place player at (x,y,angle), report
// subsector/sector and per-visplane info, screenshot.
// usage: node tools/cdp-shot.js <x> <y> <deg> <out.png>
const http=require('http'), fs=require('fs');
const [X,Y,DEG,OUT]=process.argv.slice(2);
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
    if(r.result&&r.result.exceptionDetails)return 'EXC '+JSON.stringify((r.result.exceptionDetails.exception||{}).description||r.result.exceptionDetails.text);
    return (r.result&&r.result.result)?r.result.result.value:'NOVAL';};
  for(let i=0;i<40;i++){ await new Promise(r=>setTimeout(r,500)); if(await ev(`(typeof player!=='undefined'&&player)?'ready':'w'`)==='ready')break; }
  console.log('pose:', await ev(`(function(){
    var g=player;
    g.mo.x=((${X})*65536)|0; g.mo.y=((${Y})*65536)|0;
    g.mo.angle=Math.round((${DEG})*4294967296/360)>>>0;
    P_SetThingPosition(g.mo);
    g.mo.z=g.mo.subsector.sector.floorheight; g.mo.floorz=g.mo.z;
    g.viewz=g.mo.z+g.mo.viewheight;
    return 'subsectorSector='+(g.mo.subsector.sector===sectors[sectors.indexOf(g.mo.subsector.sector)]?sectors.indexOf(g.mo.subsector.sector):'?');
  })()`));
  await new Promise(r=>setTimeout(r,400));
  // patch R_Subsector to log visited subsectors + chosen flat pair for one frame
  console.log('trace:', await ev(`(function(){
    window.__trace=[];
    if(!window.__traced){ window.__traced=true;
      var orig=R_Subsector;
      R_Subsector=function(num){
        var sub=subsectors[num];
        var secIdx=sectors.indexOf(sub.sector);
        var segSecs=[];
        for(var i=0;i<sub.numlines;i++){
          var sg=segs[sub.firstline+i];
          segSecs.push(sectors.indexOf(sg.frontsector)+(sg.backsector?('/'+sectors.indexOf(sg.backsector)):''));
        }
        window.__trace.push({sub:num, sec:secIdx, fl:sub.sector.floorpic, cl:sub.sector.ceilingpic, fh:sub.sector.floorheight>>16, ch:sub.sector.ceilingheight>>16, segs:segSecs});
        orig(num);
      };
    }
    return 'ok';
  })()`));
  await new Promise(r=>setTimeout(r,300));
  for (let _w = 0; _w < 100; _w++) { const _r = await call('Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
  const shot=await call('Page.captureScreenshot',{format:'png'});
  if(shot.result) fs.writeFileSync(OUT||'/tmp/shot.png',Buffer.from(shot.result.data,'base64'));
  console.log(await ev('JSON.stringify(window.__trace.slice(0,40))'));
  ws.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
