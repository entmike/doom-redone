const http = require('http');
const J = (path, method = 'GET', body) => new Promise((res, rej) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port: 9333, path, method,
    headers: data ? { 'content-length': Buffer.byteLength(data) } : {} },
    r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b || '{}')); } catch (e) { res({ raw: b }); } }); });
  req.on('error', rej); if (data) req.write(data); req.end();
});
(async () => {
  const pages = await J('/json/list');
  const page = pages.find(p => p.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evl = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.result?.exceptionDetails) return 'EVALERR: ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 200);
    return r.result?.result?.value; };
  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable');
  console.log(await evl(`JSON.stringify({map:G.currentMapName, gs:gamestate,
    hp:G.players[0].health, ar:G.players[0].armorpoints,
    ammo:G.players[0].ammo.slice(), ow:G.players[0].weaponowned.slice(0,6),
    ready:G.players[0].readyweapon, st:G.players[0].playerstate,
    moHp:G.players[0].mo && G.players[0].mo.health, skill:G.gameskill})`));
  ws.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
