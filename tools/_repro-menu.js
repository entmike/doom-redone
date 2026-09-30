// Live repro 5: early error hook, then keyboard-drive the retail menu:
// Enter -> arrows to EPISODE 2 -> skill -> play E2M1; capture stack.
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
    'window.addEventListener("unhandledrejection", function(e){ window.__errs.push("reject:" + e.reason); });',
  ].join('\n') });
  await call('Page.navigate', { url: 'http://127.0.0.1:8791/index.html?wad=wads/doom1.9-retail.wad&cb=' + Date.now() });
  for (let i = 0; i < 200; i++) {
    await sleep(250);
    const st = await evl(`typeof gamestate !== 'undefined' ? gamestate : '?'`).catch(() => '?');
    if (st === 'title') break;
  }
  console.log('title errs:', await evl('JSON.stringify(window.__errs)'));
  await evl('(function spin(){ requestAnimationFrame(spin); })()');
  const key = async (key, code, keyCode) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    await sleep(350);
  };
  await key('1', 'Digit1', 49);          // G_Responder: '1' opens menu? vanilla: key 1 = menu
  console.log('after menu key:', await evl('JSON.stringify({menu: (typeof MEN!=="undefined" && MEN.menuActive) ? MEN.menuActive() : "?", gs: gamestate})'));
  await key('Enter', 'Enter', 13);        // NEW GAME
  console.log('after enter:', await evl('JSON.stringify({gs: gamestate})'));
  await key('ArrowDown', 'ArrowDown', 40);  // highlight EPISODE 2
  await key('Enter', 'Enter', 13);          // select it -> skill menu
  console.log('after ep2:', await evl('JSON.stringify({gs: gamestate})'));
  await key('Enter', 'Enter', 13);        // skill (first item)
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    const s = JSON.parse(await evl('JSON.stringify({gs: gamestate, map: G.currentMapName, errs: window.__errs.length})'));
    if (s.gs === 'level' || s.errs > 0) break;
  }
  console.log(await evl('JSON.stringify({gs: gamestate, map: G.currentMapName, errs: window.__errs})'));
  ws.close(); process.exit(0);
})().catch(e => { console.log('THREW', e.message); process.exit(1); });
