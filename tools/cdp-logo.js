// Live check: after WAD install, #wadlogo above the cheat panel renders the
// M_DOOM patch from the WAD (data-URL PNG, correct natural size).
const http = require('http');
const getJSON = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: 9333, path: p, timeout: 5000 }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const wad = process.env.WADQ || 'wads/DOOM2.wad';
  const list = await getJSON('/json/list');
  const target = list.find(t => t.type === 'page' && /index\.html/.test(t.url)) || list.find(t => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const call = (m, p) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const evl = async e => { const m = await call('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 300)); return m.result.result.value; };
  await call('Page.enable'); await call('Runtime.enable');
  await call('Page.navigate', { url: 'http://127.0.0.1:8791/index.html?wad=' + wad + '&cb=' + Date.now() });
  let snap = null;
  for (let i = 0; i < 200; i++) {
    await sleep(250);
    snap = await evl(`(function(){
      var img = document.getElementById('wadlogo');
      if (!img) return {err:'no img'};
      var cp = document.getElementById('cheatpanel');
      var r = img.getBoundingClientRect(), cr = cp ? cp.getBoundingClientRect() : null;
      return { gs: (typeof gamestate !== 'undefined') ? gamestate : '?',
               disp: getComputedStyle(img).display, nat: [img.naturalWidth, img.naturalHeight],
               css: [Math.round(r.width), Math.round(r.height)],
               src: (img.getAttribute('src')||'').slice(0, 22),
               aboveCheat: cr ? (r.bottom <= cr.top + 1) : null };
    })()`).catch(e => ({err: e.message}));
    if (snap && snap.disp === 'block') break;
    if (snap && snap.gs && snap.gs !== '?' && i > 40) break;
  }
  console.log(JSON.stringify(snap));
  const ok = snap && snap.disp === 'block' && snap.nat[0] > 0 && snap.src.startsWith('data:image/png') && snap.aboveCheat !== false;
  console.log(ok ? 'LOGO OK (' + (process.env.WADQ || 'wads/DOOM2.wad') + ')' : 'LOGO FAIL');
  ws.close(); process.exit(ok ? 0 : 1);
})().catch(e => { console.log('THREW', e.message); process.exit(1); });
