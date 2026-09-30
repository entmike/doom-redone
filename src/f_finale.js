/* f_finale.js — endgame finale. Port of reference/linuxdoom-1.10 f_finale.c
   for every gamemode: F_StartFinale picks (music, text, flat) from the
   doomstat gamemode (wadinstall.js sets globalThis.gamemode), F_TextWrite
   types finaletext via STCFN glyphs (TEXTSPEED=3 after 10 tics, TEXTWAIT=250),
   stage 1 shows the per-episode art (CREDIT/HELP2, VICTORY2, bunny scroll,
   ENDPIC). Commercial finales (DOOM 2 chapters) stay on the text screen —
   F_Ticker only leaves on button press after 50 tics (skip), MAP30 → cast.
   Deviations (documented):
   - Doom 1 stage 1 dwells CREDIT_TICKS then calls onDone (gospel never
     leaves the art screen; the port returns the player somewhere).
   - Cast screen animates the sprite idle/rotation directly from WAD sprites
     instead of walking mobjinfo state chains (the port's mobjinfo lacks the
     DOOM 2 monsters); key press advances, OUR HERO loops back like gospel. */
'use strict';
(function (global) {
  var SCREENWIDTH = 320, SCREENHEIGHT = 200, TRANS = 255;
  var TEXTSPEED = 3, TEXTWAIT = 250;                   // f_finale.c:56-57
  var CREDIT_TICKS = 35 * 20;                          // port: credits dwell

  // d_englsh.h finale texts verbatim
  var e1text =
    "Once you beat the big badasses and\n" +
    "clean out the moon base you're supposed\n" +
    "to win, aren't you? Aren't you? Where's\n" +
    "your fat reward and ticket home? What\n" +
    "the hell is this? It's not supposed to\n" +
    "end this way!\n" +
    "\n" +
    "It stinks like rotten meat, but looks\n" +
    "like the lost Deimos base.  Looks like\n" +
    "you're stuck on The Shores of Hell.\n" +
    "The only way out is through.\n" +
    "\n" +
    "To continue the DOOM experience, play\n" +
    "The Shores of Hell and its amazing\n" +
    "sequel, Inferno!\n";
  var e2text =
    "You've done it! The hideous cyber-\n" +
    "demon lord that ruled the lost Deimos\n" +
    "moon base has been slain and you\n" +
    "are triumphant! But ... where are\n" +
    "you? You clamber to the edge of the\n" +
    "moon and look down to see the awful\n" +
    "truth.\n" +
    "\n" +
    "Deimos floats above Hell itself!\n" +
    "You've never heard of anyone escaping\n" +
    "from Hell, but you'll make the bastards\n" +
    "sorry they ever heard of you! Quickly,\n" +
    "you rappel down to  the surface of\n" +
    "Hell.\n" +
    "\n" +
    "Now, it's on to the final chapter of\n" +
    "DOOM! -- Inferno.";
  var e3text =
    "The loathsome spiderdemon that\n" +
    "masterminded the invasion of the moon\n" +
    "bases and caused so much death has had\n" +
    "its ass kicked for all time.\n" +
    "\n" +
    "A hidden doorway opens and you enter.\n" +
    "You've proven too tough for Hell to\n" +
    "contain, and now Hell at last plays\n" +
    "fair -- for you emerge from the door\n" +
    "to see the green fields of Earth!\n" +
    "Home at last.\n" +
    "\n" +
    "You wonder what's been happening on\n" +
    "Earth while you were battling evil\n" +
    "unleashed. It's good that no Hell-\n" +
    "spawn could have come through that\n" +
    "door with you ...";
  var e4text =
    "the spider mastermind must have sent forth\n" +
    "its legions of hellspawn before your\n" +
    "final confrontation with that terrible\n" +
    "beast from hell.  but you stepped forward\n" +
    "and brought forth eternal damnation and\n" +
    "suffering upon the horde as a true hero\n" +
    "would in the face of something so evil.\n" +
    "\n" +
    "besides, someone was gonna pay for what\n" +
    "happened to daisy, your pet rabbit.\n" +
    "\n" +
    "but now, you see spread before you more\n" +
    "potential pain and gibbitude as a nation\n" +
    "of demons run amok among our cities.\n" +
    "\n" +
    "next stop, hell on earth!";
  var c1text =
    "YOU HAVE ENTERED DEEPLY INTO THE INFESTED\n" +
    "STARPORT. BUT SOMETHING IS WRONG. THE\n" +
    "MONSTERS HAVE BROUGHT THEIR OWN REALITY\n" +
    "WITH THEM, AND THE STARPORT'S TECHNOLOGY\n" +
    "IS BEING SUBVERTED BY THEIR PRESENCE.\n" +
    "\n" +
    "AHEAD, YOU SEE AN OUTPOST OF HELL, A\n" +
    "FORTIFIED ZONE. IF YOU CAN GET PAST IT,\n" +
    "YOU CAN PENETRATE INTO THE HAUNTED HEART\n" +
    "OF THE STARBASE AND FIND THE CONTROLLING\n" +
    "SWITCH WHICH HOLDS EARTH'S POPULATION\n" +
    "HOSTAGE.";
  var c2text =
    "YOU HAVE WON! YOUR VICTORY HAS ENABLED\n" +
    "HUMANKIND TO EVACUATE EARTH AND ESCAPE\n" +
    "THE NIGHTMARE.  NOW YOU ARE THE ONLY\n" +
    "HUMAN LEFT ON THE FACE OF THE PLANET.\n" +
    "CANNIBAL MUTATIONS, CARNIVOROUS ALIENS,\n" +
    "AND EVIL SPIRITS ARE YOUR ONLY NEIGHBORS.\n" +
    "YOU SIT BACK AND WAIT FOR DEATH, CONTENT\n" +
    "THAT YOU HAVE SAVED YOUR SPECIES.\n" +
    "\n" +
    "BUT THEN, EARTH CONTROL BEAMS DOWN A\n" +
    "MESSAGE FROM SPACE: \"SENSORS HAVE LOCATED\n" +
    "THE SOURCE OF THE ALIEN INVASION. IF YOU\n" +
    "GO THERE, YOU MAY BE ABLE TO BLOCK THEIR\n" +
    "ENTRY.  THE ALIEN BASE IS IN THE HEART OF\n" +
    "YOUR OWN HOME CITY, NOT FAR FROM THE\n" +
    "STARPORT.\" SLOWLY AND PAINFULLY YOU GET\n" +
    "UP AND RETURN TO THE FRAY.";
  var c3text =
    "YOU ARE AT THE CORRUPT HEART OF THE CITY,\n" +
    "SURROUNDED BY THE CORPSES OF YOUR ENEMIES.\n" +
    "YOU SEE NO WAY TO DESTROY THE CREATURES'\n" +
    "ENTRYWAY ON THIS SIDE, SO YOU CLENCH YOUR\n" +
    "TEETH AND PLUNGE THROUGH IT.\n" +
    "\n" +
    "THERE MUST BE A WAY TO CLOSE IT ON THE\n" +
    "OTHER SIDE. WHAT DO YOU CARE IF YOU'VE\n" +
    "GOT TO GO THROUGH HELL TO GET TO IT?";
  var c4text =
    "THE HORRENDOUS VISAGE OF THE BIGGEST\n" +
    "DEMON YOU'VE EVER SEEN CRUMBLES BEFORE\n" +
    "YOU, AFTER YOU PUMP YOUR ROCKETS INTO\n" +
    "HIS EXPOSED BRAIN. THE MONSTER SHRIVELS\n" +
    "UP AND DIES, ITS THRASHING LIMBS\n" +
    "DEVASTATING UNTOLD MILES OF HELL'S\n" +
    "SURFACE.\n" +
    "\n" +
    "YOU'VE DONE IT. THE INVASION IS OVER.\n" +
    "EARTH IS SAVED. HELL IS A WRECK. YOU\n" +
    "WONDER WHERE BAD FOLKS WILL GO WHEN THEY\n" +
    "DIE, NOW. WIPING THE SWEAT FROM YOUR\n" +
    "FOREHEAD YOU BEGIN THE LONG TREK BACK\n" +
    "HOME. REBUILDING EARTH OUGHT TO BE A\n" +
    "LOT MORE FUN THAN RUINING IT WAS.\n";
  var c5text =
    "CONGRATULATIONS, YOU'VE FOUND THE SECRET\n" +
    "LEVEL! LOOKS LIKE IT'S BEEN BUILT BY\n" +
    "HUMANS, RATHER THAN DEMONS. YOU WONDER\n" +
    "WHO THE INMATES OF THIS CORNER OF HELL\n" +
    "WILL BE.";
  var c6text =
    "CONGRATULATIONS, YOU'VE FOUND THE\n" +
    "SUPER SECRET LEVEL!  YOU'D BETTER\n" +
    "BLAZE THROUGH THIS ONE!\n";

  // f_finale.c:106-140 F_StartFinale text/flat selection
  function pickFinale(gm, episode, map) {
    if (gm === 'commercial') {
      switch (map) {
        case 6: return { text: c1text, flat: 'SLIME16' };
        case 11: return { text: c2text, flat: 'RROCK14' };
        case 20: return { text: c3text, flat: 'RROCK07' };
        case 30: return { text: c4text, flat: 'RROCK17' };
        case 15: return { text: c5text, flat: 'RROCK13' };
        case 31: return { text: c6text, flat: 'RROCK19' };
        default: return { text: c1text, flat: 'SLIME16' };  // C I_Error; port: play on
      }
    }
    switch (episode) {
      case 2: return { text: e2text, flat: 'SFLR6_1' };
      case 3: return { text: e3text, flat: 'MFLR8_4' };
      case 4: return { text: e4text, flat: 'MFLR8_3' };
      default: return { text: e1text, flat: 'FLOOR4_8' };
    }
  }

  var FB = null, flat = null, lut = null, P = null;
  var finalecount = 0, finalestage = 0, onDone = null, started = false;
  var finaletext = e1text, gm = 'shareware', gmap = 1, gep = 1;
  var laststage = 0;

  function b64(s) {
    if (typeof atob === 'function') { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
    return new Uint8Array(Buffer.from(s, 'base64'));
  }
  function patch(name) {
    if (!P) {
      P = {};
      var L = (typeof INTERLUDE !== 'undefined') ? INTERLUDE : global.INTERLUDE;
      var src = L.patches;
      for (var k in src) P[k] = { w: src[k][0], h: src[k][1], px: b64(src[k][2]), left: src[k][3], top: src[k][4] };
    }
    return P[name];
  }
  function buildLut() {
    var A = (typeof ASSETS !== 'undefined') ? ASSETS : global.ASSETS;
    var pals = A.palettes || [A.palette];
    var pal = pals[0], cm = global.COLORMAPS;
    lut = new Uint32Array(256);
    for (var s = 0; s < 256; s++) {
      var idx = cm ? cm[s] : s;
      var c = pal[idx];
      lut[s] = 0xff000000 | (c[2] << 16) | (c[1] << 8) | c[0];
    }
  }
  function drawPatch(x, y, p) {
    x -= p.left; y -= p.top;
    var x1 = x < 0 ? -x : 0, y1 = y < 0 ? -y : 0;
    var x2 = Math.min(p.w, SCREENWIDTH - x), y2 = Math.min(p.h, SCREENHEIGHT - y);
    for (var yy = y1; yy < y2; yy++) {
      var row = (y + yy) * SCREENWIDTH + x, src = yy * p.w;
      for (var xx = x1; xx < x2; xx++) {
        var c = p.px[src + xx];
        if (c !== TRANS) FB[row + xx] = c;
      }
    }
  }
  // F_DrawPatchCol: draw one patch column at screen x (F_BunnyScroll)
  function drawPatchCol(x, p, col) {
    if (col < 0 || col >= p.w) return;
    for (var yy = 0; yy < p.h && yy < SCREENHEIGHT; yy++) {
      var c = p.px[yy * p.w + col];
      if (c !== TRANS) FB[yy * SCREENWIDTH + x] = c;
    }
  }

  // Start({worldDone}) — opts.worldDone fires when the finale releases the
  // player (Doom 1: after the art dwell; commercial: skip button after 50
  // tics, or the cast screen never fires it — gospel loops forever).
  function Start(opts) {
    if (typeof opts === 'function') opts = { worldDone: opts };   // legacy cb form
    opts = opts || {};
    onDone = opts.worldDone || null;
    gm = global.gamemode || globalThis.gamemode || 'shareware';
    gep = (global.G && G.gameepisode) || 1;
    gmap = (global.G && G.gamemap) || 1;
    var pick = pickFinale(gm, gep, gmap);
    finaletext = pick.text;
    FB = new Uint8Array(SCREENWIDTH * SCREENHEIGHT);
    var L = (typeof INTERLUDE !== 'undefined') ? INTERLUDE : global.INTERLUDE;
    var flats = (L && L.flats) || {};
    var fb64 = flats[pick.flat] || L.flat || flats.FLOOR4_8;
    flat = fb64 ? b64(fb64) : new Uint8Array(4096);
    buildLut();
    finalecount = 0; finalestage = 0; laststage = 0;
    castInit();
    if (global.Snd && global.Snd.S_ChangeMusic)         // f_finale.c:113/144
      global.Snd.S_ChangeMusic(gm === 'commercial'
        ? global.Snd.mus.mus_read_m : global.Snd.mus.mus_victor, true);
    started = true;
  }

  function sfx(name) {
    if (global.Snd && global.Snd.S_StartSound)
      global.Snd.S_StartSound(null, global.Snd.sfx['sfx_' + name]);
  }

  function Ticker(buttons) {
    if (!started) return;
    // f_finale.c:212 commercial skip: any button after 50 tics -> worlddone
    // (cast after MAP30). Doom 1 F_Ticker has no skip.
    if (gm === 'commercial' && finalecount > 50 && (buttons || 0)) {
      if (gmap === 30) { castStart(); return; }
      if (onDone) { started = false; onDone(); }
      return;
    }
    finalecount++;
    if (finalestage === 2) { castTick(); return; }      // F_CastTicker
    if (gm === 'commercial') return;                    // text stays until skip
    if (!finalestage && finalecount > finaletext.length * TEXTSPEED + TEXTWAIT) {
      finalecount = 0;
      finalestage = 1;                                  // art screen
      if (global.forceWipe) global.forceWipe();         // f_finale.c:245 wipegamestate=-1
      if (gep === 3 && global.Snd && global.Snd.S_StartMusic)
        global.Snd.S_StartMusic(global.Snd.mus.mus_bunny);  // f_finale.c:246
    } else if (finalestage && finalecount > Math.max(CREDIT_TICKS, gep === 3 ? 1300 : 0)) {
      started = false;
      if (onDone) onDone();                             // deviation: release
    }
  }

  function TileBackground() {
    // F_TextWrite: erase screen to tiled finaleflat (row = flat row y&63 tiled)
    for (var y = 0; y < SCREENHEIGHT; y++) {
      var srow = (y & 63) * 64, drow = y * SCREENWIDTH;
      for (var x = 0; x < SCREENWIDTH; x++) FB[drow + x] = flat[srow + (x & 63)];
    }
  }
  function drawText(text, baseY) {
    var cx = 10, cy = baseY, ch = 0;
    var count = (finalecount - 10) / TEXTSPEED | 0;
    if (count < 0) count = 0;
    for (; count; count--) {
      var c = text.charCodeAt(ch++);
      if (!c) break;
      if (c === 10) { cx = 10; cy += 11; continue; }
      if (c >= 97 && c <= 122) c -= 32;                 // toupper
      c = c - 33;
      if (c < 0 || c > 63) { cx += 4; continue; }
      var wch = patch('STCFN' + ('00' + (33 + c)).slice(-3));
      if (!wch) { cx += 4; continue; }
      if (cx + wch.w > SCREENWIDTH) break;
      drawPatch(cx, cy, wch);
      cx += wch.w;
    }
  }

  // ---- F_BunnyScroll (episode 3 stage 1) ----------------------------------
  function BunnyScroll() {
    var p1 = patch('PFUB2'), p2 = patch('PFUB1');
    if (!p1 || !p2) { drawPatch(0, 0, patch('CREDIT')); return; }
    var scrolled = 320 - (finalecount - 230) / 2;
    if (scrolled > 320) scrolled = 320;
    if (scrolled < 0) scrolled = 0;
    scrolled |= 0;
    FB.fill(0);
    for (var x = 0; x < SCREENWIDTH; x++) {
      if (x + scrolled < 320) drawPatchCol(x, p1, x + scrolled);
      else drawPatchCol(x, p2, x + scrolled - 320);
    }
    if (finalecount < 1130) return;
    if (finalecount < 1180) {
      var e0 = patch('END0');
      if (e0) drawPatch((SCREENWIDTH - 13 * 8) / 2, (SCREENHEIGHT - 8 * 8) / 2, e0);
      laststage = 0;
      return;
    }
    var stage = (finalecount - 1180) / 5 | 0;
    if (stage > 6) stage = 6;
    if (stage > laststage) { sfx('pistol'); laststage = stage; }
    var ep = patch('END' + stage);
    if (ep) drawPatch((SCREENWIDTH - 13 * 8) / 2, (SCREENHEIGHT - 8 * 8) / 2, ep);
  }

  // ---- Final DOOM 2 cast (F_StartCast / F_CastTicker / F_CastDrawer) ------
  // Deviation: sprite-table animation (see header). castorder names verbatim
  // from d_englsh.h CC_*, sprites from info.c monster SPR_* ids.
  // [name, spr, seesound, deathsound] — sounds straight from info.c
  // mobjinfo[] (seesound/deathsound of the castorder types).
  var castOrder = [
    ['ZOMBIEMAN', 'POSS', 'posit1', 'podth1'],
    ['SHOTGUN GUY', 'SPOS', 'posit2', 'podth2'],
    ['HEAVY WEAPON DUDE', 'POSE', 'posit2', 'podth2'],
    ['IMP', 'TROO', 'bgsit1', 'bgdth1'],
    ['DEMON', 'SARG', 'sgtsit', 'sgtdth'],
    ['LOST SOUL', 'SKUL', null, 'firxpl'],
    ['CACODEMON', 'HEAD', 'cacsit', 'cacdth'],
    ['HELL KNIGHT', 'BAL7', 'kntsit', 'kntdth'],
    ['BARON OF HELL', 'BOSS', 'brssit', 'brsdth'],
    ['ARACHNOTRON', 'BSPI', 'bspsit', 'bspdth'],
    ['PAIN ELEMENTAL', 'PAIN', 'pesit', 'pedth'],
    ['REVENANT', 'SKEL', 'skesit', 'skedth'],
    ['MANCUBUS', 'FATT', 'mansit', 'mandth'],
    ['ARCH-VILE', 'VILE', 'vilsit', 'vildth'],
    ['THE SPIDER MASTERMIND', 'SPID', 'spisit', 'spidth'],
    ['THE CYBERDEMON', 'CYBR', 'cybsit', 'cybdth'],
    ['OUR HERO', 'PLAY', null, 'pldeth']
  ];
  var castnum = 0, castframe = 0, castRot = 0, castdeath = false;
  function castInit() { castnum = 0; castframe = 0; castRot = 0; castdeath = false; }
  function castStart() {                                // F_StartCast
    finalestage = 2; finalecount = 0; castInit();
    castDyingTics = 0;
    if (castOrder[0][2]) sfx(castOrder[0][2]);          // S_StartSound(seesound)
    if (global.forceWipe) global.forceWipe();
    if (global.Snd && global.Snd.S_ChangeMusic)
      global.Snd.S_ChangeMusic(global.Snd.mus.mus_evil, true);   // S_ChangeMusic(mus_evil,true)
  }
  function castPress() {
    if (finalestage !== 2) return false;
    // F_CastResponder (f_finale.c:502): first press = death frames +
    // deathsound; a further press while dying does nothing; F_CastTicker then
    // advances (with the next monster's seesound). The port does not replay
    // death state chains (documented deviation), so the second press advances
    // manually — same observable flow: monster dies, next monster appears.
    if (castdeath) {
      castnum++; castframe = 0; castRot = 0; castdeath = false;
      if (castnum >= castOrder.length) castnum = 0;     // OUR HERO -> wrap
      var see = castOrder[castnum][2];
      if (see) sfx(see);
      return true;
    }
    castdeath = true; castDyingTics = 0;
    var die = castOrder[castnum][3];
    if (die) sfx(die);
    return true;
  }
  var castDyingTics = 0;
  function castTick() {
    // F_CastTicker advances to the next monster when the death state chain
    // ends (f_finale.c:610), playing the new monster's seesound. The port
    // freezes the stand pose instead of playing death frames (documented
    // deviation), then advances after the same order-of-magnitude dwell.
    if (castdeath) {
      if (++castDyingTics < 70) return;
      castDyingTics = 0; castdeath = false;
      castnum++; castframe = 0; castRot = 0;
      if (castnum >= castOrder.length) castnum = 0;
      var see = castOrder[castnum][2];
      if (see) sfx(see);                                // F_CastTicker seesound
      return;
    }
    if (++castframe >= 8) { castframe = 0; if (++castRot > 7) castRot = 0; }
  }
  function castDrawer() {
    var back = patch('BOSSBACK');
    if (back) drawPatch(0, 0, back); else FB.fill(0);
    // F_CastPrint: name centered at y=180
    var name = castOrder[castnum][0], width = 0, i;
    for (i = 0; i < name.length; i++) {
      var cc = name.charCodeAt(i);
      if (cc >= 97 && cc <= 122) cc -= 32;
      var gp = patch('STCFN' + ('00' + cc).slice(-3));
      width += gp ? gp.w : 4;
    }
    var cx = 160 - width / 2;
    for (i = 0; i < name.length; i++) {
      var c2 = name.charCodeAt(i);
      if (c2 >= 97 && c2 <= 122) c2 -= 32;
      var g = patch('STCFN' + ('00' + c2).slice(-3));
      if (!g) { cx += 4; continue; }
      drawPatch(cx, 180, g);
      cx += g.w;
    }
    // current frame: standing rotation anim from the WAD sprite superset
    var sprName = castOrder[castnum][1] + 'A' + (1 + castRot);
    var d = global.ASSETS && ASSETS.sprites && ASSETS.sprites[sprName];
    if (!d) d = global.ASSETS && ASSETS.sprites && ASSETS.sprites[castOrder[castnum][1] + 'A1'];
    if (!d) return;
    var p = { w: d[0], h: d[1], px: b64(d[2]), left: d[3] || 0, top: d[4] || 0 };
    // F_CastDrawer centers on (160, 180-ish); deviation: fixed anchor
    var x = (160 - p.w / 2) | 0, y = (150 - p.h) | 0;
    var xx1 = x < 0 ? -x : 0, yy1 = y < 0 ? -y : 0;
    var x2 = Math.min(p.w, SCREENWIDTH - x), y2 = Math.min(p.h, SCREENHEIGHT - y);
    for (var yy = yy1; yy < y2; yy++) {
      var row = (y + yy) * SCREENWIDTH + x, src = yy * p.w;
      for (var xx = xx1; xx < x2; xx++) {
        var v = p.px[src + xx];
        if (v !== TRANS) FB[row + xx] = v;
      }
    }
  }

  function Drawer() {
    if (!started) return;
    if (finalestage === 2) {                            // F_Drawer cast branch
      castDrawer();
    } else if (!finalestage) {
      TileBackground();
      drawText(finaletext, 10);
    } else {
      // f_finale.c:712 per-episode art screen
      if (gep === 3) BunnyScroll();
      else if (gep === 2) drawPatch(0, 0, patch('VICTORY2') || patch('CREDIT'));
      else if (gep === 4) drawPatch(0, 0, patch('ENDPIC') || patch('CREDIT'));
      else if (gm === 'retail') drawPatch(0, 0, patch('CREDIT'));
      else drawPatch(0, 0, patch('HELP2') || patch('CREDIT'));
    }
    var vb = global.viewbuffer;
    if (vb) for (var i = 0; i < FB.length; i++) vb[i] = lut[FB[i]];
  }

  global.FINALE = { Start: Start, Ticker: Ticker, Drawer: Drawer,
    Press: castPress,
    get stage() { return finalestage; },
    get castnum() { return castnum; } };
})(typeof window !== 'undefined' ? window : globalThis);
