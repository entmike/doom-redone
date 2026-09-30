// Live repro: save a game, reload the page (fresh boot, same WAD), check
// whether SAVE.readSlot still lists it and what localStorage holds.
const http = require('http');
const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9333, path: p, timeout: 5000 }, r => {
    let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let ws;
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
let id = 0; const pend = new Map();
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

  // 1) fresh boot DOOM2
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/index.html?wad=wads/DOOM2.wad&cb=' + Date.now() });
  await new Promise(r => setTimeout(r, 9000));
  console.log('boot:', await ev(`gamestate`));

  // 2) start a level (menu Enter x2 after click unlocks), then save
  const m = JSON.parse(await ev(`JSON.stringify((function(){var r=document.getElementById('screen').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})())`));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: m.x, y: m.y, button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: m.x, y: m.y, button: 'left', clickCount: 1, buttons: 0 });
  await new Promise(r => setTimeout(r, 600));
  for (let i = 0; i < 4; i++) {   // Enter through New Game/skill to a level
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await new Promise(r => setTimeout(r, 900));
  }
  console.log('state before save:', await ev(`gamestate`));
  await ev(`SAVE.G_SaveGame(4, 'live test'); true`);
  await new Promise(r => setTimeout(r, 700));   // let G_Ticker flush pendingSave
  console.log('after save:', await ev(`JSON.stringify({ listing: [0,1,2,3,4,5].map(i=>SAVE.readSlot(i)),
    keys: Object.keys(localStorage).filter(k=>k.startsWith('doom-redone')), fp: (typeof WadInstall!=='undefined'?WadInstall.fingerprint():null) })`));

  // 3) reload page from scratch (no ?cb change matters; fresh document = the user's F5)
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/index.html?wad=wads/DOOM2.wad' });
  await new Promise(r => setTimeout(r, 9000));
  console.log('after reload:', await ev(`JSON.stringify({ gs: gamestate,
    listing: [0,1,2,3,4,5].map(i=>SAVE.readSlot(i)),
    keys: Object.keys(localStorage).filter(k=>k.startsWith('doom-redone')),
    fp: (typeof WadInstall!=='undefined'?WadInstall.fingerprint():null) })`));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
