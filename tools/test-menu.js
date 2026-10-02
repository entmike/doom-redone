#!/usr/bin/env node
/* Headless smoke test for m_menu.js: title/demo loop, menu navigation,
   messages, demo ticcmd reader. Loads the real assets/title.js +
   assets/intermission.js in a vm context with stub viewbuffer/palette. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');

let fails = 0;
function ok(cond, name) {
  console.log((cond ? 'ok   ' : 'FAIL ') + name);
  if (!cond) fails++;
}

const ctx = vm.createContext({ console, Buffer,
  atob: s => Buffer.from(s, 'base64').toString('binary') });
vm.runInContext(`globalThis.window = globalThis;
  globalThis.localStorage = (() => { const m = {}; return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; }, _m: m }; })();`, ctx);
vm.runInContext(`
  var pal = []; for (var i = 0; i < 256; i++) pal.push([i, i, i]);
  window.ASSETS = { palette: pal, palettes: [pal] };
  window.viewbuffer = new Uint32Array(320 * 200);
`, ctx);
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js)
for (const f of ['src/m_menu.js'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });

vm.runInContext(`
  var log = [];
  MEN.Init({
    state: s => log.push(['state', s]),
    newGame: (sk, ep, map) => {
      log.push(['newGame', sk, ep, map]);
      if (globalThis.__ngEmulate) {            // main.js startGame side effects
        MEN.G_ClearDemoPlayback();             // g_game.c:1445
        globalThis.__title = false;
      }
    },
    playDemo: n => { MEN.G_DoPlayDemo(n); },
    initNew: (sk, ep, map, reader) => { log.push(['initNew', sk, ep, map]); globalThis.__reader = reader; },
    usergame: v => { if (v === undefined) return globalThis.__usergame || false; globalThis.__usergame = !!v; },
    unpause: () => {},
    gameActionNothing: () => {},
    gameactionIsNothing: () => true,
    isTitleOrDemo: () => globalThis.__title !== false,
    playerLive: () => {},
    quit: () => log.push(['quit']),
    setViewSize: () => {},
    setMouseSensitivity: () => {}
  });
  function tick(n) { for (var i = 0; i < n; i++) { MEN.Ticker(); MEN.PageTicker(); } }
  function closeAll() { for (var i = 0; i < 12 && (MEN.menuactive || MEN.messageToPrint); i++) MEN.Responder(27); }
  function openPanel() { closeAll(); MEN.Responder(27); }   // -> MainDef
  globalThis.tick = tick; globalThis.closeAll = closeAll; globalThis.openPanel = openPanel;
`, ctx);
const run = expr => vm.runInContext(expr, ctx);

run('MEN.StartTitle();');
run('MEN.Ticker(); MEN.PageTicker();');   // advancedemo -> case 0
ok(run('MEN.pagename') === 'TITLEPIC', 'title loop starts on TITLEPIC');
ok(run('log[log.length-1][0] === "state"'), 'state(title) fired');

// page times out after pagetic(170) -> DEMO1 initNew(skill 2, ep 1, map 5)
run('log.length = 0; tick(171);');
let inew = run('JSON.stringify(log.find(l => l[0] === "initNew") || [])');
ok(inew === '["initNew",2,1,5]', 'DEMO1 header -> initNew(skill 2, ep 1, map 5): ' + inew);
ok(run('MEN.demoplayback') === true, 'demoplayback set after demo start');

// demo ticcmd reader: real DEMO1 bytes, sane shapes
run('var c = {forwardmove:0,sidemove:0,angleturn:0,buttons:0}; __reader(c); globalThis.__c = c;');
const cobj = JSON.parse(run('JSON.stringify(__c)'));
ok(Number.isInteger(cobj.forwardmove) && Number.isInteger(cobj.buttons) &&
   cobj.angleturn % 256 === 0, 'demo ticcmd shape: ' + JSON.stringify(cobj));

// run to the demo end marker -> D_AdvanceDemo -> CREDIT page
run('for (var i = 0; i < 8000 && MEN.demoplayback; i++) __reader(c);');
ok(run('MEN.demoplayback') === false, 'demo end marker clears demoplayback');
run('tick(1);');
ok(run('MEN.pagename') === 'CREDIT', 'after demo1 -> CREDIT page');
// gospel G_CheckDemoStatus (g_game.c:1658) ADVANCES the cycle: demo1(seq1)
// ends -> CREDIT(seq2), NOT StartTitle() back to TITLEPIC(seq0). Source ban:
// the levelExit demo branch in main.js must not call StartTitle.
const mjs = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const exitBranch = mjs.slice(mjs.indexOf('if (window.levelExit && gamestate === \'level\')'),
  mjs.indexOf('if (window.levelExit && gamestate === \'level\')') + 900);
ok(/D_AdvanceDemo\(\);[\s\S]*?\}/.test(exitBranch) && !/StartTitle/.test(exitBranch),
  'attract demo exit ADVANCES the cycle (no StartTitle reset)');

// any key on the title pops the control panel (G_Responder demo pop-up)
run('log.length = 0; closeAll(); MEN.Responder(32);');
ok(run('MEN.menuactive') === 1, 'any key on title opens control panel');
ok(run('MEN.itemOn') === 0, 'panel opens on main menu');

// Down x2 -> Load Game, Enter -> LoadDef (browser deviation: no message)
run('MEN.Responder(0xaf); MEN.Responder(0xaf);');
ok(run('MEN.itemOn') === 2, 'Down x2 lands on Load Game');
run('MEN.Responder(13);');
ok(run('MEN.menuactive') === 1 && run('MEN.messageToPrint') === 0, 'Enter opens Load slots menu');
// backspace -> MainDef, Down -> Save Game, Enter -> SAVEDEAD (no usergame)
run('MEN.Responder(127); MEN.Responder(0xaf);');
ok(run('MEN.itemOn') === 3, 'back to main, Down onto Save Game');
run('MEN.Responder(13);');
ok(run('MEN.messageToPrint') === 1, 'Save without usergame pops SAVEDEAD message');
run('MEN.Responder(27);');
ok(run('MEN.messageToPrint') === 0, 'escape dismisses message');

// alpha key 'n' selects New Game; ep1 -> skills; Nightmare -> confirm -> y
run('openPanel();');
run('MEN.Responder(110);');
ok(run('MEN.itemOn') === 0, 'alpha key n selects New Game');
run('MEN.Responder(13); MEN.Responder(13);');   // -> EpiDef -> (ep1) -> NewDef
run('MEN.Responder(0xaf); MEN.Responder(0xaf);');
ok(run('MEN.itemOn') === 4, 'Down x2 to Nightmare');
run('MEN.Responder(13);');
ok(run('MEN.messageToPrint') === 1, 'Nightmare asks for confirmation');
run('log.length = 0; MEN.Responder(121);');     // 'y'
let ng = run('JSON.stringify(log.find(l => l[0] === "newGame") || [])');
ok(ng === '["newGame",4,1,1]', 'nightmare y -> newGame(4,1,1): ' + ng);
ok(run('MEN.menuactive') === 0, 'starting a game clears menu');

// skill 2 path: NewDef.lastOn is now Nightmare(4); Up x2 -> Hurt me(2)
run('openPanel(); MEN.Responder(110); MEN.Responder(13); MEN.Responder(13);');
run('log.length = 0;');
run('MEN.Responder(0xad); MEN.Responder(0xad);');
ok(run('MEN.itemOn') === 2, 'Up x2 from remembered Nightmare -> Hurt me');
run('MEN.Responder(13);');
ng = run('JSON.stringify(log.find(l => l[0] === "newGame") || [])');
ok(ng === '["newGame",2,1,1]', 'Enter on Hurt me -> newGame(2,1,1): ' + ng);

// Regression: after starting a new game while a title demo was playing back,
// gameplay keys must NOT pop the menu (g_game.c:521 demoplayback gate).
// newGame hook emulates main.js startGame(): G_ClearDemoPlayback
// (g_game.c:1445 demoplayback=false in G_InitNew) + leaving the title state.
run('closeAll(); MEN.resetMenuState();');               // deterministic NewDef item 0
run('MEN.G_DoPlayDemo("DEMO1");');                      // demo loop mid-playback
ok(run('MEN.demoplayback') === true, 'demo playing before new game');
run('globalThis.__ngEmulate = true;');
run('openPanel();');                                    // player hits Escape
run('MEN.Responder(110); MEN.Responder(13);');          // n -> EpiDef, Enter -> NewDef
run('MEN.Responder(13);');                              // Enter actuates skill 0 item
run('MEN.Responder(13);');                              // deferred routine -> newGame
ok(run('MEN.menuactive') === 0, 'new game from menu closes panel');
ok(JSON.stringify(run('log.filter(l => l[0] === "newGame").pop()')) === '["newGame",0,1,1]',
   'newGame(0,1,1) fired');
ok(run('MEN.demoplayback') === false, 'startGame clears demoplayback');
run('log.length = 0;');
run('MEN.Responder(119);');                             // 'w' = forward key
ok(run('MEN.menuactive') === 0, "gameplay key after new game doesn't open menu");
run('MEN.Responder(27);');
ok(run('MEN.menuactive') === 1, 'Escape still opens menu during gameplay');
run('closeAll(); globalThis.__ngEmulate = false; MEN.resetMenuState();');

// episode 2 -> shareware ad message
run('openPanel(); MEN.Responder(110); MEN.Responder(13);');    // -> EpiDef
run('MEN.Responder(0xaf); MEN.Responder(13);');
ok(run('MEN.messageToPrint') === 1, 'episode 2 shareware pops SWSTRING ad');
run('closeAll();');

// options menu: screen-size + mouse-sensitivity therms
run('openPanel(); MEN.Responder(111); MEN.Responder(13);');    // 'o' -> OptionsDef
run('MEN.Responder(0xaf); MEN.Responder(0xaf); MEN.Responder(0xaf);');
ok(run('MEN.itemOn') === 3, 'Down x3 -> screen size item');
run('MEN.Responder(0xae);');                                   // right (no crash)
run('MEN.Responder(0xaf);');              // Down skips empty cell -> mousesens
ok(run('MEN.itemOn') === 5, 'empty cell skipped to mouse sensitivity');
run('MEN.Responder(0xae);');
const sens = run('MEN.mouseSensitivity');
ok(sens === 6, 'right arrow raises sensitivity 5->6: ' + sens);
run('closeAll();');

// F10 quit prompt; 'y' fires quit hook
run('log.length = 0; closeAll(); MEN.Responder(0xc4);');
ok(run('MEN.messageToPrint') === 1, 'F10 quit prompt');
run('MEN.Responder(121);');
ok(run('log.some(l => l[0] === "quit")'), 'quit y invokes quit hook');

// DEMO2 = E1M3, DEMO3 = skill 2 E1M7
run('log.length = 0;');
ok(run('MEN.G_DoPlayDemo("DEMO2")') === true, 'DEMO2 loads');
ok(run('log.some(l => l[0] === "initNew" && l[2] === 1 && l[3] === 3)'), 'DEMO2 header -> E1M3');
run('MEN.G_DoPlayDemo("DEMO3");');
ok(run('log.some(l => l[0] === "initNew" && l[1] === 2 && l[3] === 7)'), 'DEMO3 header -> skill 2 E1M7');

// drawer smoke: title page paints, overlay path doesn't throw
run('closeAll(); MEN.StartTitle(); MEN.Ticker();');
run('viewbuffer.fill(0); MEN.Drawer(true);');
const nonzero = run('(()=>{let n=0; for (let i=0;i<viewbuffer.length;i++) if (viewbuffer[i]) n++; return n})()');
ok(nonzero > 20000, 'TITLEPIC drawer paints (' + nonzero + ' lit px)');
run('openPanel(); viewbuffer.fill(0); MEN.Drawer(false);');
const overlay = run('(()=>{let n=0; for (let i=0;i<viewbuffer.length;i++) if (viewbuffer[i]) n++; return n})()');
ok(overlay > 1000, 'menu overlay onto viewbuffer paints (' + overlay + ' lit px)');


// localStorage defaults (m_misc.c M_SaveDefaults/M_LoadDefaults analogue):
// setting changes persist; LoadDefaults restores them; garbage is clamped.
run('closeAll(); MEN.LoadDefaults();');   // clean slate (store may hold sens 6 from therm test)
run('closeAll(); MEN.Responder(0xbe);');                      // F4 -> SoundDef, itemOn=sfx
ok(run('MEN.snd_SfxVolume') === 15 && run('MEN.menuactive') === 1,
   'F4 -> SoundDef, sfx at default 15');
run('MEN.Responder(0xac); MEN.Responder(0xac);');             // Left x2 -> sfx 15->13
ok(run('MEN.snd_SfxVolume') === 13, 'sfx thermo left x2 -> 13');
let saved = JSON.parse(run("localStorage.getItem('\u2693DOOM\u2693')"));
ok(saved && saved.sfx_volume === 13, 'sfx volume auto-saved to localStorage');
run('MEN.Responder(0xae);');                                  // Right -> 14
saved = JSON.parse(run("localStorage.getItem('\u2693DOOM\u2693')"));
ok(saved && saved.sfx_volume === 14, 'second change re-saves (14)');
run('localStorage.setItem("\u2693DOOM\u2693", JSON.stringify({mouse_sensitivity: 99, music_volume: -4, screenblocks: 7, detaillevel: 1, show_messages: 0}));');
run('MEN.LoadDefaults();');
ok(run('MEN.mouseSensitivity') === 9, 'LoadDefaults clamps sens 99 -> 9');
ok(run('MEN.snd_MusicVolume') === 0, 'LoadDefaults clamps music -4 -> 0');
ok(run('MEN.screenblocks') === 7 && run('MEN.detailLevel') === 1, 'screenblocks/detail restored');
run('localStorage.setItem("\u2693DOOM\u2693", "{not json"); MEN.LoadDefaults();');
ok(run('MEN.screenblocks') === 7, 'corrupt store ignored without throwing');
run('localStorage.removeItem("\u2693DOOM\u2693"); MEN.Responder(119);');

run('closeAll();');
console.log(fails ? fails + ' FAILURES' : 'ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
