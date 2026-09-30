// Live WI probe: trigger exit via window.levelExit in the real page, then
// sample WI.counts + audio mix peak per frame for ~15 s.
const http = require('http');
const getJSON = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: 9333, path: p, timeout: 5000 }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej); });
(async () => {
  const list = await getJSON('/json');
  const page = list.find(t => t.type === 'page' && /index\.html/.test(t.url));
  if (!page) throw new Error('no game tab');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((r, j) => { const i = ++id; pend.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.addEventListener('message', ev => { const msg = JSON.parse(ev.data); if (msg.id && pend.has(msg.id)) { const { r, j } = pend.get(msg.id); pend.delete(msg.id); msg.error ? j(new Error(JSON.stringify(msg.error))) : r(msg.result); } });
  await send('Runtime.enable');
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;

  const gs = await ev(`gamestate`);
  if (gs !== 'level') throw new Error('game tab not in level (state ' + gs + ') — start E1M1 first');

  // arm a per-frame sampler inside the page
  await ev(`(function(){
    window.__wis = { samples: [], audio: [], errs: [] };
    var we = window.onerror; window.onerror = function(m){ window.__wis.errs.push(String(m)); };
    function pump() {
      if (typeof WI !== 'undefined' && WI.state === 1) {
        var c = WI.counts;
        var last = window.__wis.samples[window.__wis.samples.length - 1];
        if (!last || last.sp !== WI.sp || last.k !== c.k || last.i !== c.i || last.t !== c.t)
          window.__wis.samples.push({ ms: Date.now(), sp: WI.sp, k: c.k, i: c.i, s: c.s, t: c.t, p: c.p });
        try {
          var mb = Snd._mixbuffer; var peak = 0;
          for (var i = 0; i < mb.length; i++) { var v = mb[i] < 0 ? -mb[i] : mb[i]; if (v > peak) peak = v; }
          window.__wis.audio.push(peak);
        } catch (e) {}
      }
      if (gamestate !== 'intermission' && window.__wis.samples.length) window.__wis.over = true;
      requestAnimationFrame(pump);
    }
    requestAnimationFrame(pump);
    window.levelExit = true;   // mimic exit switch -> doLevelCompleted
    return 'armed';
  })()`);

  // wait until intermission finishes or 25 s
  const t0 = Date.now();
  let done = false;
  while (Date.now() - t0 < 25000) {
    done = await ev(`window.__wis.over === true`);
    if (done) break;
    await new Promise(r => setTimeout(r, 500));
  }
  const rep = await ev(`(function(){
    var s = window.__wis.samples;
    var peaks = window.__wis.audio;
    var loud = 0; for (var i = 0; i < peaks.length; i++) if (peaks[i] > 500) loud++;
    return JSON.stringify({
      gs: gamestate, done: window.__wis.over === true,
      firstSpStates: s.map(function(x){return x.sp;}).filter(function(v,i,a){return a.indexOf(v)===i;}),
      countTrack: s.filter(function(x,i){return i % Math.max(1, Math.floor(s.length/12)) === 0 || i === s.length-1;}).map(function(x){return x.sp+':'+x.k+'/'+x.i+'/'+x.s+'/'+x.t+'/'+x.p;}),
      samples: s.length, audioFrames: peaks.length, loudFrames: loud, maxPeak: Math.max.apply(null, peaks),
      errs: window.__wis.errs });
  })()`);
  console.log(rep);
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
