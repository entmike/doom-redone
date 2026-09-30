// Live: boot E1M1, kit the player, fire the REAL exit->intermission->next
// level flow (levelExit), then inspect inventory on E1M2.
const http = require('http');
const WAD = process.argv[2] || 'doom1.wad';
const START = process.argv[3] || null;   // e.g. 'MAP01' — startGame args below
const J = (path, method = 'GET', body) => new Promise((res, rej) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port: 9333, path, method,
    headers: data ? { 'content-length': Buffer.byteLength(data) } : {} },
    r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b || '{}')); } catch (e) { res({ raw: b }); } }); });
  req.on('error', rej); if (data) req.write(data); req.end();
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const ver = await J('/json/version');
  const pages = await J('/json/list');
  let page = pages.find(p => p.type === 'page');
  const t = await J('/json/new?http://127.0.0.1:8791/index.html?wad=wads/' + WAD, 'PUT');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const events = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') events.push(m.params.exceptionDetails.exception?.description || 'exc'); };
  const send = (method, params) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evl = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return 'EVALERR: ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 400);
    return r.result?.result?.value; };
  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/index.html?wad=wads/' + WAD + '&cb=' + Date.now() });
  // wait for a live player
  for (let i = 0; i < 60; i++) {
    const ok = await evl(`typeof G!=='undefined' && G.players && G.players[0] && G.players[0].mo ? 1 : 0`);
    if (ok === 1) break;
    await sleep(1000);
  }
  // start a real game on E1M1 through the game's own startGame
  const commercial = WAD.toUpperCase().includes('DOOM2') || WAD.toUpperCase().includes('PLUTONIA');
  const startExpr = commercial ? 'startGame(3,0,1)' : 'startGame(3,1,1)';
  console.log('start:', await evl(`(typeof startGame==='function' ? (${startExpr},'ok') : 'no startGame')`));
  await sleep(1500);
  // kit the player like mid-game
  console.log('kit:', await evl(`(function(){
    var p=G.players[0];
    p.health=187; p.armorpoints=150; p.armortype=2;
    p.ammo[1]=40; p.ammo[2]=22; p.ammo[3]=60;
    p.weaponowned[2]=true; p.weaponowned[3]=true;
    p.readyweapon=p.pendingweapon=3;
    if(p.mo){p.mo.health=187;}
    G.leveltime=500; p.killcount=5;
    return 'hp '+p.health;
  })()`));
  // fire the real exit flow
  console.log('exit:', await evl(`window.levelExit = true`));
  // bring tab foreground so rAF/timers run, then hammer USE to skip the tally
  await send('Page.bringToFront');
  let after = null;
  for (let i = 0; i < 240; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 32, code: 'Space', key: ' ' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp',   windowsVirtualKeyCode: 32, code: 'Space', key: ' ' });
    await sleep(500);
    after = await evl(`JSON.stringify({ gs: gamestate, map: G.currentMapName,
      hp: G.players[0].health, ar: G.players[0].armorpoints,
      ammo: G.players[0].ammo.slice(), ow: G.players[0].weaponowned.slice(0,5),
      ready: G.players[0].readyweapon, st: G.players[0].playerstate,
      moHp: G.players[0].mo && G.players[0].mo.health, skill: G.gameskill })`);
    const a = JSON.parse(after);
    if (a.gs === 'level' && a.map !== 'E1M1' && a.map !== 'MAP01') break;
  }
  console.log('after:', after);
  console.log('exceptions:', JSON.stringify(events.slice(0, 3)));
  ws.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
