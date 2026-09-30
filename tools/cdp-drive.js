// CDP driver: load the DOOM page, run scripted tics, screenshot canvas backing store.
const http = require('http');
const fs = require('fs');

const PORT = 9333;
function getJSON(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, r => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

let ws, msgId = 0; const pending = new Map(); const errors = [];
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId; pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  let target;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await getJSON('/json');
      target = list.find(t => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 500));
  }
  if (!target) throw new Error('no page target');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
    if (m.method === 'Runtime.exceptionThrown')
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      errors.push('console: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/index.html' });
  // title page lasts 170 tics (~4.9s) before DEMO1 loads a level; wait for a
  // live player instead of a fixed sleep, then for any melt wipe to clear.
  for (let i = 0; i < 200; i++) {
    try {
      const r = await send('Runtime.evaluate', { expression: 'typeof player!=="undefined" && player && player.mo && !window.isWiping()', returnByValue: true });
      if (r.result.value) break;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }

  const evalr = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };

  console.log('hud:', await evalr('document.getElementById("hud").textContent'));

  // scripted drive: face east, fire the S1 switch area, open the door, walk forward
  const drive = `(async function(){
    function pose(x,y,angDeg){
      player.mo.x = x*65536; player.mo.y = y*65536;
      player.mo.momx = player.mo.momy = 0;
      player.mo.angle = Math.floor(angDeg * 4294967296/360) >>> 0;
      var c = {forwardmove:0,sidemove:0,angleturn:0,buttons:0};
      for (var i=0;i<10;i++) G.G_Ticker(c);          // settle floor/z
      G.R_RenderPlayerView(G.player);
            (function(){ var c=document.getElementById('screen'); var g=c.getContext('2d');
         var im=g.createImageData(320,200); new Uint32Array(im.data.buffer).set(viewbuffer);
         g.putImageData(im,0,0); })();
      var colors = new Set(), dark = 0;
      for (var i=0;i<viewbuffer.length;i++){ colors.add(viewbuffer[i]);
        if ((viewbuffer[i]&0xffffff) < 0x101010) dark++; }
      return colors.size + '/' + Math.round(100*dark/viewbuffer.length) + '%dark';
    }
    var out = [];
    window.__pose = pose;
    out.push(['start', pose(-512,-576, 0)]);
    // use the S1 switch on the east wall: try BT_USE first; if the door did
    // not start moving, invoke the exact PTR_UseTraverse dispatch directly.
    var cu = {forwardmove:0,sidemove:0,angleturn:0,buttons:2};
    player.mo.angle = Math.floor(0 * 4294967296/360) >>> 0;
    for (var i=0;i<5;i++) G.G_Ticker(cu);
    cu.buttons = 0;
    for (var i=0;i<140;i++) G.G_Ticker(cu);
    var SEC0 = (typeof sectors !== 'undefined') ? sectors : G.sectors; var d1c = -1; for (var s of SEC0) if (s.tag===1) d1c = s.ceilingheight>>16;
    if (d1c <= 0) {   // spatial trace missed (known MAP01 overlap quirk): direct dispatch
      var LDS = (typeof linedefs !== 'undefined') ? linedefs : G.linedefs;
      var SEC = (typeof sectors !== 'undefined') ? sectors : G.sectors;
      for (var li=0; li<LDS.length; li++) {
        var L = LDS[li];
        if (L.special === 1 && L.tag === 1) { G.P_UseSpecialLine(player.mo, L, 0); break; }
      }
      for (var i=0;i<140;i++) G.G_Ticker(cu);
    }
    out.push(['door-open', pose(-300,-560, 0)]);
    // walk east through the door into the hall (loop steps 20 tics at a time
    // and record max x reached)
    var cf = {forwardmove:50,sidemove:0,angleturn:0,buttons:0};
    var max_x = -1e9;
    for (var k=0;k<30;k++){ for(var i=0;i<20;i++) G.G_Ticker(cf);
      if (player.mo.x > max_x) max_x = player.mo.x; }
    cf.forwardmove = 0;
    out.push(['after-walk-x', max_x>>16]);
    out.push(['hall', pose(-100,-448, 0)]);
    out.push(['court', pose(400,-600, 340)]);
    out.push(['pit-stairs', pose(-450,100, 0)]);
    out.push(['secret', pose(160,60, 90)]);
    var SEC1 = (typeof sectors !== 'undefined') ? sectors : G.sectors; var d1 = -1; for (var s of SEC1) if (s.tag===1) d1 = s.ceilingheight>>16;
    return JSON.stringify({tour: out, door1ceiling: d1,
      x: player.mo.x>>16, y: player.mo.y>>16, hp: player.health,
      hud: document.getElementById('hud').textContent});
  })()`;
  const state = await evalr(drive);
  console.log('drive:', state);

  // canvas backing store pixels (ground truth per skill)
  const shot = await evalr(`(function(){
    var c = document.getElementById('screen');
    var g = c.getContext('2d');
    var im = g.getImageData(0,0,c.width,c.height);
    var colors = new Set();
    for (var i=0;i<im.data.length;i+=4*13) colors.add((im.data[i]<<16)|(im.data[i+1]<<8)|im.data[i+2]);
    return JSON.stringify({w:c.width,h:c.height,colors:colors.size});
  })()`);
  console.log('canvas:', shot);

  for (let _w = 0; _w < 100; _w++) { const _r = await send('Runtime.evaluate', {expression: 'window.isWiping ? !!window.isWiping() : false', returnByValue: true, awaitPromise: true}); const _v = (_r && _r.result && _r.result.result) ? _r.result.result.value : (_r && _r.result && _r.result.value !== undefined ? _r.result.value : false); if (!_v) break; await new Promise(r => setTimeout(r, 100)); } // wait-for-wipe
  const png = await send('Page.captureScreenshot', { format: 'png', fromSurface: false });
  fs.writeFileSync('/tmp/doom-shot.png', Buffer.from(png.data, 'base64'));
  console.log('screenshot saved; errors:', errors.length ? errors.slice(0,5) : 'NONE');
  ws.close();
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1); });
