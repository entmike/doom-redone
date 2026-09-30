// dump dc_source identity/content + PIX_LUT fingerprint in browser
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
    var info={};
    var orig=colfunc;
    var seen=0;
    colfunc=function(){
      if(seen===0){
        info.srcIsArray=Array.isArray(dc_source);
        info.srcCtor=dc_source&&dc_source.constructor?dc_source.constructor.name:'-';
        info.srcLen=dc_source?dc_source.length:'-';
        info.srcoff=dc_srcoff;
        info.first16=dc_source?Array.from(dc_source.slice?dc_source.slice(dc_srcoff,dc_srcoff+16):{length:0}):[];
        // find texture for this column: segtextured path uses R_TextureTranslationColumn result; capture composite lookup id
        info.dc_source_id = dc_source===window.__tex0 ? 'tex0' : 'other';
      }
      seen++;
      return orig();
    };
    var g=player;
    g.mo.x=(${SX}*65536)|0; g.mo.y=(${SY}*65536)|0; g.mo.angle=0;
    P_SetThingPosition(g.mo);
    g.mo.z=0; g.mo.floorz=0; g.viewz=${VZ}; g.mo.lastangle=0;
    g.bob=0; g.deltaviewheight=0; g.viewheight=${VZ};
    R_RenderPlayerView(g);
    colfunc=orig;
    var lutsum=0, n=0;
    for(var i=0;i<65536;i+=7){lutsum=(lutsum+PIX_LUT[i])|0;n++;}
    info.lutHash=lutsum>>>0;
    info.lutFirst8=Array.from(PIX_LUT.slice(0,8),function(v){return (v>>>0).toString(16);});
    info.lut256_8=Array.from(PIX_LUT.slice(256,264),function(v){return (v>>>0).toString(16);});
    // textures array meta
    try{ info.texCount=textures.length; }catch(e){ info.texCount='U'; }
    try{
      var t=textures.filter(function(t){return t.name==='BRICKV4';})[0];
      info.brickv4=t?('pic num='+t.picnum+' width='+t.width+' height='+t.height):'not found';
      if(t&&t.columns) info.col0=Array.from(t.columns[0].slice? t.columns[0].slice(0,8):[]);
    }catch(e){info.brickv4='ERR '+e.message;}
    info.ylookup=Array.from(ylookup.slice(0,4));
    info.columnofs=Array.from(columnofs.slice(0,4));
    info.centery=centery; info.viewheight=viewheight;
    return JSON.stringify(info);
  })()`));
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
