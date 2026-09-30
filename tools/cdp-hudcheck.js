// geometry probe: HUD visibility + layout overflow at a given viewport size
// usage: node tools/cdp-hudcheck.js [width] [height]
const http = require('http');
function rpc(ws, id, method, params) {
  return new Promise((res, rej) => {
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    const h = ev => {
      const m = JSON.parse(ev.data);
      if (m.id === id) { ws.removeEventListener('message', h); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    };
    ws.addEventListener('message', h);
  });
}
(async () => {
  const W = +(process.argv[2] || 800), H = +(process.argv[3] || 500);
  const list = await new Promise((res) => http.get('http://127.0.0.1:9333/json', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }));
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  await rpc(ws, 1, 'Page.enable');
  await rpc(ws, 2, 'Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await rpc(ws, 3, 'Page.navigate', { url: 'http://127.0.0.1:8791/index.html?nc=' + Date.now() + (process.argv[4] ? '#' + process.argv[4] : '') });
  await new Promise(r => setTimeout(r, 2500));
  const geo = await rpc(ws, 4, 'Runtime.evaluate', { expression: `(function(){
    var r = el => { var b = el.getBoundingClientRect(); return el.id+':'+Math.round(b.x)+','+Math.round(b.y)+' '+Math.round(b.width)+'x'+Math.round(b.height); };
    var hud = document.getElementById('hud');
    var hb = hud.getBoundingClientRect();
    return JSON.stringify({
      vp: innerWidth+'x'+innerHeight,
      hud: r(hud), hudVisible: hb.top >= 0 && hb.bottom <= innerHeight && hb.height > 0 && getComputedStyle(hud).visibility === 'visible',
      hudText: hud.textContent.slice(0,60),
      stage: r(document.getElementById('stage')),
      screen: r(document.getElementById('screen')),
      docScroll: document.documentElement.scrollHeight+'/'+innerHeight
    });
  })()`, returnByValue: true });
  console.log(geo.result.value);
  for (let _w = 0; _w < 100; _w++) { const _r = await rpc(ws, 991, 'Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
  const shot = await rpc(ws, 20, 'Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync('/tmp/hudcheck.png', Buffer.from(shot.data, 'base64'));
  console.log('shot -> /tmp/hudcheck.png');
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
