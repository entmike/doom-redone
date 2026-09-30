// full-page screenshot after letting the game run N ms; optional key injects
// usage: node tools/cdp-page-shot.js <out.png> [waitMs] [key:KeyW:ms ...]
const http = require('http');
const fs = require('fs');
function rpc(ws, id, method, params) {
  return new Promise((res, rej) => {
    const t = { id, method, params: params || {} };
    ws.send(JSON.stringify(t));
    const h = ev => {
      const m = JSON.parse(ev.data);
      if (m.id === id) { ws.removeEventListener('message', h); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    };
    ws.addEventListener('message', h);
  });
}
(async () => {
  const [out, waitMs] = [process.argv[2] || '/tmp/page.png', +(process.argv[3] || 2500)];
  const list = await new Promise((res) => http.get('http://127.0.0.1:9333/json', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }));
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  await rpc(ws, 1, 'Page.enable');
  await rpc(ws, 2, 'Page.navigate', { url: 'http://127.0.0.1:8791/index.html?nc=' + Date.now() });
  await new Promise(r => setTimeout(r, 2500));
  // inject keys from argv tail: key:Code:ms
  for (const spec of process.argv.slice(4)) {
    const [, code, ms] = spec.split(':');
    for (let _w = 0; _w < 100; _w++) { const _r = await rpc(ws, 991, 'Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
    await rpc(ws, 10, 'Input.dispatchKeyEvent', { type: 'keyDown', code, windowsVirtualKeyCode: 0 });
    await new Promise(r => setTimeout(r, +ms || 800));
    for (let _w = 0; _w < 100; _w++) { const _r = await rpc(ws, 991, 'Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
    await rpc(ws, 11, 'Input.dispatchKeyEvent', { type: 'keyUp', code, windowsVirtualKeyCode: 0 });
  }
  await new Promise(r => setTimeout(r, +waitMs));
  for (let _w = 0; _w < 100; _w++) { const _r = await rpc(ws, 991, 'Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
  const shot = await rpc(ws, 20, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  // pull automap diagnostics
  const diag = await rpc(ws, 21, 'Runtime.evaluate', { expression: `(function(){
    try {
      var cv=document.getElementById('automap');
      var g=cv.getContext('2d'); var d=g.getImageData(0,0,cv.width,cv.height).data;
      var red=0,green=0,blue=0,lit=0;
      for(var i=0;i<d.length;i+=4){ if(d[i+3]){lit++;}
        if(d[i]>120&&d[i+1]<60) red++;
        if(d[i+1]>120&&d[i]<80) green++;
        if(d[i+2]>120&&d[i]<80&&d[i+1]<100) blue++; }
      return JSON.stringify({size:cv.width+'x'+cv.height, lit:lit, red:red, green:green, blue:blue,
        hud:document.getElementById('hud').textContent.slice(0,90),
        cap:document.querySelector('#mapside .cap').textContent});
    } catch(e){ return 'DIAG ERR '+e.message; }
  })()`, returnByValue: true });
  console.log('shot ->', out);
  console.log(diag.result.value);
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
