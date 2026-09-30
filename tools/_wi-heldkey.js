// Live repro of the user's path: hold E (USE), exit level via USE-pressed
// switch, keep holding E through the intermission. Fixed code: counts must
// TICK (no instant totals). Old code: acceleratestage fires tic 1.
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
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/index.html?wad=wads/doom1.9-retail.wad&cb=' + Date.now() });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
  for (let i = 0; i < 80; i++) {
    const okBoot = await ev(`(typeof gotoMap === 'function') && (typeof G !== 'undefined')`).catch(() => false);
    if (okBoot) break;
    await new Promise(r => setTimeout(r, 500));
  }
  await ev(`(async () => { await gotoMap(2, 1); return gamestate; })()`);
  await new Promise(r => setTimeout(r, 1200));

  // trusted keydown E, held for the whole run; kill some monsters first
  await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 69, code: 'KeyE', key: 'e', text: 'e' });
  await ev(`(function(){
    var n = 0;
    for (var th = G.thinkercap.next; th !== G.thinkercap; th = th.next) {
      if (th.health > 0 && th.info && (th.flags & 0x400000) && th !== G.player.mo) {
        try { G.P_DamageMobj(th, null, null, 5000); n++; } catch (e) {}
        if (n >= 12) break;
      }
    }
    G.G_Ticker();
    window.__wis = [];
    // setInterval samples survive background-tab rAF throttling; the game's
    // own loop still drives tics.
    setInterval(function () {
      if (typeof WI !== 'undefined' && WI.state) {
        var c = WI.counts;
        window.__wis.push({ k: c.k, i: c.i, s: c.s, t: c.t, acc: c.acc, sp: WI.sp });
      }
    }, 40);
    window.levelExit = true;
    return 'usedown=' + G.player.usedown + ' kills=' + G.player.killcount;
  })()`);
  await new Promise(r => setTimeout(r, 12000));
  console.log(await ev(`JSON.stringify({
    kills: window.__kills || 'n/a',
    gs: gamestate, wi: WI.state, sp: WI.sp, acc: WI.counts.acc,
    finalK: WI.counts.k,
    kSeq: window.__wis.map(function(x){return x.k;}).filter(function(v,i,a){return i===0||v!==a[i-1];}).slice(0,20),
    distinctK: new Set(window.__wis.map(x=>x.k)).size })`));
  await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 69, code: 'KeyE', key: 'e' });
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
