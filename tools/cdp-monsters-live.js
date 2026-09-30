// Live CDP: boot DOOM2.wad in the real browser, jump to MAP01, aggro/spawn
// DOOM 2 monsters, tick, and assert zero exceptions + zero unimplemented warns.
const http = require('http');
const getJSON = (path) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9333, path }, (r) => {
    let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej);
});
(async () => {
  const list = await getJSON('/json/list');
  let page = list.find(t => t.type === 'page');
  if (!page) { const c = await getJSON('/json/new?about:blank'); page = c; }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const events = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') events.push(m);
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable');
  await send('Page.enable');
  const url = 'http://127.0.0.1:8791/index.html?wad=wads/DOOM2.wad&cb=' + Date.now();
  await send('Page.navigate', { url });
  await new Promise(r => setTimeout(r, 6000));   // boot + WAD install + title map
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) return { ERR: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 300) };
    return r.result.result.value;
  };
  console.log('mode:', await ev('globalThis.gamemode'));
  // start game on MAP01 via internal API (title→game), spawn DOOM2 monsters around player, tick
  const r = await ev(`(async () => {
    const out = { steps: [] };
    try {
      if (typeof StartNewGame === 'function') { StartNewGame(); out.steps.push('startfn'); }
      else if (typeof Main !== 'undefined' && Main.newGame) { Main.newGame(); out.steps.push('main.newGame'); }
      else {
        // fall back: dispatch menu key to New Game — engine exposes G
        G.newGame && G.newGame(3,1,1); out.steps.push('G.newGame');
      }
    } catch(e){ out.steps.push('start-ERR ' + e.message); }
    await new Promise(res => setTimeout(res, 1500));
    out.map = G.currentMapJson && G.currentMapJson.mapname;
    out.warns = Object.keys(G.warned || {}).filter(k => /unimplemented/.test(k));
    // spawn DOOM2 monsters near the player and tick 300 rAF-tics
    const mo = G.players[0].mo;
    [64,66,67,68,69,71,7,16,3005,3006,65].forEach((dn,i) =>
      G.P_SpawnMapThing({x:(mo.x>>16)+128+i*64, y:(mo.y>>16), angle:0, type:dn, options:0x0f}));
    out.spawnWarn = Object.keys(G.warned||{}).filter(k=>k.startsWith('doomednum-'));
    try { for (let n=0;n<300;n++) G.G_Ticker(G.players[0].cmd); } catch(e){ out.tickErr = String(e.message||e); }
    let alive=0; for (const s of G.mapdata.sectors) for (let m=s.thinglist;m;m=m.snext) if (m.info && (m.info.flags&4) && m.health>0) alive++;
    out.alive = alive;
    out.warnsAfter = Object.keys(G.warned||{}).filter(k => /unimplemented|unimpl/.test(k));
    return out;
  })()`);
  console.log('probe:', JSON.stringify(r));
  const exceptions = events.filter(e => e.method === 'Runtime.exceptionThrown');
  const warns = events.filter(e => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'warning')
    .map(e => e.params.args.map(a => a.value || a.description || '').join(' ')).filter(s => /unimplemented/.test(s));
  console.log('page exceptions:', exceptions.length, exceptions.length ? JSON.stringify(exceptions[0].params.exceptionDetails.exception?.description?.slice(0,200)) : '');
  console.log('unimpl console warns:', warns.length ? warns.slice(0,6).join(' | ') : 'NONE');
  ws.close();
  const ok = !r.ERR && !r.tickErr && (!r.warnsAfter || !r.warnsAfter.length) && exceptions.length === 0 && warns.length === 0;
  console.log(ok ? 'LIVE OK' : 'LIVE FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.log('HARNESS FAIL', e.message); process.exit(1); });
