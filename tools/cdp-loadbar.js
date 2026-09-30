// Live CDP: boot with a throttled link, watch the WAD loading progress bar
// paint on the canvas (green fill growing), then confirm the game boots after.
const http = require('http');
const getJSON = (path) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9333, path, timeout: 5000 }, r => {
    let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej);
});
const wsSend = (ws, id, method, params) => ws.send(JSON.stringify({ id, method, params }));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = await getJSON('/json/list');
  let target = list.find(t => t.type === 'page' && /index\.html/.test(t.url)) || list.find(t => t.type === 'page');
  if (!target) { console.log('NO PAGE TARGET'); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0;
  const pend = new Map();
  const logs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type);
  };
  const call = (method, params) => new Promise(r => { const i = ++id; pend.set(i, r); wsSend(ws, i, method, params); });
  const evalJs = async expr => {
    const m = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (m.result && m.result.exceptionDetails) throw new Error('PAGE EXC: ' + JSON.stringify(m.result.exceptionDetails).slice(0, 300));
    return m.result && m.result.result ? m.result.result.value : undefined;
  };
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  // ~300 KB/s down so the 11 MB DOOM2.wad takes tens of seconds to stream
  await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: 300 * 1024, uploadThroughput: 1e6 });
  await call('Page.navigate', { url: 'http://127.0.0.1:8791/index.html?wad=wads/DOOM2.wad&cb=' + Date.now() });

  // Watch for the bar: label seen, and green bar pixels (#00a800-ish) count growing
  const seen = { labels: new Set(), maxGreen: 0, frames: 0 };
  const t0 = Date.now();
  let booted = false;
  while (Date.now() - t0 < 120000) {
    let s;
    try {
      s = JSON.parse(await evalJs(`JSON.stringify({
      lp: (typeof loadProgress !== 'undefined' && loadProgress) ? { l: loadProgress.label, f: loadProgress.frac } : null,
      green: (() => { try {
        const d = document.getElementById('screen').getContext('2d').getImageData(60,104,200,8).data;
        let g = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 0x30 && d[i+1] > 0x80 && d[i+2] < 0x30) g++;
        return g; } catch (e) { return -1; } })(),
      state: (typeof gamestate !== 'undefined') ? gamestate : '?',
      css: (() => { const c = document.getElementById('screen');
        if (!c) return [0,0];
        const r = c.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()
    })`));
    } catch (e) { await sleep(250); continue; }   // mid-navigation: skip sample
    if (s.lp) { seen.labels.add(s.lp.l); seen.frames++;
      if (!seen.loadCss || s.css[0] > seen.loadCss[0]) seen.loadCss = s.css; }
    else if (seen.frames) seen.cleared = true;
    if (s.green > seen.maxGreen) seen.maxGreen = s.green;
    // 'level' is the DECLARED initial gamestate — only count as booted once
    // the bar has shown and then been cleared by hotLoadWad.
    if (seen.cleared && (s.state === 'title' || s.state === 'level')) { booted = true; break; }
    await sleep(250);
  }
  await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  // post-load game size for comparison
  const gameCss = JSON.parse(await evalJs(`(() => { const r = document.getElementById('screen').getBoundingClientRect(); return JSON.stringify([Math.round(r.width), Math.round(r.height)]); })()`));
  console.log(JSON.stringify({ labels: [...seen.labels], frames: seen.frames, maxGreen: seen.maxGreen, booted, errs: logs.filter(t => t === 'error').length, loadCss: seen.loadCss, gameCss }, null, 1));
  const sizeOk = seen.loadCss && Math.abs(seen.loadCss[0] - gameCss[0]) <= 2 && Math.abs(seen.loadCss[1] - gameCss[1]) <= 2 && seen.loadCss[0] > 320;
  console.log(seen.labels.size && seen.maxGreen > 500 && booted && sizeOk ? 'PROGRESS-BAR OK' : 'PROGRESS-BAR FAIL');
  process.exit(0);
})().catch(e => { console.log('THREW', e.message); process.exit(1); });
