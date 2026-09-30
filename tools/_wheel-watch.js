// Attach to live tab, log real wheel events + gating inputs for 3 minutes.
const http = require('http');
const getJSON = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: 9333, path: p, timeout: 5000 }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej); });
(async () => {
  const list = await getJSON('/json');
  const page = list.find(t => t.type === 'page' && /index\.html/.test(t.url));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((r, j) => { const i = ++id; pend.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.addEventListener('message', ev => { const msg = JSON.parse(ev.data); if (msg.id && pend.has(msg.id)) { const { r, j } = pend.get(msg.id); pend.delete(msg.id); msg.error ? j(new Error(JSON.stringify(msg.error))) : r(msg.result); } });
  await send('Runtime.enable');
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
  console.log(await ev(`(function(){
    window.__ww = [];
    window.__lastReady = G.player.readyweapon;
    document.addEventListener('wheel', function(e){
      window.__ww.push({ dy: e.deltaY, gs: gamestate,
        lock: document.pointerLockElement ? (document.pointerLockElement.id || document.pointerLockElement.tagName) : null,
        tgt: e.target.id || e.target.tagName, ready: G.player ? G.player.readyweapon : -1 });
    }, true);   // capture phase: fires even if something later stops it
    setInterval(function(){
      if (G.player && G.player.readyweapon !== window.__lastReady) {
        window.__ww.push({ switchTo: G.player.readyweapon });
        window.__lastReady = G.player.readyweapon;
      }
    }, 50);
    return 'watch armed 600s; canvas id = ' + (document.querySelector('canvas') || {}).id;
  })()`));
  await new Promise(r => setTimeout(r, 600000));
  console.log(await ev(`JSON.stringify(window.__ww)`));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
