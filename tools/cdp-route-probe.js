// cdp-route-probe.js — deterministic route probe: freeze the live loop,
// reset to the real player-start, then drive scripted ticcmds (forward,
// turn, forward) toward the green armor and report a per-tic trace.
//
// Answers: (1) does the player move before any input is injected
// ("starting too early"), (2) is the scripted route deterministic,
// (3) where does the trace end up relative to the ARM1 (green armor).
//
// The default recipe (20 fwd @50, 13 turn @+1280 CCW, 100 fwd @50) is the
// solver-verified route from tools/route-solve.js that reaches the green
// armor; tools/route-verify.js proves it is tic-deterministic headless.
// Success = armorpoints >= 100 at end (armor actually picked up).
// usage: node tools/cdp-route-probe.js [fwd1] [turnTics] [angleturn] [fwd2]
const http = require('http');
const MAP = 'assets/e1m1.json';
const FWD1 = +(process.argv[2] || 20);
const TURN = +(process.argv[3] || 13);
const ATURN = +(process.argv[4] || 1280);
const FWD2 = +(process.argv[5] || 100);

function getJSON(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: 9333, path }, r => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b)));
    }).on('error', rej);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let page;
  for (let i = 0; i < 40; i++) {
    try { page = (await getJSON('/json')).find(t => t.type === 'page'); if (page) break; } catch (e) {}
    await sleep(500);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', ev => {
    const j = JSON.parse(ev.data);
    if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); }
  });
  const call = (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (expr) => {
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true });
    const res = r.result || {};
    if (res.exceptionDetails) return 'EXC ' + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text);
    return res.result ? res.result.value : 'NOVAL';
  };

  await call('Page.navigate', { url: 'http://127.0.0.1:8791/index.html?map=' + encodeURIComponent(MAP) + '&nc=' + Date.now() });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const ready = await ev(`(typeof player!=='undefined'&&player&&player.mo&&!window.isWiping())?'ready':'w'`);
    if (ready === 'ready') break;
  }

  // Freeze the live tic loop (pattern from cdp-move.js): after this only the
  // scripted G_Ticker calls advance the world.
  console.log('freeze:', await ev(`(function(){
    window._frozen = 1;
    window.requestAnimationFrame = function(){ return 0; };
    return 'ok';
  })()`));

  // Reset to the TRUE player-start from THINGS (not wherever the free run drifted)
  const setup = await ev(`(function(){
    var th = G.things || (G.playerstarts && G.playerstarts[0]);
    var st = G.playerstarts[0];            // first single-player start
    var p = G.player;
    p.mo.x = st.x << 16; p.mo.y = st.y << 16;
    p.mo.momx = p.mo.momy = p.mo.momz = 0;
    p.mo.angle = (Math.floor(st.angle * 4294967296/360)) >>> 0;
    P_SetThingPosition(p.mo);
    p.mo.z = p.mo.subsector.sector.floorheight; p.mo.floorz = p.mo.z;
    p.viewz = p.mo.z + p.viewheight; p.mo.lastangle = p.mo.angle;
    p.deltaviewheight = 0; p.bob = 0;
    p.mo.movedir = 8;
    // find green armor (sprite ARM1)
    var armor = null;
    G.sectors.forEach(function(sec){
      for (var mo = sec.thinglist; mo; mo = mo.snext) {
        if (mo.sprite === 'ARM1' && !armor) armor = { x: mo.x >> 16, y: mo.y >> 16 };
      }
    });
    return JSON.stringify({ start: { x: st.x, y: st.y, ang: st.angle }, armor: armor,
      angNow: p.mo.angle >>> 0, leveltime: G.leveltime });
  })()`);
  console.log('setup:', setup);

  // Phase 0: 35 zero-input tics — player must NOT move. Any drift here is
  // "world/input running before the route starts".
  const idle = await ev(`(function(){
    var p = G.player, x0 = p.mo.x, y0 = p.mo.y, lt = G.leveltime;
    var z = { forwardmove:0, sidemove:0, angleturn:0, buttons:0 };
    for (var i = 0; i < 35; i++) G.G_Ticker(z);
    return JSON.stringify({ moved: { dx: (p.mo.x - x0) >> 16, dy: (p.mo.y - y0) >> 16 },
      leveltimeDelta: G.leveltime - lt });
  })()`);
  console.log('idle-35tics:', idle);

  // Route segments; inject in blocks of 5 tics per CDP call to bound latency.
  async function seg(name, fmv, smv, at, tics) {
    const trace = [];
    let done = 0;
    while (done < tics) {
      const n = Math.min(5, tics - done);
      const r = await ev(`(function(){
        var out = [];
        var c = {forwardmove:${fmv}, sidemove:${smv}, angleturn:${at}, buttons:0};
        for (var i = 0; i < ${n}; i++) {
          G.G_Ticker(c);
          out.push([G.player.mo.x >> 16, G.player.mo.y >> 16,
                    ((G.player.mo.angle >>> 24) * 360 / 256).toFixed(1)]);
        }
        return JSON.stringify(out);
      })()`);
      if (typeof r !== 'string' || r.startsWith('EXC')) { console.log('ERR', name, r); return trace; }
      trace.push(...JSON.parse(r));
      done += n;
    }
    const s = trace[0], e = trace[trace.length - 1];
    console.log(`${name}: start=${s} end=${e} tics=${tics}`);
    return trace;
  }

  const a = await seg('fwd1 ', 50, 0, 0, FWD1);
  const b = await seg('turn ', 0, 0, ATURN, TURN);
  const c2 = await seg('fwd2 ', 50, 0, 0, FWD2);

  const end = await ev(`(function(){
    var p = G.player;
    var armor = null;
    G.sectors.forEach(function(sec){
      for (var mo = sec.thinglist; mo; mo = mo.snext)
        if (mo.sprite === 'ARM1' && !armor) armor = { x: mo.x, y: mo.y };
    });
    var d = armor ? Math.round(Math.hypot(p.mo.x - armor.x, p.mo.y - armor.y) / 65536) : 0;
    return JSON.stringify({ x: p.mo.x >> 16, y: p.mo.y >> 16,
      angDeg: +((p.mo.angle >>> 0) * 360 / 4294967296).toFixed(1),
      armorpoints: p.armorpoints, distToArmor: armor ? d : 0, got: p.armorpoints >= 100 });
  })()`);
  console.log('end:', end);
  const ok = end.includes('"got":true');
  console.log(ok ? 'ROUTE SUCCESS: armor collected' : 'ROUTE FAILED: armor NOT collected');
  console.log('full trace fwd1 end ->', JSON.stringify(a[a.length - 1]),
    '| turn end ->', JSON.stringify(b[b.length - 1]),
    '| fwd2 end ->', JSON.stringify(c2[c2.length - 1]));
  process.exit(ok ? 0 : 2);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
