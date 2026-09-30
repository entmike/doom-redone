// Follow-up: sit on the DOOM2 intermission and watch WI state + what
// happens when it finally ends.
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
  const page = pages.find(p => p.type === 'page');
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
  await send('Page.bringToFront');
  for (let i = 0; i < 40; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 32, code: 'Space', key: ' ' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 32, code: 'Space', key: ' ' });
    await sleep(400);
    const s = await evl(`JSON.stringify({gs:gamestate, map:G.currentMapName,
      wi: typeof WI!=='undefined' && WI.wiState!==undefined ? WI.wiState : (typeof WI!=='undefined'&&WI.state?WI.state():'?'),
      hp:G.players[0].health})`);
    if (i % 5 === 0 || JSON.parse(s).gs !== 'intermission') console.log(i, s);
    if (JSON.parse(s).gs !== 'intermission') break;
  }
  console.log('exceptions:', JSON.stringify(events.slice(0, 2)));
  ws.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
