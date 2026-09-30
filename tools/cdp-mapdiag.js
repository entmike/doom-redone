// dump automap canvas as PNG + transform diagnostics
const http = require('http');
const fs = require('fs');
function rpc(ws, id, method, params) {
  return new Promise((res, rej) => {
    ws.send({ id, method, params: params || {} }.__proto__ && JSON.stringify({ id, method, params: params || {} }));
    const h = ev => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', h); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
    ws.addEventListener('message', h);
  });
}
(async () => {
  const list = await new Promise((res) => http.get('http://127.0.0.1:9333/json', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }));
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  const diag = await rpc(ws, 5, 'Runtime.evaluate', { expression: `(function(){
    var b = Automap.__bounds ? Automap.__bounds() : null;
    var pl = G.player;
    var r = document.getElementById('automap').getBoundingClientRect();
    return JSON.stringify({
      bounds: b,
      player: {x: pl.mo.x>>16, y: pl.mo.y>>16},
      rect: {w: r.width, h: r.height},
      canvas: document.getElementById('automap').width + 'x' + document.getElementById('automap').height,
      numlines: numlines, numverts: numvertexes,
      vbox: (function(){var x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
        for(var i=0;i<numvertexes;i++){var vx=vertexes[i].x>>16, vy=vertexes[i].y>>16;
          if(vx<x0)x0=vx; if(vx>x1)x1=vx; if(vy<y0)y0=vy; if(vy>y1)y1=vy;}
        return [x0,y0,x1,y1];})()
    });
  })()`, returnByValue: true });
  console.log(diag.result.value);
  for (let _w = 0; _w < 100; _w++) { const _r = await rpc(ws, 991, 'Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
  const shot = await rpc(ws, 6, 'Runtime.evaluate', { expression: `document.getElementById('automap').toDataURL()`, returnByValue: true });
  fs.writeFileSync('/tmp/automap_only.png', Buffer.from(shot.result.value.split(',')[1], 'base64'));
  console.log('saved /tmp/automap_only.png');
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
