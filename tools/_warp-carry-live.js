// Live: kit player on E1M1, use the SIDE-PANEL map dropdown warp to E1M3,
// verify inventory carries (was G_InitNew => pistol+50).
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
  console.log('start:', await evl(`startGame(3,1,1)`));
  await sleep(1000);
  console.log('kit:', await evl(`(function(){var p=G.players[0];
    p.health=175;p.armorpoints=120;p.armortype=1;p.ammo[1]=33;p.ammo[2]=18;
    p.weaponowned[2]=true;p.weaponowned[3]=true;p.readyweapon=p.pendingweapon=3;
    if(p.mo)p.mo.health=175; return p.health})()`));
  // side-panel warp: set dropdown + fire change event
  console.log('warp:', await evl(`(function(){
    const sel=document.getElementById('ch-map');
    sel.value='E1M3';
    sel.dispatchEvent(new Event('change'));
    return 'dispatched';})()`));
  let after = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    after = await evl(`JSON.stringify({gs:gamestate, map:G.currentMapName,
      hp:G.players[0].health, ar:G.players[0].armorpoints,
      ammo:G.players[0].ammo.slice(), ow:G.players[0].weaponowned.slice(0,5),
      ready:G.players[0].readyweapon, st:G.players[0].playerstate, skill:G.gameskill})`);
    if (JSON.parse(after).map === 'E1M3' && JSON.parse(after).gs === 'level') break;
  }
  console.log('after:', after);
  console.log('exceptions:', JSON.stringify(events.slice(0, 3)));
  ws.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
