// per-column wall draw probe: x, rw_scale, light index, dc_colormap row id, first px color
// usage: node tools/cdp-colprobe.js <mapf> <X> <Y> <ANG>
const http=require('http'), fs=require('fs');
const [MAPF,SX,SY,SA]=process.argv.slice(2);
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
    var X=(${SX}*FRACUNIT)|0, Y=(${SY}*FRACUNIT)|0, ang=Math.round(${SA}*4294967296/360)>>>0;
    var ssub=subsectors[R_PointInSubsector(X,Y)];
    var vp={x:X,y:Y,angle:ang,player:{viewz:4194304,extralight:0,fixedcolormap:0,
      mo:{flags:0,x:X,y:Y,angle:ang,subsector:ssub}}};
    // snapshot viewbuffer per-column before/after colfunc to learn which x a call painted
    var rows=[], seen={};
    var orig=R_DrawColumn;
    R_DrawColumn=function(){
      var x=dc_x;
      if(seen[x]===undefined && rows.length<400){
        seen[x]=1;
        // identify colormap: which scalelight row contains dc_colormap? (identity via PIX_LUT row object check)
        var cid='other';
        for(var L=0; L<16; L++){ var sl=scalelight[L]; if(sl){ for(var d=0; d<MAXLIGHTSCALE; d++){ if(sl[d]===dc_colormap){ cid=L+'/'+d; break; } } } if(cid!=='other')break; }
        var idx=(typeof rw_scale!=='undefined')?(rw_scale>>LIGHTSCALESHIFT):-1;
        rows.push({x:x, scale:rw_scale>>>0, idx:idx, cid:cid, fix:fixedcolormap>>>0,
          yl:dc_yl, yh:dc_yh, texmid:dc_texturemid>>>0,
          src:(dc_source&&dc_source.slice)?Array.from(dc_source.slice(dc_srcoff,dc_srcoff+3)):[],
          px:(dc_yl>=0&&dc_yl<200)?(viewbuffer[dc_yl*320+x]>>>0).toString(16):'-'});
      }
      orig();
    };
    R_RenderPlayerView(vp);
    R_DrawColumn=orig;
    rows.sort(function(a,b){return a.x-b.x;});
    // sample every 8 px
    var out=[]; for(var i=0;i<rows.length;i+=3){ var r=rows[i];
      out.push('x'+r.x+' sc='+(r.scale/65536|0)+' idx='+r.idx+' cm='+r.cid+' y='+r.yl+'-'+r.yh+' px='+r.px); }
    return out.join('\\n');
  })()`);
  console.log(out);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
