// src/sound.js — vanilla DMX sound stack, ported bug-for-bug:
//   s_sound.c  : channel manager, S_StartSound/S_UpdateSounds/S_AdjustSoundParams
//   i_sound.c  : steptable/vol_lookup, handle-as-gametic quirk
//   soundsrv.c : DMX mixer (mix()/addsfx() sample-exact)
//   wadread.c  : getsfx() DMX8 pad
// Music (opl.js) plugs in via Snd.music hooks. WebAudio output only after
// a user gesture (unlock()); mixing runs even when silent so game state
// (handles, usefulness) matches vanilla timing exactly.
/* global ASSETS, G */
(function () {
  "use strict";

  // ------------------------------------------------------------------ sfx table
  // sfxinfo_t S_sfx[] from sounds.c — [name, singularity, priority, link, pitch, volume]
  // Index == sfxenum_t value in sounds.h.
  var SFX_TABLE = [
["none",0,0,0,-1,-1],
["pistol",0,64,0,-1,-1],
["shotgn",0,64,0,-1,-1],
["sgcock",0,64,0,-1,-1],
["dshtgn",0,64,0,-1,-1],
["dbopn",0,64,0,-1,-1],
["dbcls",0,64,0,-1,-1],
["dbload",0,64,0,-1,-1],
["plasma",0,64,0,-1,-1],
["bfg",0,64,0,-1,-1],
["sawup",0,64,0,-1,-1],
["sawidl",0,118,0,-1,-1],
["sawful",0,64,0,-1,-1],
["sawhit",0,64,0,-1,-1],
["rlaunc",0,64,0,-1,-1],
["rxplod",0,70,0,-1,-1],
["firsht",0,70,0,-1,-1],
["firxpl",0,70,0,-1,-1],
["pstart",0,100,0,-1,-1],
["pstop",0,100,0,-1,-1],
["doropn",0,100,0,-1,-1],
["dorcls",0,100,0,-1,-1],
["stnmov",0,119,0,-1,-1],
["swtchn",0,78,0,-1,-1],
["swtchx",0,78,0,-1,-1],
["plpain",0,96,0,-1,-1],
["dmpain",0,96,0,-1,-1],
["popain",0,96,0,-1,-1],
["vipain",0,96,0,-1,-1],
["mnpain",0,96,0,-1,-1],
["pepain",0,96,0,-1,-1],
["slop",0,78,0,-1,-1],
["itemup",1,78,0,-1,-1],
["wpnup",1,78,0,-1,-1],
["oof",0,96,0,-1,-1],
["telept",0,32,0,-1,-1],
["posit1",1,98,0,-1,-1],
["posit2",1,98,0,-1,-1],
["posit3",1,98,0,-1,-1],
["bgsit1",1,98,0,-1,-1],
["bgsit2",1,98,0,-1,-1],
["sgtsit",1,98,0,-1,-1],
["cacsit",1,98,0,-1,-1],
["brssit",1,94,0,-1,-1],
["cybsit",1,92,0,-1,-1],
["spisit",1,90,0,-1,-1],
["bspsit",1,90,0,-1,-1],
["kntsit",1,90,0,-1,-1],
["vilsit",1,90,0,-1,-1],
["mansit",1,90,0,-1,-1],
["pesit",1,90,0,-1,-1],
["sklatk",0,70,0,-1,-1],
["sgtatk",0,70,0,-1,-1],
["skepch",0,70,0,-1,-1],
["vilatk",0,70,0,-1,-1],
["claw",0,70,0,-1,-1],
["skeswg",0,70,0,-1,-1],
["pldeth",0,32,0,-1,-1],
["pdiehi",0,32,0,-1,-1],
["podth1",0,70,0,-1,-1],
["podth2",0,70,0,-1,-1],
["podth3",0,70,0,-1,-1],
["bgdth1",0,70,0,-1,-1],
["bgdth2",0,70,0,-1,-1],
["sgtdth",0,70,0,-1,-1],
["cacdth",0,70,0,-1,-1],
["skldth",0,70,0,-1,-1],
["brsdth",0,32,0,-1,-1],
["cybdth",0,32,0,-1,-1],
["spidth",0,32,0,-1,-1],
["bspdth",0,32,0,-1,-1],
["vildth",0,32,0,-1,-1],
["kntdth",0,32,0,-1,-1],
["pedth",0,32,0,-1,-1],
["skedth",0,32,0,-1,-1],
["posact",1,120,0,-1,-1],
["bgact",1,120,0,-1,-1],
["dmact",1,120,0,-1,-1],
["bspact",1,100,0,-1,-1],
["bspwlk",1,100,0,-1,-1],
["vilact",1,100,0,-1,-1],
["noway",0,78,0,-1,-1],
["barexp",0,60,0,-1,-1],
["punch",0,64,0,-1,-1],
["hoof",0,70,0,-1,-1],
["metal",0,70,0,-1,-1],
["chgun",0,64,1,150,0],
["tink",0,60,0,-1,-1],
["bdopn",0,100,0,-1,-1],
["bdcls",0,100,0,-1,-1],
["itmbk",0,100,0,-1,-1],
["flame",0,32,0,-1,-1],
["flamst",0,32,0,-1,-1],
["getpow",0,60,0,-1,-1],
["bospit",0,70,0,-1,-1],
["boscub",0,70,0,-1,-1],
["bossit",0,70,0,-1,-1],
["bospn",0,70,0,-1,-1],
["bosdth",0,70,0,-1,-1],
["manatk",0,70,0,-1,-1],
["mandth",0,70,0,-1,-1],
["sssit",0,70,0,-1,-1],
["ssdth",0,70,0,-1,-1],
["keenpn",0,70,0,-1,-1],
["keendt",0,70,0,-1,-1],
["skeact",0,70,0,-1,-1],
["skesit",0,70,0,-1,-1],
["skeatk",0,70,0,-1,-1],
["radio",0,60,0,-1,-1]
  ];
  var NUMSFX = SFX_TABLE.length;                  // 109 + none = 110? table includes none at 0
  // sfxenum ids by name
  var sfx = {};
  for (var si = 0; si < SFX_TABLE.length; si++) sfx["sfx_" + SFX_TABLE[si][0]] = si;

  // S_sfx structs (with link resolution à la sounds.c)
  var S_sfx = SFX_TABLE.map(function (e, i) {
    return { id: i, name: e[0], singularity: e[1], priority: e[2],
             link: e[3] ? SFX_TABLE[0] /* placeholder */ : null,
             pitch: e[4], volume: e[5],
             data: null, length: 0, usefulness: -1 };
  });
  S_sfx.forEach(function (s, i) {
    var lk = SFX_TABLE[i][3];
    if (lk) s.link = S_sfx[lk];                    // chgun -> pistol (id 1)
  });

  // S_music names (index == musenum_t)
  var MUSIC_NAMES = ["none","e1m1","e1m2","e1m3","e1m4","e1m5","e1m6","e1m7","e1m8","e1m9",
    "e2m1","e2m2","e2m3","e2m4","e2m5","e2m6","e2m7","e2m8","e2m9",
    "e3m1","e3m2","e3m3","e3m4","e3m5","e3m6","e3m7","e3m8","e3m9",
    "inter","intro","bunny","victor","introa",
    "runnin","stalks","countd","between","doom","the_da","shawn","ddtblu","in_cit","dead",
    "stlks2","theda2","doom2","ddtbl2","runni2","dead2","stlks3","romero","shawn2","messag",
    "count2","ddtbl3","ampie","theda3","adrian","messg2","romer2","tense","shawn3","openin",
    "evil","ultima","read_m","dm2ttl","dm2int"];
  var mus = {};
  MUSIC_NAMES.forEach(function (n, i) { mus["mus_" + n] = i; });
  // spmus[] from s_sound.c S_Start for episode 4
  var spmus = [mus.mus_e3m4, mus.mus_e3m2, mus.mus_e3m3, mus.mus_e1m5, mus.mus_e2m7,
               mus.mus_e2m4, mus.mus_e2m6, mus.mus_e2m5, mus.mus_e1m9];

  // ------------------------------------------------------------------ DMX mixer (soundsrv.c)
  var SAMPLECOUNT = 512;                       // soundsrv.h
  var MIXRATE = 11025;
  var steptable = new Int32Array(256);
  var vol_lookup = new Int32Array(128 * 256);
  (function initdata() {                        // soundsrv.c initdata()/i_sound.c I_SetChannels
    for (var i = -128; i < 128; i++)
      steptable[i + 128] = Math.pow(2.0, (i / 64.0)) * 65536.0;   // C (int) truncation
    for (var v = 0; v < 128; v++)
      for (var j = 0; j < 256; j++)
        vol_lookup[v * 256 + j] = (v * (j - 128) * 256) / 127 | 0; // C integer div
  })();

  // mix channels — C `channels[i]` pointer == byte index into data; null = free
  var mchan = new Int32Array(8).fill(-1), mstep = new Int32Array(8), mrem = new Int32Array(8),
      mend = new Int32Array(8), mstart = new Int32Array(8), mhand = new Int32Array(8),
      mid = new Int32Array(8);
  var mytime = 0, handlenums = 0;
  var mixbuffer = new Int16Array(SAMPLECOUNT * 2);

  function mix() {                              // soundsrv.c mix()
    var leftout = 0, leftend = SAMPLECOUNT * 2;
    while (leftout < leftend) {
      var dl = 0, dr = 0, sample;
      for (var c = 0; c < 8; c++) {
        if (mchan[c] >= 0) {
          sample = mdata[c][mchan[c]];
          dl += vol_lookup[mlofs[c] + sample];
          dr += vol_lookup[mrofs[c] + sample];
          mrem[c] += mstep[c];
          mchan[c] += mrem[c] >> 16;
          mrem[c] &= 65535;
          if (mchan[c] >= mend[c]) mchan[c] = -1;
        }
      }
      mixbuffer[leftout] = dl > 0x7fff ? 0x7fff : dl < -0x8000 ? -0x8000 : dl;
      mixbuffer[leftout + 1] = dr > 0x7fff ? 0x7fff : dr < -0x8000 ? -0x8000 : dr;
      leftout += 2;
    }
  }
  var mdata = new Array(8);                     // Uint8Array per active channel

  function addsfx(sfxid, volume, step, seperation) {  // soundsrv.c addsfx()
    var i, rc = -1;
    var oldest = mytime, oldestnum = 0, slot;
    // single-instance kill list (DMX hardcoded)
    if (sfxid === sfx_sawup_id || sfxid === sfx_sawidl_id || sfxid === sfx_sawful_id ||
        sfxid === sfx_sawhit_id || sfxid === sfx_stnmov_id || sfxid === sfx_pistol_id) {
      for (i = 0; i < 8; i++)
        if (mchan[i] >= 0 && mid[i] === sfxid) { mchan[i] = -1; break; }
    }
    for (i = 0; i < 8 && mchan[i] >= 0; i++)
      if (mstart[i] < oldest) { oldestnum = i; oldest = mstart[i]; }
    slot = (i === 8) ? oldestnum : i;

    mdata[slot] = S_sfx[sfxid].data;
    mchan[slot] = 0;
    mend[slot] = S_sfx[sfxid].length;
    if (!handlenums) handlenums = 100;
    mhand[slot] = rc = handlenums++;
    if (handlenums === 0x7fffffff) handlenums = 100; // wrap safety for gametic<handle
    mstep[slot] = step;
    mrem[slot] = 0;
    mstart[slot] = mytime;

    seperation += 1;                            // (x^2 seperation)
    var leftvol = volume - ((volume * seperation * seperation) / 65536) | 0;
    seperation = seperation - 257;
    var rightvol = volume - ((volume * seperation * seperation) / 65536) | 0;
    if (rightvol < 0) rightvol = 0; if (rightvol > 127) rightvol = 127;
    if (leftvol < 0) leftvol = 0; if (leftvol > 127) leftvol = 127;
    mlofs[slot] = leftvol * 256;
    mrofs[slot] = rightvol * 256;
    mid[slot] = sfxid;
    return rc;
  }
  var mlofs = new Int32Array(8), mrofs = new Int32Array(8);
  var sfx_sawup_id = sfx.sfx_sawup, sfx_sawidl_id = sfx.sfx_sawidl,
      sfx_sawful_id = sfx.sfx_sawful, sfx_sawhit_id = sfx.sfx_sawhit,
      sfx_stnmov_id = sfx.sfx_stnmov, sfx_pistol_id = sfx.sfx_pistol;

  // ------------------------------------------------------------------ s_sound.c manager
  var snd_SfxVolume = 15, snd_MusicVolume = 15;
  var numChannels = 3;                          // m_misc.c snd_channels default
  var channels = [];                            // {sfxinfo, origin, handle}
  var mus_paused = false, mus_playing = null;
  var gametic = 0;                              // mirrored by G wiring
  // sfx_* ids (sounds.h order) used by the manager
  var sfx_itemup_id = sfx.sfx_itemup, sfx_tink_id = sfx.sfx_tink,
      sfx_sawup_id = sfx.sfx_sawup, sfx_sawhit_id = sfx.sfx_sawhit;

  function S_Init() {                           // s_sound.c S_Init(15,15)
    for (var i = 0; i < numChannels; i++)
      channels[i] = { sfxinfo: null, origin: null, handle: 0 };
    mus_paused = 0;
    for (i = 1; i < NUMSFX; i++) { S_sfx[i].usefulness = -1; ensureData(i); }
  }

  // getsfx() — wadread.c: DMX8 header pad to 512 multiple with byte 128
  function ensureData(id) {
    var s = S_sfx[id];
    if (s.data) return;
    var b64 = ASSETS.sounds[s.name.toUpperCase()];
    if (!b64) { s.data = new Uint8Array(512).fill(128); s.length = 512; return; }
    var lump = b64ToBytes(b64);
    var size = lump.length;
    var paddedsize = ((size - 8 + (SAMPLECOUNT - 1)) / SAMPLECOUNT | 0) * SAMPLECOUNT;
    var padded = new Uint8Array(paddedsize + 8);
    padded.set(lump);
    for (var i = size; i < paddedsize + 8; i++) padded[i] = 128;
    s.data = padded.subarray(8);                // skip DMX8 header
    s.length = paddedsize;
  }

  function b64ToBytes(b64) {
    if (typeof atob !== "undefined") {
      var bin = atob(b64), u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8;
    }
    return new Uint8Array(Buffer.from(b64, "base64"));
  }

  // fixed helpers (game.js exports)
  function FMul(a, b) { return Number((BigInt(a | 0) * BigInt(b | 0)) >> 16n) | 0; }
  var S_CLIPPING_DIST = 1200 * 0x10000;
  var S_CLOSE_DIST = 160 * 0x10000;
  var S_ATTENUATOR = ((S_CLIPPING_DIST - S_CLOSE_DIST) >> 16);
  var NORM_PITCH = 128, NORM_PRIORITY = 64, NORM_SEP = 128;
  var S_STEREO_SWING = 96 * 0x10000;

  function S_AdjustSoundParams(listener, source, out) {  // s_sound.c:752
    var adx = (listener.x - source.x) | 0; if (adx < 0) adx = -adx;
    var ady = (listener.y - source.y) | 0; if (ady < 0) ady = -ady;
    var approx_dist = adx + ady - ((adx < ady ? adx : ady) >> 1);
    var gamemap = (typeof G !== "undefined" && G.gamemap) || 1;
    if (gamemap !== 8 && approx_dist > S_CLIPPING_DIST) return 0;
    var angle = G.R_PointToAngle2(listener.x, listener.y, source.x, source.y) >>> 0;
    if (angle > (listener.angle >>> 0)) angle = (angle - (listener.angle >>> 0)) >>> 0;
    else angle = (angle + ((0xffffffff - (listener.angle >>> 0)) >>> 0)) >>> 0;
    angle >>>= 19;                              // ANGLETOFINESHIFT — unsigned!
    out.sep = 128 - ((FMul(S_STEREO_SWING, G.finesine[angle]) >> 16));
    if (approx_dist < S_CLOSE_DIST) {
      out.vol = snd_SfxVolume;
    } else if (gamemap === 8) {
      if (approx_dist > S_CLIPPING_DIST) approx_dist = S_CLIPPING_DIST;
      out.vol = 15 + ((Math.trunc((snd_SfxVolume - 15) * ((S_CLIPPING_DIST - approx_dist) >> 16)) ) / S_ATTENUATOR) | 0;
    } else {
      out.vol = (Math.trunc(snd_SfxVolume * ((S_CLIPPING_DIST - approx_dist) >> 16))) / S_ATTENUATOR | 0;
    }
    return out.vol > 0;
  }

  function S_StopChannel(cnum) {                // s_sound.c:708
    var c = channels[cnum];
    if (c.sfxinfo) {
      if (I_SoundIsPlaying(c.handle)) I_StopSound(c.handle);
      for (var i = 0; i < numChannels; i++)
        if (cnum !== i && c.sfxinfo === channels[i].sfxinfo) break;
      c.sfxinfo.usefulness--;
      c.sfxinfo = null;
      c.origin = null;
    }
  }
  function S_StopSound(origin) {                // s_sound.c:471
    for (var cnum = 0; cnum < numChannels; cnum++)
      if (channels[cnum].sfxinfo && channels[cnum].origin === origin) {
        S_StopChannel(cnum); break;
      }
  }

  function S_getChannel(origin, sfxinfo) {      // s_sound.c:827
    var cnum;
    for (cnum = 0; cnum < numChannels; cnum++) {
      if (!channels[cnum].sfxinfo) break;
      else if (origin && channels[cnum].origin === origin) { S_StopChannel(cnum); break; }
    }
    if (cnum === numChannels) {
      for (cnum = 0; cnum < numChannels; cnum++)
        if (channels[cnum].sfxinfo.priority >= sfxinfo.priority) break;
      if (cnum === numChannels) return -1;      // Sorry, Charlie.
      else S_StopChannel(cnum);
    }
    channels[cnum].sfxinfo = sfxinfo;
    channels[cnum].origin = origin;
    return cnum;
  }

  var M_Random = function () { return (typeof G !== "undefined" && G.M_Random) ? G.M_Random() : ((Math.random() * 256) | 0); };

  function S_StartSoundAtVolume(origin, sfx_id, volume) {  // s_sound.c:254
    var rc, sep, pitch, priority, sfxs = S_sfx[sfx_id];
    var pl = (typeof G !== "undefined" && G.players) ? G.players[G.consoleplayer || 0] : null;
    if (sfx_id < 1 || sfx_id >= NUMSFX) return;
    if (sfxs.link) {
      pitch = sfxs.pitch;
      priority = sfxs.priority;
      volume += sfxs.volume;
      if (volume < 1) return;
      if (volume > snd_SfxVolume) volume = snd_SfxVolume;
    } else {
      pitch = NORM_PITCH;
      priority = NORM_PRIORITY;
    }
    if (origin && pl && pl.mo && origin !== pl.mo) {
      var out = { vol: volume, sep: NORM_SEP, pitch: pitch };
      rc = S_AdjustSoundParams(pl.mo, origin, out);
      volume = out.vol; sep = out.sep;
      if (origin.x === pl.mo.x && origin.y === pl.mo.y) sep = NORM_SEP;
      if (!rc) return;
    } else {
      sep = NORM_SEP;
    }
    // hacks to vary the sfx pitches
    if (sfx_id >= sfx.sfx_sawup && sfx_id <= sfx.sfx_sawhit) {
      pitch += 8 - (M_Random() & 15);
      if (pitch < 0) pitch = 0; else if (pitch > 255) pitch = 255;
    } else if (sfx_id !== sfx.sfx_itemup && sfx_id !== sfx.sfx_tink) {
      pitch += 16 - (M_Random() & 31);
      if (pitch < 0) pitch = 0; else if (pitch > 255) pitch = 255;
    }
    S_StopSound(origin);
    var cnum = S_getChannel(origin, sfxs);
    if (cnum < 0) return;
    if (sfxs.usefulness++ < 0) sfxs.usefulness = 1;
    channels[cnum].handle = I_StartSound(sfx_id, volume, sep, pitch, priority);
  }
  function S_StartSound(origin, sfx_id) {       // s_sound.c:397
    if (!sfx_id || sfx_id >= NUMSFX) return;
    S_StartSoundAtVolume(origin, sfx_id, snd_SfxVolume);
  }

  function S_UpdateSounds(listener_p) {         // s_sound.c:519
    for (var cnum = 0; cnum < numChannels; cnum++) {
      var c = channels[cnum], sfxs = c.sfxinfo;
      if (c.sfxinfo) {
        if (I_SoundIsPlaying(c.handle)) {
          var volume = snd_SfxVolume, pitch = NORM_PITCH, sep = NORM_SEP;
          if (sfxs.link) {
            pitch = sfxs.pitch;
            volume += sfxs.volume;
            if (volume < 1) { S_StopChannel(cnum); continue; }
            else if (volume > snd_SfxVolume) volume = snd_SfxVolume;
          }
          if (c.origin && listener_p !== c.origin) {
            var out = { vol: volume, sep: sep, pitch: pitch };
            var audible = S_AdjustSoundParams(listener_p, c.origin, out);
            if (!audible) S_StopChannel(cnum);
            else I_UpdateSoundParams(c.handle, out.vol, out.sep, out.pitch);
          }
        } else {
          S_StopChannel(cnum);
        }
      }
    }
  }

  // ------------------------------------------------------------------ I_ layer (i_sound.c)
  function I_StartSound(id, vol, sep, pitch /*, priority */) {
    return addsfx(id, vol, steptable[pitch], sep);
  }
  function I_StopSound(handle) { handle = 0; }
  function I_SoundIsPlaying(handle) { return gametic < handle; }  // the quirk
  function I_UpdateSoundParams(handle, vol, sep, pitch) { return 1; }

  function S_SetSfxVolume(volume) { snd_SfxVolume = volume; }
  function S_SetMusicVolume(volume) {
    // choco s_sound: DMX 0..15 master -> MIDI 0..127 via <<3 before the module
    if (music) music.setVolume(127);            // s_sound.c:624 double-write quirk
    if (music) music.setVolume(volume << 3);
    snd_MusicVolume = volume;
  }

  // ------------------------------------------------------------------ music (opl.js)
  var music = null;                             // set by OPL.init when chip ready
  var mus_looping = false;                      // replayed once chip attaches (async init)
  function S_ChangeMusic(musicnum, looping) {   // s_sound.c:649
    if (musicnum <= mus.mus_None || musicnum >= MUSIC_NAMES.length) return;
    if (mus_playing === musicnum) return;
    S_StopMusic();
    var name = MUSIC_NAMES[musicnum];
    var mus_data = ASSETS.music && ASSETS.music[name.toUpperCase()];
    if (!mus_data) { mus_playing = null; return; }  // e.g. bunny/victor not in doom1.wad
    mus_looping = !!looping;
    if (music) music.play(name, mus_data, mus_looping);
    else { pendingMusic = [name, mus_data, mus_looping]; }
    mus_playing = musicnum;
  }
  var pendingMusic = null;
  function S_StopMusic() {                       // s_sound.c:689
    if (mus_playing !== null && mus_playing !== 0) {
      if (mus_paused && music) music.resume();
      if (music) music.stop();
      mus_playing = null;
    }
  }
  function S_PauseSound() {                      // s_sound.c:497
    if (mus_playing && !mus_paused) { if (music) music.pause(); mus_paused = true; }
  }
  function S_ResumeSound() {
    if (mus_playing && mus_paused) { if (music) music.resume(); mus_paused = false; }
  }
  function S_StartMusic(m_id) { S_ChangeMusic(m_id, false); }

  function S_Start() {                           // s_sound.c:202
    for (var cnum = 0; cnum < numChannels; cnum++)
      if (channels[cnum].sfxinfo) S_StopChannel(cnum);
    mus_paused = 0;
    var mnum;
    // s_sound.c:214: commercial maps index mus_runnin directly; Doom1
    // episodes 1-3 stride off mus_e1m1, episode 4 through spmus[].
    var commercial = (typeof gamemode !== "undefined" && gamemode === "commercial");
    var ep = ((typeof G !== "undefined" && G.gameepisode) || 1);
    if (ep < 1) ep = 1;
    var map = (typeof G !== "undefined" && G.gamemap) || 1;
    if (commercial) mnum = mus.mus_runnin + map - 1;
    else if (ep < 4) mnum = mus.mus_e1m1 + (ep - 1) * 9 + map - 1;
    else mnum = spmus[map - 1];
    S_ChangeMusic(mnum, true);
  }

  // ------------------------------------------------------------------ WebAudio sink
  var ctx = null, node = null, unlocked = false;
  var outPhase = 0;                              // 11025 -> ctxRate upsample cursor
  var musPhase = 0;                              // musicMixRate -> ctxRate cursor
  var musicMixRate = 49716;                      // OPL render rate (matches opl.js chipRate)

  function unlock() {                            // call from a user gesture
    if (unlocked) { if (ctx && ctx.state === "suspended") ctx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // Prefer the OPL chip rate as the device rate: the music feed then runs
    // 1:1 (musPhase never crosses) — zero resampling artifacts regardless of
    // the OS's default rate. Chrome/PipeWire usually honours the request; if
    // it rejects or snaps elsewhere, onAudioProcess handles any device rate.
    var wantRates = (typeof AC.sampleRates === "object" && AC.sampleRates.length)
      ? AC.sampleRates : null;
    try {
      if (!wantRates || wantRates.indexOf(musicMixRate) !== -1)
        ctx = new AC({ latencyHint: "interactive", sampleRate: musicMixRate });
      else ctx = new AC({ latencyHint: "interactive" });
    } catch (e) { ctx = null; }
    if (!ctx) ctx = new AC({ latencyHint: "interactive" });
    node = ctx.createScriptProcessor(1024, 0, 2);
    node.onaudioprocess = onAudioProcess;
    node.connect(ctx.destination);
    outPhase = musPhase = 0;
    musNextL = musNextR = musPrevL = musPrevR = 0;
    pullMusic();                               // prime the 1-frame-ahead buffer
    unlocked = true;
  }

  // pull one 11025 Hz stereo frame; on block start run the DMX mix + music block
  var sfxL = 0, sfxR = 0;
  var mixPhase = 0;
  // Linear-interp state for the OPL feed: musPrev = chip sample at floor
  // (musPhase), musNext = sample at floor+1 (pulled one frame ahead). At
  // ctxRate == chipRate frac is always 0 -> exact sample pass-through.
  var musPrevL = 0, musPrevR = 0, musNextL = 0, musNextR = 0;
  function pullMusic() {
    musPrevL = musNextL; musPrevR = musNextR;
    if (music) { var ms = music.next(); musNextL = ms[0]; musNextR = ms[1]; }
    else { musNextL = 0; musNextR = 0; }
  }
  function pullFrame() {
    if (mixPhase === 0) {
      mix();
      mytime++;                              // soundsrv.c main-loop tick (per block)
      // Music block priming: next() self-primes when its 512-frame block is
      // exhausted, exactly at this point in the frame cycle — calling
      // newBlock() here too was NOT a second advance (verified: scheduler
      // songUs stays 1:1 with wall clock either way).
    }
    sfxL = mixbuffer[mixPhase * 2];
    sfxR = mixbuffer[mixPhase * 2 + 1];
    mixPhase++;
    if (mixPhase >= SAMPLECOUNT) mixPhase = 0;
  }

  function onAudioProcess(e) {
    var outL = e.outputBuffer.getChannelData(0);
    var outR = e.outputBuffer.getChannelData(1);
    var rate = ctx.sampleRate;                   // e.g. 48000, or 49716 when granted
    var n = outL.length;
    for (var i = 0; i < n; i++) {
      outPhase += MIXRATE;                       // SFX: 11025 DMX mixer rate
      while (outPhase >= rate) { outPhase -= rate; pullFrame(); }
      musPhase += musicMixRate;                  // music: native chip rate, independent
      while (musPhase >= rate) {
        musPhase -= rate;
        pullMusic();
      }
      // zero-order hold used to hold musPrev alone — at 44.1k that aliases
      // against the 49716 Hz chip grid; interp kills the beat junk.
      var frac = musPhase / rate;
      outL[i] = (sfxL + musPrevL + (musNextL - musPrevL) * frac) / 32768;
      outR[i] = (sfxR + musPrevR + (musNextR - musPrevR) * frac) / 32768;
    }
  }

  // ------------------------------------------------------------------ exports
  window.Snd = {
    sfx: sfx, mus: mus, S_sfx: S_sfx, MUSIC_NAMES: MUSIC_NAMES, spmus: spmus,
    ctxRate: function () { return ctx ? ctx.sampleRate : null; },   // probe/QC
    S_Init: S_Init, S_Start: S_Start,
    S_StartSound: S_StartSound, S_StartSoundAtVolume: S_StartSoundAtVolume,
    S_StopSound: S_StopSound, S_UpdateSounds: S_UpdateSounds,
    S_ChangeMusic: S_ChangeMusic, S_StopMusic: S_StopMusic,
    S_PauseSound: S_PauseSound, S_ResumeSound: S_ResumeSound, S_StartMusic: S_StartMusic,
    S_SetSfxVolume: S_SetSfxVolume, S_SetMusicVolume: S_SetMusicVolume,
    // WAD hot-swap: vanilla D_DoomMain analogue re-runs S_Init's getsfx loop
    // against the new ASSETS.sounds — drop decoded sample data first.
    S_ResetSfxData: function () {
      for (var i = 1; i < NUMSFX; i++) { S_sfx[i].data = null; S_sfx[i].length = 0; }
    },
    unlock: unlock,
    setGametic: function (t) { gametic = t; },
    attachMusic: function (m) {
      music = m;
      S_SetMusicVolume(snd_MusicVolume);       // re-apply master set before chip existed
      if (pendingMusic) {                      // music requested before chip init
        var pm = pendingMusic; pendingMusic = null;
        music.play(pm[0], pm[1], pm[2]);
      }
    },
    get gametic() { return gametic; },
    get musPlaying() { return mus_playing; },
    get ctxState() { return ctx ? ctx.state : "none"; },
    get activeChannels() {
      var n = 0;
      for (var i = 0; i < channels.length; i++) if (channels[i].sfxinfo) n++;
      return n;
    },
    // test hooks (node verification)
    _mix: mix, _addsfx: addsfx, _mixbuffer: mixbuffer, _S_sfx: S_sfx,
    _probe: function () {                 // sink-level diagnostic
      return { unlocked: unlocked, ctx: ctx ? ctx.state : "none",
               musicAttached: !!music, musPlaying: mus_playing,
               pending: !!pendingMusic, outPhase: outPhase, mixPhase: mixPhase };
    },
    _mixPhaseGet: function () { return mixPhase; },
    _setChannels: function (n) { numChannels = n; },
    _pumpSilent: function (frames) {             // advance mixer w/o WebAudio
      for (var i = 0; i < frames; i++) pullFrame();
    }
  };
})();
