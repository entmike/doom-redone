// Attach to the LIVE playing tab (no reload), wrap S_StartSound for 90 s,
// logging every monster-alert-family dispatch with distance + final verdict.
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
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
  console.log(await ev(`(function(){
    if (window.__alertTrap) return 'already armed';
    window.__alertTrap = [];
    var ALERTS = {}; // ids 34..47: bspot..cacsit family
    var orig = Snd.S_StartSound;
    Snd.S_StartSound = function(o, i){
      var nm = Snd._S_sfx[i] && Snd._S_sfx[i].name || ('id'+i);
      if (/sit|spit|posit|bspot|headat|bspit/.test(nm) || (i>=34 && i<=47)) {
        var d = null;
        try {
          if (o && G.player.mo) {
            var dx = Math.abs(o.x - G.player.mo.x), dy = Math.abs(o.y - G.player.mo.y);
            d = ((dx + dy - (dx < dy ? dx : dy)) / 65536) | 0;
          }
        } catch(e){}
        var out = { vol: 127, sep: 0, pitch: 0 };
        var audible = null;
        try { if (o && G.player.mo && o !== G.player.mo) audible = Snd._adjust ? undefined : undefined; } catch(e){}
        window.__alertTrap.push({ t: Date.now(), nm: nm, id: i, dist: d, ch: Snd.activeChannels });
      }
      return orig(o, i);
    };
    window.__alertRestore = function(){ Snd.S_StartSound = orig; return window.__alertTrap.length; };
    return 'armed on ' + (typeof G !== 'undefined' && G.currentMapName) + ' gs=' + (typeof gamestate !== 'undefined' ? gamestate : '?');
  })()`));
  console.log('Play now — walk up to the human soldiers so they spot you. Logging for 90 s.');
  await new Promise(r => setTimeout(r, 90000));
  console.log(await ev(`(function(){
    var n = window.__alertRestore();
    return JSON.stringify({ dispatches: n, probe: Snd._probe(),
      log: window.__alertTrap.map(function(x){ return x.nm + '@' + x.dist; }) });
  })()`));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
