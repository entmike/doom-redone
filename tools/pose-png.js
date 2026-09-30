// headless pose -> PNG
const fs=require('fs'), vm=require('vm'), zlib=require('zlib');
const ctx = vm.createContext({console, Buffer});
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js);
vm.runInContext(fs.readFileSync('src/engine.js','utf8'),ctx);
ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, process.env.MAPF || 'E1M1'));
vm.runInContext('loadMap(__map);',ctx,{timeout:30000});
const [sx,sy,adeg,out]=process.argv.slice(2);
const rgba = vm.runInContext(`(function(){
  R_SetViewSize(11,0); R_ExecuteSetViewSize();
  var X=${sx}*FRACUNIT|0, Y=${sy}*FRACUNIT|0, ang=${adeg}*4294967296/360>>>0;
  var vp={x:X,y:Y,angle:ang,player:{viewz:41*FRACUNIT|0,extralight:0,fixedcolormap:0,
    mo:{flags:0,x:X,y:Y,angle:ang,subsector:subsectors[R_PointInSubsector(X,Y)]}}};
  R_RenderPlayerView(vp);
  // expand palette via ASSETS.palette
  var pal = ASSETS.palette;
  var out = new Uint8Array(320*200*3);
  for (var i=0;i<320*200;i++){
    var v = viewbuffer[i] >>> 0;
    out[i*3]=(v>>16)&0xff; out[i*3+1]=(v>>8)&0xff; out[i*3+2]=v&0xff;
  }
  return Array.from(out);
})()`,ctx);
const W=320,H=200;
const pix=Buffer.from(rgba);
const raw=Buffer.concat(Array.from({length:H},(_,y)=>Buffer.concat([Buffer.from([0]),pix.subarray(y*W*3,(y+1)*W*3)])));
function chunk(t,d){return Buffer.concat([Buffer.from([d.length>>24&255,d.length>>16&255,d.length>>8&255,d.length&255]),t,d,Buffer.from([0,0,0,0])]);}
const crcTable=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(b){let c=~0;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return ~c>>>0;}
function ch(t,d){const len=Buffer.alloc(4);len.writeUInt32BE(d.length);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([t,d])));return Buffer.concat([len,t,d,crc]);}
fs.writeFileSync(out,Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
  ch(Buffer.from('IHDR'),(function(){const b=Buffer.alloc(13);b.writeUInt32BE(W,0);b.writeUInt32BE(H,4);b[8]=8;b[9]=2;return b;})()),
  ch(Buffer.from('IDAT'),zlib.deflateSync(raw)),
  ch(Buffer.from('IEND'),Buffer.alloc(0))]));
console.log('wrote',out);
