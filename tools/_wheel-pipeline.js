// Full-pipeline wheel test: grab pointer lock with a REAL browser click via
// CDP Input domain, then send REAL wheel events through Chrome's input
// pipeline (Input.dispatchMouseEvent type:mouseWheel — not synthetic JS
// dispatchEvent), and observe weapon changes.
const http = require('http');
const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9333, path: p, timeout: 5000 }, r => {
    let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej);
});
(async () => {
  const list = await getJSON('/json');
  const page = list.find(t => t.type === 'page' && /index\.html/.test(t.url));
  if (!page) { console.log('NO GAME TAB'); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.addEventListener('message', ev => { const msg = JSON.parse(ev.data); if (msg.id && pend.has(msg.id)) { const { res, rej } = pend.get(msg.id); pend.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); } });
  await send('Runtime.enable');
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
    if (r.exceptionDetails) return 'EVALERR: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };

  // Bring tab to front (backgrounded tabs throttle + may drop input routing)
  await send('Page.bringToFront');
  await new Promise(r => setTimeout(r, 400));

  const geom = await ev(`JSON.stringify((function(){
    const c = document.getElementById('screen');
    const r = c.getBoundingClientRect();
    return { cx: Math.round(r.left + r.width/2), cy: Math.round(r.top + r.height/2),
             gs: gamestate, ready: G.player ? G.player.readyweapon : -1 };
  })())`);
  console.log('pre:', geom);
  const g = JSON.parse(geom);

  // REAL click on canvas center -> pointerlock request runs for real.
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g.cx, y: g.cy, button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g.cx, y: g.cy, button: 'left', clickCount: 1, buttons: 0 });
  await new Promise(r => setTimeout(r, 800));
  console.log('lock after real click:', await ev(`document.pointerLockElement ? (document.pointerLockElement.id || 'yes') : null`));

  // REAL wheel through Chrome's input pipeline. deltaY 100 == one notch.
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: g.cx, y: g.cy, deltaX: 0, deltaY: 100, button: 'none' });
  await new Promise(r => setTimeout(r, 300));
  console.log('after wheel +100:', await ev(`JSON.stringify({ready: G.player.readyweapon, pending: G.player.pendingweapon})`));
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: g.cx, y: g.cy, deltaX: 0, deltaY: 100, button: 'none' });
  await new Promise(r => setTimeout(r, 300));
  console.log('after wheel +100 again:', await ev(`JSON.stringify({ready: G.player.readyweapon, pending: G.player.pendingweapon})`));

  // Did the game's own handler see them? Replay-check its guard conditions.
  console.log('handler guards:', await ev(`JSON.stringify({
    gs: gamestate,
    lock: document.pointerLockElement ? document.pointerLockElement.id : null,
    level: gamestate === 'level'
  })`));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
