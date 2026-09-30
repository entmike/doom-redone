// Live CDP: scroll-wheel weapon cycling. Boot DOOM2 MAP01 direct-map, give
// a spread of weapons, dispatch a trusted mouseWheel, and confirm readyweapon
// cycles through OWNED weapons (down=next, up=prev, wrapping).
const http = require('http');
const getJSON = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: 9333, path: p, timeout: 5000 }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = await getJSON('/json/list');
  const target = list.find(t => t.type === 'page' && /index\.html/.test(t.url)) || list.find(t => t.type === 'page');
  if (!target) { console.log('NO PAGE TARGET'); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const call = (method, params) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evl = async e => {
    const m = await call('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (m.result && m.result.exceptionDetails) throw new Error('PAGE EXC ' + JSON.stringify(m.result.exceptionDetails).slice(0, 200));
    return m.result && m.result.result ? m.result.result.value : undefined;
  };
  await call('Page.enable'); await call('Runtime.enable');
  await call('Page.navigate', { url: 'http://127.0.0.1:8791/index.html?wad=wads/DOOM2.wad&map=MAP01&cb=' + Date.now() });
  for (let i = 0; i < 160; i++) {
    const st = await evl(`typeof gamestate !== 'undefined' ? gamestate : '?'`).catch(() => '?');
    if (st === 'level') break;
    await sleep(250);
  }
  // pointer lock: the wheel handler demands it. If headless rejects a real
  // lock, stub the getter probe-side (shipped code untouched).
  const locked = await evl(`(async () => {
    try { await document.getElementById('screen').requestPointerLock(); } catch (e) {}
    if (document.pointerLockElement === document.getElementById('screen')) return 'real';
    Object.defineProperty(document, 'pointerLockElement', { get: () => document.getElementById('screen'), configurable: true });
    return 'stubbed';
  })()`);
  // give pistol+shotgun+chaingun+SSG, ready on pistol
  await evl(`(() => {
    const pl = G.player;
    [0,1,2,3,8].forEach(w => pl.weaponowned[w] = true);
    pl.ammo[0] = 20; pl.ammo[1] = 50; pl.ammo[2] = 50; pl.ammo[3] = 100;  // P_CheckAmmo must not demote to fist
    pl.pendingweapon = 10; pl.readyweapon = 1;
    return 'ok';
  })()`);
  const wheel = async (dy) => {
    await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 300, deltaX: 0, deltaY: dy, clickCount: 0 });
  };
  // real rAF pump: frame() -> buildTiccmd -> G_Ticker must run for the
  // pendingweapon to land; a backgrounded tab throttles, so keep the page
  // "hunting" frames until pendingweapon returns to wp_nochange (10).
  const settle = () => new Promise((resolve) => {
    let done = false;
    const on = (ev) => {
      const m = JSON.parse(ev.data);
      if (done || !m.result || !m.result.result) return;
      const v = m.result.result.value;
      if (v && v !== 'pumping' && v !== 'started') { done = true; clearInterval(iv); resolve(v); }
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: ++id, method: 'Runtime.evaluate', params: { expression:
      '(function(){ window.__wlog = window.__wlog || []; var armed = 0; function spin(){ var r = { r: G.player.readyweapon, p: G.player.pendingweapon };' +
      ' window.__wlog.push(r.r + ":" + r.p);' +
      ' if (r.p !== 10) armed = 1;' +
      ' if (armed && r.p === 10) { window.__wsettle = JSON.stringify(r); return; }' +
      ' window.__wsettle = "pumping"; requestAnimationFrame(spin); }' +
      ' window.__wsettle = "pumping"; spin(); return "started"; })()' } }));
    const iv = setInterval(() => {
      ws.send(JSON.stringify({ id: ++id, method: 'Runtime.evaluate', params: { expression: 'window.__wsettle', returnByValue: true } }));
    }, 250);
    setTimeout(() => { if (!done) { done = true; clearInterval(iv); resolve(-1); } }, 25000);
  });
  // instrument: capture every wheel event + pick at the source
  await evl(`(() => {
    window.__evlog = []; window.__picklog = [];
    window.addEventListener('wheel', e => window.__evlog.push([e.deltaY, gamestate, document.pointerLockElement ? 1 : 0]), true);
    var orig = window.wheelPickWeapon;
    window.wheelPickWeapon = function(d){ var r = orig(d); window.__picklog.push([d, G.player.readyweapon, r]); return r; };
    return typeof orig;
  })()`);
  const seq = [];
  const wheelStep = async (dy) => { await wheel(dy); const s = await settle(); seq.push(typeof s === 'string' ? JSON.parse(s).r : s); };
  // owned = fist,pistol,shotgun,chaingun,SSG -> loop [fist,pistol,shotgun,
  // ssg,chaingun] (rocket/plasma/bfg not owned). Up = forward, down = back.
  await wheelStep(-120);  // up: pistol(1) -> shotgun(2)   (direct: ssg owned)
  await wheelStep(-120);  // up: shotgun(2) -> SSG(8)      (direct: no ticcmd)
  await wheelStep(-120);  // up: SSG(8) -> chaingun(3)
  await wheelStep(-120);  // up: chaingun -> fist(0)       (loop wraps)
  await wheelStep(120);   // down: fist -> chaingun(3)     (reverse)
  const picks = await evl('JSON.stringify(window.__wlog && window.__wlog)');
  console.log('picklog:', await evl('JSON.stringify(window.__picklog)'));
  const ok = JSON.stringify(seq) === JSON.stringify([2, 8, 3, 0, 3]);
  console.log('wlog tail:', JSON.stringify((JSON.parse(picks) || []).slice(55, 130)));
  console.log(JSON.stringify({ lock: locked, seq, expect: [2, 8, 3, 0, 3] }));
  console.log(ok ? 'WHEEL-CYCLE OK' : 'WHEEL-CYCLE FAIL');
  process.exit(0);
})().catch(e => { console.log('THREW', e.message); process.exit(1); });
