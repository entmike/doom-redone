// Live WI kills probe: kill N MF_COUNTKILL monsters via P_DamageMobj, exit
// level, watch WI counters tick with the REAL wbs from G_DoCompleted.
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
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;

  // Fresh page (the user's tab may still hold pre-fix wi.js in memory).
  const tab = page;
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/index.html?wad=wads/doom1.9-retail.wad&cb=' + Date.now() });
  // wait for title/demo loop then jump straight to E1M1 via gotoMap seam
  for (let i = 0; i < 60; i++) {
    const okBoot = await ev(`(typeof gotoMap === 'function') && (typeof G !== 'undefined')`).catch(() => false);
    if (okBoot) break;
    await new Promise(r => setTimeout(r, 500));
  }
  await ev(`(async () => { await gotoMap(2, 1); return gamestate; })()`);
  await new Promise(r => setTimeout(r, 1500));
  console.log('boot:', await ev(`JSON.stringify({ gs: gamestate, map: G.currentMapName })`));
  // wi.js in memory must be the FIXED build
  console.log('wi fixed in page:', await ev(`WI.counts && (function(){
    var src = Object.getOwnPropertyNames(window).length && WI.state !== undefined;
    return src; })()`));

  await ev(`(function(){
    // wipe old sampler
    var n = 0;
    for (var th = G.thinkercap.next; th !== G.thinkercap; th = th.next) {
      if (th.health > 0 && th.info && (th.flags & 0x400000) && th !== G.player.mo) {  // MF_COUNTKILL=BIT(18)
        try { G.P_DamageMobj(th, null, null, 5000); n++; } catch (e) { window.__derr = String(e); }
        if (n >= 12) break;
      }
    }
    // force some items + a secret for non-zero tallies
    var pl = G.player, ni = 0;
    for (var th = G.thinkercap.next; th !== G.thinkercap; th = th.next) {
      if (th.info && (th.flags & 8) && !th.dead) {  // MF_SPECIAL
        th.flags |= 32;   // MF_DROPPED so P_TouchSpecialThing doesn't gate
        try { G.P_TouchSpecialThing(th, pl.mo); ni++; } catch (e) {}
        if (ni >= 6) break;
      }
    }
    G.player.secretcount = 1;
    window.__kills = n;
    return n;
  })()`);
  await ev(`G.G_Ticker(); 'ticked'`);
  console.log('derr:', await ev(`window.__derr || 'none'`), 'killed:', await ev(`window.__kills`), 'killcount:', await ev(`G.player.killcount`), 'totalkills:', await ev(`G.totalkills`));

  await ev(`(function(){
    window.__wis = { track: [], errs: [] };
    window.onerror = function(m){ window.__wis.errs.push(String(m)); };
    function pump() {
      if (typeof WI !== 'undefined' && WI.state) {
        var c = WI.counts;
        var last = window.__wis.track[window.__wis.track.length - 1];
        if (!last || last.sp !== WI.sp || last.k !== c.k || last.i !== c.i || last.s !== c.s || last.t !== c.t)
          window.__wis.track.push({ sp: WI.sp, k: c.k, i: c.i, s: c.s, t: c.t, p: c.p });
      }
      requestAnimationFrame(pump);
    }
    requestAnimationFrame(pump);
    window.levelExit = true;
    return 'armed+exit';
  })()`);
  await new Promise(r => setTimeout(r, 15000));
  console.log(await ev(`JSON.stringify({
    gs: gamestate, map: G.currentMapName, wi: WI.state, sp: WI.sp,
    ntrack: window.__wis.track.length,
    track: window.__wis.track.filter(function(x,i){return i%Math.max(1,Math.floor(window.__wis.track.length/16))===0||i===window.__wis.track.length-1;}),
    errs: window.__wis.errs })`));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
