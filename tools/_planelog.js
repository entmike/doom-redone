// Attaches to the open tab and instruments R_DrawPlanes's flat lookup:
// every render, any visplane with picnum out of flatpix range is LOGGED
// immediately (before the crash), with sector/height context. Also captures
// the uncaught error. Runs until killed.
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
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
        console.log('[page]', m.params.args.map(a => a.value !== undefined ? a.value : a.description).join(' '));
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        console.log('[UNCAUGHT]', (d.exception && (d.exception.description || d.exception.value)) || d.text);
      }
    } catch (e) {}
  });
  const call = (m, p) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await call('Runtime.enable');
  const armed = await call('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    if (typeof R_DrawPlanes === 'undefined' || typeof visplanes === 'undefined') return 'no engine internals in scope';
    if (window.__planeWatch) return 'already armed';
    window.__planeWatch = true;
    var seen = {};
    var t = setInterval(function(){
      try {
        for (var i = 0; i < (visplanes.length|0); i++) {
          var pl = visplanes[i];
          if (!pl || pl.picnum === undefined || pl.picnum === skyflatnum) continue;
          if (flatpix[flattranslation[pl.picnum]] === undefined) {
            var k = 'pic' + pl.picnum + '/' + flattranslation[pl.picnum];
            if (!seen[k]) { seen[k] = 1;
              console.error('[PLANEWATCH] bad picnum=' + pl.picnum + ' xlate=' + flattranslation[pl.picnum] +
                ' numflats=' + numflats + ' flatpix=' + flatpix.length +
                ' height=' + (pl.height>>16) + ' light=' + pl.lightlevel +
                ' pos=' + (G.player && G.player.mo ? (G.player.mo.x>>16) + ',' + (G.player.mo.y>>16) + ' z' + (G.player.mo.z>>16) : '?') +
                ' map=' + (typeof G !== 'undefined' ? G.currentMapName : '?') +
                ' tic=' + (typeof G !== 'undefined' ? G.gametic : '?') +
                ' stack=' + (new Error()).stack.split('\\n').slice(1,4).join(' <- '));
            }
          }
        }
      } catch (e) { console.error('[PLANEWATCH] probe err', e.message); }
    }, 100);
    return 'armed';
  })()` });
  console.log('instrument:', armed.result && armed.result.result && armed.result.result.value);
  console.log('watching — reproduce the error now...');
  setTimeout(() => { ws.close(); process.exit(0); }, 1800000);
})().catch(e => { console.log('THREW', e.message); process.exit(1); });
