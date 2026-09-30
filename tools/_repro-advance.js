// Live repro 2: retail, start E1M8, exit level -> intermission -> E2M1.
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
  await call('Page.navigate', { url: 'http://127.0.0.1:8791/index.html?wad=wads/doom1.9-retail.wad&map=E1M8&cb=' + Date.now() });
  for (let i = 0; i < 200; i++) {
    await sleep(250);
    const st = await evl(`typeof gamestate !== 'undefined' ? gamestate : '?'`).catch(() => '?');
    if (st === 'level') break;
  }
  await call('Runtime.evaluate', { expression: `
    window.__errs = [];
    window.addEventListener('error', e => window.__errs.push(e.message + '\\n' + ((e.error && e.error.stack) || '(no stack)').split('\\n').slice(0,10).join('\\n')));
    (function spin(){ if (window.__stopSpin) return; requestAnimationFrame(spin); })();
    window.levelExit = true;              // G_ExitLevel reached the player
  ` });
  // watch state progression for up to 90s (intermission has a long timer)
  let last = '';
  for (let i = 0; i < 360; i++) {
    await sleep(250);
    const snap = JSON.parse(await evl('JSON.stringify({gs: gamestate, map: G.currentMapName, errs: window.__errs.length})'));
    const s = snap.gs + '/' + snap.map;
    if (s !== last) { console.log(s, 'errs=' + snap.errs); last = s; }
    if (snap.errs > 0 || snap.map === 'E2M1') break;
    if (i === 300) { await evl('WI.Skip ? WI.Skip() : 0'); }
  }
  console.log(await evl('JSON.stringify({gs: gamestate, map: G.currentMapName, errs: window.__errs})'));
  ws.close(); process.exit(0);
})().catch(e => { console.log('THREW', e.message); process.exit(1); });
