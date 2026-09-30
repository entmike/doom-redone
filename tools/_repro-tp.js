// Live repro 4: E2M1 teleport-focused — shove the player across every
// teleport special line in the map, ride the teleports, tick hard.
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
  console.log('armed:', await evl(`(() => {
    window.__errs = [];
    window.addEventListener('error', e => window.__errs.push(e.message + ' @' + (e.filename||'').split('/').pop() + ':' + e.lineno + ':' + e.colno + '\\n' + ((e.error && e.error.stack) || '(nostack)').split('\\n').slice(0,12).join('\\n')));
    var pl = G.player;
    pl.cheats |= 1;   // godmode
    // find teleport lines: special 1 = teleported (line special)
    var spots = [];
    for (var i = 0; i < G.lines.length; i++) {
      var L = G.lines[i];
      if ((L.special === 1 || L.special === 2 || L.special === 39) && spots.length < 12)
        spots.push([L.v1.x >> 16, L.v1.y >> 16]);
    }
    window.__spots = spots;
    return JSON.stringify({ teleportLines: spots.length });
  })()`));
  await evl(`(() => {
    var idx = 0, wait = 0;
    (function spin(){
      try {
        var pl = G.player;
        if (wait <= 0 && idx < window.__spots.length) {
          var s = window.__spots[idx++];
          G.P_TeleportMove(pl.mo, s[0]*65536, s[1]*65536, -99999999);
          pl.cmd.forwardmove = 50*65536;
          wait = 70;
        } else { wait--; pl.cmd.forwardmove = 30*65536; pl.cmd.angleturn = 100*65536; }
        pl.cmd.buttons = 0;
      } catch (e) { window.__errs.push('spin:' + e.message + '\\n' + ((e.stack)||'').split('\\n').slice(0,10).join('\\n')); }
      requestAnimationFrame(spin);
    })();
    return 1;
  })()`);
  for (let i = 0; i < 200; i++) {
    await sleep(250);
    const snap = JSON.parse(await evl('JSON.stringify({pos: [G.player.mo.x>>16, G.player.mo.y>>16], errs: window.__errs.length})'));
    if (i % 20 === 0) console.log(JSON.stringify(snap));
    if (snap.errs > 0) break;
  }
  console.log(await evl('JSON.stringify({errs: window.__errs})'));
  ws.close(); process.exit(0);
})().catch(e => { console.log('THREW', e.message); process.exit(1); });
