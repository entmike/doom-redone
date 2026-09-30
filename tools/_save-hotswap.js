// Same-WAD hot-load journey (the path the side-panel file picker / dropdown
// uses, NOT a URL reload): boot doom1 -> save slot 0 -> hot-load DOOM2 ->
// hot-load doom1 again -> is the save listed? Dumps fingerprint at each hop.
const http = require('http');
const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9333, path: p, timeout: 5000 }, r => {
    let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let ws, id = 0; const pend = new Map();
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
  if (r.exceptionDetails) return 'EVALERR ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result.value;
};
(async () => {
  const list = await getJSON('/json');
  const page = list.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  ws.addEventListener('message', e2 => { const msg = JSON.parse(e2.data); if (msg.id && pend.has(msg.id)) { const { res, rej } = pend.get(msg.id); pend.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); } });
  await send('Runtime.enable'); await send('Page.enable');

  const snap = () => ev(`JSON.stringify({ fp: WadInstall.fingerprint(),
    slots: [0,1,2,3,4,5].map(i=>SAVE.readSlot(i)) })`);

  await send('Page.navigate', { url: 'http://127.0.0.1:8791/index.html?wad=wads/doom1.wad&map=E1M1&cb=' + Date.now() });
  await new Promise(r => setTimeout(r, 9000));

  // save under doom1 WITHOUT starting a level (direct API — persistence is what's under test)
  await ev(`SAVE.G_SaveGame(0, 'doom1 test'); SAVE.DoSaveGame(); 'saved'`);
  console.log('1 doom1 + save :', await snap());

  // HOT-LOAD DOOM2 the exact way the dropdown/file-picker does: fetch + hotLoadWad
  await ev(`(async () => { const r = await fetch('wads/DOOM2.wad'); const b = await r.arrayBuffer();
    await hotLoadWad(b, 'DOOM2.wad'); })(); 'hotloading'`);
  await new Promise(r => setTimeout(r, 6000));
  console.log('2 hot DOOM2    :', await snap());

  // HOT-LOAD doom1 again (same bytes, same route)
  await ev(`(async () => { const r = await fetch('wads/doom1.wad'); const b = await r.arrayBuffer();
    await hotLoadWad(b, 'doom1.wad'); })(); 'hotloading'`);
  await new Promise(r => setTimeout(r, 6000));
  const fin = await snap();
  console.log('3 hot doom1    :', fin);
  const f = JSON.parse(fin);
  console.log(f.slots[0] === 'doom1 test'
    ? '\nRESULT: save visible on the hot-load path too'
    : '\nRESULT: SAVE MISSING after hot-load round trip <-- bug reproduced');
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
