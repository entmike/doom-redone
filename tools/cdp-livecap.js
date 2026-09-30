// capture REAL live-loop frames + per-frame renderer state (loop NOT frozen).
// usage: node tools/cdp-livecap.js <mapfile> <ms> <every> <outbase>
const http=require('http'), fs=require('fs');
const [MAPF,MS,EVERY,OUT]=process.argv.slice(2);
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
  console.log('hook:', await ev(`(function(){
    window.__st={frames:[],state:[]};
    var orig=R_RenderPlayerView, n=0;
    R_RenderPlayerView=function(view){
      if(n%(${EVERY|0})===0 && window.__st.frames.length<15){
        orig(view);
        window.__st.frames.push({n:n,out:[].slice.call(viewbuffer)});
        var s={n:n};
        function g(f){try{return f();}catch(e){return 'U';}}
        s.ds_p=g(()=>ds_p);
        s.reflight=g(()=>reflight); s.fixedcolormap=g(()=>fixedcolormap>>>0);
        s.detailshift=g(()=>detailshift);
        s.leveltime=g(()=>(typeof G!=='undefined'&&G?G.leveltime:leveltime));
        var p=g(()=>players[consoleplayer]);
        if(p!=='U'&&p){s.viewz=p.viewz;s.viewheight=p.viewheight;s.extralight=p.extralight;s.pfixed=p.fixedcolormap>>>0;
          s.flags=p.mo.flags;s.damagecount=p.mo.damagecount;s.bonuscount=p.mo.bonuscount;s.x=p.mo.x;s.y=p.mo.y;s.angle=p.mo.angle>>>0;}
        s.mf0=g(()=>{try{return maskfloor&&maskfloor[0]?Array.from(maskfloor[0].slice(90,98)):'U';}catch(e){return 'U';}});
        s.mc0=g(()=>{try{return maskceiling&&maskceiling[0]?Array.from(maskceiling[0].slice(90,98)):'U';}catch(e){return 'U';}});
        window.__st.state.push(s);
      } else { orig(view); }
      n++;
    };
    return 'hooked';
  })()`));
  await sleep(+MS);
  const v=await ev('JSON.stringify(window.__st)');
  fs.writeFileSync('/tmp/'+OUT+'-browser.json', v);
  console.log('captured live frames:', JSON.parse(v).frames.length);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
