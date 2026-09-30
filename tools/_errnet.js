// Attaches to the open game tab and logs ALL uncaught errors + console errors
// with full stacks, for 10 minutes, so the user can reproduce naturally.
const http = require('http');
const getJSON = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: 9333, path: p, timeout: 5000 }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej); });
(async () => {
  const list = await getJSON('/json/list');
  const t = list.find(x => /index\.html/.test(x.url)) || list.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    try {
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        console.log('[UNCAUGHT]', (d.exception && (d.exception.description || d.exception.value)) || d.text);
      } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        console.log('[console.error]', m.params.entry.text,
          (m.params.entry.stackTrace || []).slice(0, 8).map(f => (f.url || '').split('/').pop() + ':' + f.lineNumber).join(' <- '));
      }
    } catch (e) { /* ignore */ }
  });
  const call = (m, p) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await call('Runtime.enable');
  await call('Log.enable').catch(() => {});
  // also scrape any error ALREADY on the strip right now
  const cur = await call('Runtime.evaluate', { expression: `(function(){
    var h = document.getElementById('hud');
    return h ? h.textContent : '(no hud el)';
  })()`, returnByValue: true });
  console.log('[current hud strip]', JSON.stringify(cur.result && cur.result.result && cur.result.result.value));
  console.log('watching for 10 min — reproduce the error now...');
  setTimeout(() => { ws.close(); process.exit(0); }, 600000);
})().catch(e => { console.log('THREW', e.message); process.exit(1); });
