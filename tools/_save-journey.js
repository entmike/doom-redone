// User-specified journey:
// 1) boot with doom1.wad, save a test entry
// 2) load DOOM2.wad
// 3) reload the page (still DOOM2)
// 4) load doom1.wad again
// 5) is the original doom1 save visible?
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
async function attach() {
  if (ws) { try { ws.close(); } catch (e) {} }
  const list = await getJSON('/json');
  const page = list.find(t => t.type === 'page' && /index\.html|about:blank/.test(t.url)) || list.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  ws.addEventListener('message', e2 => { const msg = JSON.parse(e2.data); if (msg.id && pend.has(msg.id)) { const { res, rej } = pend.get(msg.id); pend.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); } });
  await send('Runtime.enable'); await send('Page.enable');
}
async function nav(url, waitMs) {
  await send('Page.navigate', { url });
  await new Promise(r => setTimeout(r, waitMs || 9000));
}
async function startLevel() {
  const m = JSON.parse(await ev(`JSON.stringify((function(){var r=document.getElementById('screen').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})())`));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: m.x, y: m.y, button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: m.x, y: m.y, button: 'left', clickCount: 1, buttons: 0 });
  await new Promise(r => setTimeout(r, 600));
  for (let i = 0; i < 4; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await new Promise(r => setTimeout(r, 900));
    if ((await ev(`gamestate`)) === 'level') break;
  }
  return await ev(`gamestate`);
}
const snap = () => ev(`JSON.stringify({ gs: gamestate, wad: (document.title.match(/doom[^ ]*/i)||[null])[0],
  fp: (typeof WadInstall!=='undefined'?WadInstall.fingerprint():null),
  slots: [0,1,2,3,4,5].map(i=>SAVE.readSlot(i)),
  keys: Object.keys(localStorage).filter(k=>k.startsWith('doom-redone')) })`);

(async () => {
  await attach();

  // STEP 1: boot doom1.wad, save "doom1 test"
  await nav('http://127.0.0.1:8791/index.html?wad=wads/doom1.wad&map=E1M1&cb=' + Date.now());
  console.log('1a boot doom1:', await snap());
  console.log('1b level state:', await startLevel());
  await ev(`SAVE.G_SaveGame(3, 'doom1 test'); true`);
  await new Promise(r => setTimeout(r, 700));
  console.log('1c after save:', await snap());

  // STEP 2: load DOOM2.wad (URL switch = hot install of the other IWAD)
  await nav('http://127.0.0.1:8791/index.html?wad=wads/DOOM2.wad&map=MAP01&cb=' + Date.now());
  console.log('2  DOOM2 loaded:', await snap());

  // STEP 3: reload the page (still DOOM2)
  await nav('http://127.0.0.1:8791/index.html?wad=wads/DOOM2.wad&map=MAP01&cb=' + Date.now());
  console.log('3  after reload (DOOM2):', await snap());

  // STEP 4: back to doom1.wad
  await nav('http://127.0.0.1:8791/index.html?wad=wads/doom1.wad&map=E1M1&cb=' + Date.now());
  const fin = JSON.parse(await snap());
  console.log('4  back on doom1:', JSON.stringify(fin));
  const found = fin.slots.some(s => s === 'doom1 test');
  console.log(found ? '\nRESULT: original doom1 save VISIBLE after the whole journey'
                    : '\nRESULT: ORIGINAL SAVE LOST — keys: ' + JSON.stringify(fin.keys));
  process.exit(found ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
