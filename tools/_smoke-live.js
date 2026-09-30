// Live smoke: real page -> start E1M1 -> (1) G.SFX/G.MT wiring for automap
// cheat, (2) right-click teleport spawns type-39 fog + dispatches sfx,
// (3) secret message renders centered on the real canvas.
const http = require('http');
const J = (path, method = 'GET', body) => new Promise((res, rej) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port: 9333, path, method,
    headers: data ? { 'content-length': Buffer.byteLength(data) } : {} },
    r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b || '{}')); } catch (e) { res({ raw: b }); } }); });
  req.on('error', rej); if (data) req.write(data); req.end();
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const pages = await J('/json/list');
  let page = pages.find(p => p.type === 'page');
  if (!page) page = await J('/json/new?about:blank', 'PUT');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const events = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') events.push(m.params.exceptionDetails.exception?.description || 'exc'); };
  const send = (method, params) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evl = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return 'EVALERR: ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 300);
    return r.result?.result?.value; };
  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/index.html?wad=wads/doom1.wad&cb=' + Date.now() });
  for (let i = 0; i < 60; i++) {
    if (await evl(`typeof G!=='undefined' && G.players && G.players[0] && G.players[0].mo ? 1:0`) === 1) break;
    await sleep(1000);
  }
  await send('Page.bringToFront');
  console.log('wiring:', await evl(`JSON.stringify({
    G_SFX_telept: G.SFX && G.SFX.sfx_telept, G_SFX_noway: G.SFX && G.SFX.sfx_noway,
    G_MT_TFOG: G.MT && G.MT.TFOG })`));
  console.log('start:', await evl(`startGame(3,1,1)`));
  await sleep(1200);
  // side-panel teleport: open panel if hidden, then right-click its canvas
  const tp = await evl(`(function(){
    var p = G.players[0];
    var t = [];
    const scan = () => { let n = 0; for (let th = G.thinkercap.next; th !== G.thinkercap; th = th.next) if (th.type === 39) n++; return n; };
    const n0 = scan();
    // simulate the cheat handler directly (panel canvas geometry is browser-side;
    // dispatch the real event on it instead)
    const cv = document.querySelector('#mapcanvas canvas') || document.querySelector('canvas.mapcv');
    return JSON.stringify({ hasCanvas: !!cv, fog0: n0 });
  })()`);
  console.log('panel:', tp);
  // dispatch a real right-click on the automap canvas
  const click = await evl(`(function(){
    const cv = (typeof canvas !== 'undefined' && canvas.id === 'mapcv') ? canvas :
      Array.from(document.querySelectorAll('canvas')).find(c => c.id && /map/i.test(c.id));
    if (!cv) return 'no automap canvas';
    const r = cv.getBoundingClientRect();
    const ev = new MouseEvent('contextmenu', {
      clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5, bubbles: true, cancelable: true });
    cv.dispatchEvent(ev);
    let n = 0;
    for (let th = G.thinkercap.next; th !== G.thinkercap; th = th.next) if (th.type === 39) n++;
    return JSON.stringify({ canvas: cv.id, fog39: n });
  })()`);
  console.log('teleport:', click);
  // secret message: set it, let HU tick, sample canvas pixels
  const msg = await evl(`(function(){
    G.players[0].message = G.MSG.SECRET;
    return 'queued';
  })()`);
  await sleep(500);
  console.log('msg queued:', msg);
  const px = await evl(`(function(){
    // sample the 320x200 viewbuffer through whatever canvas holds it
    const vb = (typeof viewbuffer !== 'undefined') ? viewbuffer : null;
    if (!vb) return 'no viewbuffer';
    let minX = 999, maxX = -1, minY = 999, maxY = -1;
    // message rows: find ink around mid-screen y
    for (let i = 0; i < vb.length; i++) {
      const y = (i / 320) | 0, x = i % 320;
      if (y < 90 || y > 108) continue;   // only the centered band
      if (vb[i] !== 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    return JSON.stringify({ minX, maxX, minY, maxY });
  })()`);
  console.log('centered band ink:', px);
  console.log('exceptions:', JSON.stringify(events.slice(0, 3)));
  ws.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
