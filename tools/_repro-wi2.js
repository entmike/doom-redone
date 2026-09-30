// Live repro 6: early hook; E1M8; kill player + exit -> intermission -> E2M1.
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
  await call('Page.addScriptToEvaluateOnNewDocument', { source: [
    'window.__errs = [];',
    'window.addEventListener("error", function(e){ window.__errs.push((e.message||"") + " @" + (e.filename||"").split("/").pop() + ":" + e.lineno + ":" + e.colno + " || " + ((e.error && e.error.stack) || "nostack").split("\\n").slice(0,12).join(" | ")); }, true);',
  ].join('\n') });
  await call('Page.navigate', { url: 'http://127.0.0.1:8791/index.html?wad=wads/doom1.9-retail.wad&map=E1M8&cb=' + Date.now() });
  for (let i = 0; i < 200; i++) {
    await sleep(250);
    const st = await evl(`typeof gamestate !== 'undefined' ? gamestate : '?'`).catch(() => '?');
    if (st === 'level') break;
  }
  await evl('(function spin(){ requestAnimationFrame(spin); })()');
  console.log('armed:', await evl(`(() => {
    G.player.health = 1; G.player.armorpoints = 0; G.player.armortype = 0;
    window.levelExit = true;
    return 'exit fired';
  })()`));
  let last = '';
  for (let i = 0; i < 400; i++) {
    await sleep(250);
    const s = JSON.parse(await evl('JSON.stringify({gs: gamestate, map: (typeof G!=="undefined"&&G.currentMapName)||"?", errs: window.__errs.length})'));
    const k = s.gs + '/' + s.map;
    if (k !== last) { console.log(k, 'errs=' + s.errs); last = k; }
    if (s.errs > 0) break;
    if (s.gs === 'intermission' && i % 20 === 0) await evl('try { WI.Key ? WI.Key(13) : 0 } catch(e){}');  // maybe skip
  }
  console.log(await evl('JSON.stringify({gs: gamestate, map: G.currentMapName, errs: window.__errs})'));
  ws.close(); process.exit(0);
})().catch(e => { console.log('THREW', e.message); process.exit(1); });
