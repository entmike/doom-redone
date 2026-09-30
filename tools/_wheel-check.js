// Live wheel check WITHOUT stubbing pointer lock: real dispatch on the real page.
const http = require('http');
const getJSON = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: 9333, path: p, timeout: 5000 }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej); });
(async () => {
  const list = await getJSON('/json');
  const page = list.find(t => t.type === 'page' && /index\.html/.test(t.url));
  if (!page) throw new Error('no game tab');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((r, j) => { const i = ++id; pend.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.addEventListener('message', ev => { const msg = JSON.parse(ev.data); if (msg.id && pend.has(msg.id)) { const { r, j } = pend.get(msg.id); pend.delete(msg.id); msg.error ? j(new Error(JSON.stringify(msg.error))) : r(msg.result); } });
  await send('Runtime.enable');
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;

  // snapshot current tab state
  console.log('state:', await ev(`JSON.stringify({
    gs: gamestate, map: G.currentMapName,
    lock: document.pointerLockElement ? document.pointerLockElement.tagName : null,
    canvasEl: !!document.querySelector('canvas'),
    canvasIsLock: document.pointerLockElement === document.querySelector('canvas'),
    ready: G.player.readyweapon, owned: G.player.weaponowned.join(',') })`));

  // dispatch a real wheel event WITHOUT touching the lock
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 480, y: 300, deltaX: 0, deltaY: -120 });
  await new Promise(r => setTimeout(r, 600));
  console.log('after wheel (no lock stub):', await ev(`JSON.stringify({
    ready: G.player.readyweapon, pending: G.player.pendingweapon })`));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
