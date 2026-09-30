// Live repro 3: retail E2M1 with full combat stress — arsenal, teleport toward
// monsters, aggro, projectiles, 60s of real frames. Captures window.onerror.
const http = require('http');
const getJSON = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: 9333, path: p, timeout: 5000 }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const list = await getJSON('/json/list');
  const t = list.find(x => /index\.html/.test(x.url)) || list.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const call = (m, p) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const evl = async e => { const m = await call('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 300)); return m.result.result.value; };
  await call('Page.enable'); await call('Runtime.enable'); await call('Page.bringToFront').catch(() => {});
  await call('Page.navigate', { url: 'http://127.0.0.1:8791/index.html?wad=wads/doom1.9-retail.wad&map=E2M1&cb=' + Date.now() });
  for (let i = 0; i < 200; i++) {
    await sleep(250);
    const st = await evl(`typeof gamestate !== 'undefined' ? gamestate : '?'`).catch(() => '?');
    if (st === 'level') break;
  }
  console.log(await evl(`(() => {
    window.__errs = [];
    window.addEventListener('error', e => window.__errs.push(e.message + '\\n' + ((e.error && e.error.stack) || '(nostack)').split('\\n').slice(0,10).join('\\n')));
    var pl = G.player;
    pl.cheats |= 1;                                   // CF_GODMODE-ish guard
    pl.ammo[0]=250; pl.ammo[1]=250; pl.ammo[2]=250; pl.ammo[3]=250; pl.ammo[4]=250;
    for (var w=0; w<9; w++) pl.weaponowned[w] = true;
    // wander script: run forward, turn, fire; cycle weapons
    window.__step = 0;
    (function spin(){
      try {
        window.__step++;
        if (window.__step % 90 === 1) { pl.readyweapon = (window.__step/90|0) % 9; pl.pendingweapon = 10; }
        pl.cmd.forwardmove = 30*65536;
        pl.cmd.angleturn = Math.sin(window.__step/40)*80*65536|0;
        pl.cmd.buttons = 1;
      } catch(e) { window.__errs.push('spin:' + e.message); }
      requestAnimationFrame(spin);
    })();
    return 'stressed; monsters=' + (function(){ var n=0; for (var m=globObj; m; m=m.snext) {} return '?'; })();
  })()`).catch(e => 'arm threw: ' + e.message));
  for (let i = 0; i < 240; i++) {
    await sleep(250);
    const snap = JSON.parse(await evl('JSON.stringify({step: window.__step, tic: G.gametic, hp: G.player.health, errs: window.__errs.length})'));
    if (i % 20 === 0) console.log(JSON.stringify(snap));
    if (snap.errs > 0) break;
  }
  console.log(await evl('JSON.stringify({errs: window.__errs})'));
  ws.close(); process.exit(0);
})().catch(e => { console.log('THREW', e.message); process.exit(1); });
