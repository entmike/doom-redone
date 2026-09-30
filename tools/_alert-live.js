// Live: wake a human monster, inspect Snd channel manager for the alert sfx.
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
    if (await ev(`(typeof gotoMap === 'function') && (typeof G !== 'undefined')`).catch(() => false)) break;
    await new Promise(r => setTimeout(r, 500));
  }
  await ev(`(async () => { await gotoMap(1, 1); return gamestate; })()`);
  await new Promise(r => setTimeout(r, 1200));
  // spawn a zombieman 128 east of player (proven LOS spot), face west
  console.log('wake:', await ev(`(function(){
    try { Snd.unlock(); } catch(e){}
    var pl = G.player; pl.cheats |= 1;
    var m = G.P_SpawnMobj(pl.mo.x + 128 * 65536, pl.mo.y, 0, 1);
    G.P_SetThingPosition && G.P_SetThingPosition(m);
    m.z = m.subsector.sector.floorheight; m.floorz = m.z;
    m.angle = 0x80000000 >>> 0;
    window.__wake = [];
    var orig = Snd.S_StartSound;
    Snd.S_StartSound = function(o, i2){ window.__wake.push({ id: i2, nm: Snd._S_sfx[i2] && Snd._S_sfx[i2].name, o: !!o }); return orig(o, i2); };
    setTimeout(function(){ Snd.S_StartSound = orig; }, 3000);
    window.__mref = m;
    return 'spawned sight=' + G.P_CheckSight(m, pl.mo);
  })()`));
  // sample the channel table + mix buffer densely for 3 s
  await ev(`(function(){
    window.__ch = [];
    window.__pk = 0;
    var iv = setInterval(function(){
      window.__ch.push(Snd.activeChannels);
      try { var mb = Snd._mixbuffer; for (var i = 0; i < mb.length; i++) { var v = mb[i] < 0 ? -mb[i] : mb[i]; if (v > window.__pk) window.__pk = v; } } catch(e){}
    }, 30);
    setTimeout(function(){ clearInterval(iv); }, 3000);
    // ALSO: wake a second monster at point-blank (under S_CLOSE_DIST=160)
    setTimeout(function(){
      var pl = G.player;
      var m2 = G.P_SpawnMobj(pl.mo.x + 60 * 65536, pl.mo.y, 0, 1);
      G.P_SetThingPosition && G.P_SetThingPosition(m2);
      m2.z = m2.subsector.sector.floorheight; m2.floorz = m2.z;
      m2.angle = 0x80000000 >>> 0;
      G.ACTIONS['A_Look'](m2);   // force immediate seeyou: alert at ~60 units
      // synchronous snapshot: channel table RIGHT after dispatch
      window.__now = Snd.activeChannels;
      Snd._pumpSilent(40);
      var mb0 = Snd._mixbuffer; var pk0 = 0; for (var z = 0; z < mb0.length; z++) { var vv = mb0[z] < 0 ? -mb0[z] : mb0[z]; if (vv > pk0) pk0 = vv; } window.__pumped = pk0;
      var pk = 0;
      for (var k = 0; k < 60; k++) { try { Snd._mix(); } catch(e) { break; } var mb = Snd._mixbuffer; for (var q = 0; q < mb.length; q++) { var v = mb[q] < 0 ? -mb[q] : mb[q]; if (v > pk) pk = v; } }
      window.__nowMix = pk;
      window.__m2 = { dist: 60, seen: G.P_CheckSight(m2, pl.mo), st: m2.state && m2.state.num };
    }, 1500);
    return 'sampling';
  })()`);
  await new Promise(r => setTimeout(r, 3400));
  console.log(await ev(`JSON.stringify({
    wake: window.__wake,
    mState: window.__mref.state && window.__mref.state.num,
    mTarg: !!window.__mref.target,
    chanCounts: window.__ch.filter(function(v,i,a){return i===0||v!==a[i-1];}).slice(0,12), m2: window.__m2, chanNow: window.__now, nowMix: window.__nowMix,
    nChanSnaps: window.__ch.length, mixPeak: window.__pk,
    probe: Snd._probe(), gs: gamestate })`));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
