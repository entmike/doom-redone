// cdp-pace.js — measure LIVE sim pacing vs vanilla's 35 Hz contract, with an
// optional capture load (screenshots per loop, like the CDP drivers use):
//  1) effective sim tick rate (Δoldtics / Δwall-clock)
//  2) tics dropped by the 5-tic catch-up clamp (vanilla drops NONE — d_net.c
//     NetUpdate consumes every elapsed tic; the port's clamp silently eats
//     sim time whenever a frame stall exceeds 5 tics)
//  3) rAF inter-frame interval distribution (renderer clock)
// Usage: node tools/cdp-pace.js [seconds] [stress]
const http = require('http');
const MAP = 'assets/e1m1.json';
const SECS = +(process.argv[2] || 10);
const STRESS = process.argv[3] === 'stress';
function get(p){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:9333,path:p},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>res(b));}).on('error',rej);});}
(async () => {
  let list = JSON.parse(await get('/json/list'));
  let page = list.find(x => x.type === 'page');
  if (!page) page = JSON.parse(await get('/json/new?' + encodeURIComponent('http://127.0.0.1:8791/index.html?map=' + MAP)));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise(r => { const mid = ++id; pend.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  await new Promise(r => ws.onopen = r);
  await send('Page.enable');
  await send('Runtime.enable');
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result.result.value;
  };
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/index.html?map=' + MAP });
  await new Promise(r => setTimeout(r, 4000));
  // wait for live sim
  for (let i = 0; i < 15; i++) {
    try { if (await ev('typeof window.simStats === "function"')) break; } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  // instrument rAF clock inside the page: wrap requestAnimationFrame once
  await ev(`(function(){
    if (window.__frameT) return;
    window.__frameT = [];
    var raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      return raf(function (t) { window.__frameT.push(t); return cb(t); });
    };
  })()`);
  const s0 = JSON.parse(await ev('JSON.stringify(window.simStats())'));
  const w0 = await ev('performance.now()');
  const t_end = Date.now() + SECS * 1000;
  let shots = 0, stalled = false;
  while (Date.now() < t_end) {
    if (STRESS) { await send('Page.captureScreenshot', { format: 'png', fromSurface: false }); shots++; }
    else await new Promise(r => setTimeout(r, 100));
    if (!stalled && Date.now() > t_end - (SECS * 1000) / 2) {
      // Stall test: block the main thread ~300ms (mimics a capture/level
      // hitch). Vanilla TryRunTics replays ALL elapsed tics after the stall
      // — so the window-wide sim rate must still land on 35 Hz. If the port
      // drops tics across the stall, simHz here falls below 35.
      await ev('(function(){var s=performance.now();while(performance.now()-s<300);})()');
      stalled = true;
    }
  }
  await new Promise(r => setTimeout(r, 200));   // let final catch-up run
  const s1 = JSON.parse(await ev('JSON.stringify(window.simStats())'));
  const w1 = await ev('performance.now()');
  const ft = JSON.parse(await ev('JSON.stringify(window.__frameT)'));
  const deltas = [];
  for (let i = 1; i < ft.length; i++) deltas.push(ft[i] - ft[i-1]);
  deltas.sort((a,b)=>a-b);
  const q = p => deltas.length ? +deltas[Math.floor(deltas.length*p)].toFixed(1) : -1;
  const wallMs = w1 - w0, simTics = s1.simTic - s0.simTic;
  console.log(JSON.stringify({
    mode: STRESS ? 'stress(' + shots + ' screenshots)' : 'idle',
    wallMs: Math.round(wallMs),
    simTics,
    simHz: +(simTics / (wallMs/1000)).toFixed(2),
    stallMs: stalled ? 300 : 0,
    idealTics: Math.round(wallMs / (1000/35)),
    frames: ft.length,
    frameDeltaMs: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: +(deltas[deltas.length-1]||0).toFixed(1) }
  }, null, 1));
  const hz = simTics / (wallMs/1000);
  const ticsVsIdeal = simTics - Math.round(wallMs / (1000/35));
  console.log(Math.abs(hz - 35) <= 0.5 && Math.abs(ticsVsIdeal) <= 5
    ? 'PACING OK: sim tracks 35Hz across the stall (vanilla TryRunTics semantics)'
    : 'PACING DIVERGENCE: sim ' + hz.toFixed(2) + 'Hz (want 35), tic delta ' + ticsVsIdeal);
  ws.close(); process.exit(Math.abs(hz - 35) <= 0.5 && Math.abs(ticsVsIdeal) <= 5 ? 0 : 2);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
