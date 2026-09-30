// src/opl.js — DMX OPL music: MUS parser (sndserv/mus2mid.c ground truth) +
// GENMIDI player (Chocolate DOOM i_oplmusic.c, opl_doom_1_9 driver, OPL2/9-voice)
// driving the DBOPL chip in src/opl2.wasm.
/* global ASSETS, window */
(function () {
  "use strict";

  // frequency_curve[] + volume_mapping_table[] — verbatim from i_oplmusic.c
  var frequency_curve = [0x133,0x133,0x134,0x134,0x135,0x136,0x136,0x137,0x137,0x138,0x138,0x139,0x139,0x13a,0x13b,0x13b,0x13c,0x13c,0x13d,0x13d,0x13e,0x13f,0x13f,0x140,0x140,0x141,0x142,0x142,0x143,0x143,0x144,0x144,0x145,0x146,0x146,0x147,0x147,0x148,0x149,0x149,0x14a,0x14a,0x14b,0x14c,0x14c,0x14d,0x14d,0x14e,0x14f,0x14f,0x150,0x150,0x151,0x152,0x152,0x153,0x153,0x154,0x155,0x155,0x156,0x157,0x157,0x158,0x158,0x159,0x15a,0x15a,0x15b,0x15b,0x15c,0x15d,0x15d,0x15e,0x15f,0x15f,0x160,0x161,0x161,0x162,0x162,0x163,0x164,0x164,0x165,0x166,0x166,0x167,0x168,0x168,0x169,0x16a,0x16a,0x16b,0x16c,0x16c,0x16d,0x16e,0x16e,0x16f,0x170,0x170,0x171,0x172,0x172,0x173,0x174,0x174,0x175,0x176,0x176,0x177,0x178,0x178,0x179,0x17a,0x17a,0x17b,0x17c,0x17c,0x17d,0x17e,0x17e,0x17f,0x180,0x181,0x181,0x182,0x183,0x183,0x184,0x185,0x185,0x186,0x187,0x188,0x188,0x189,0x18a,0x18a,0x18b,0x18c,0x18d,0x18d,0x18e,0x18f,0x18f,0x190,0x191,0x192,0x192,0x193,0x194,0x194,0x195,0x196,0x197,0x197,0x198,0x199,0x19a,0x19a,0x19b,0x19c,0x19d,0x19d,0x19e,0x19f,0x1a0,0x1a0,0x1a1,0x1a2,0x1a3,0x1a3,0x1a4,0x1a5,0x1a6,0x1a6,0x1a7,0x1a8,0x1a9,0x1a9,0x1aa,0x1ab,0x1ac,0x1ad,0x1ad,0x1ae,0x1af,0x1b0,0x1b0,0x1b1,0x1b2,0x1b3,0x1b4,0x1b4,0x1b5,0x1b6,0x1b7,0x1b8,0x1b8,0x1b9,0x1ba,0x1bb,0x1bc,0x1bc,0x1bd,0x1be,0x1bf,0x1c0,0x1c0,0x1c1,0x1c2,0x1c3,0x1c4,0x1c4,0x1c5,0x1c6,0x1c7,0x1c8,0x1c9,0x1c9,0x1ca,0x1cb,0x1cc,0x1cd,0x1ce,0x1ce,0x1cf,0x1d0,0x1d1,0x1d2,0x1d3,0x1d3,0x1d4,0x1d5,0x1d6,0x1d7,0x1d8,0x1d8,0x1d9,0x1da,0x1db,0x1dc,0x1dd,0x1de,0x1de,0x1df,0x1e0,0x1e1,0x1e2,0x1e3,0x1e4,0x1e5,0x1e5,0x1e6,0x1e7,0x1e8,0x1e9,0x1ea,0x1eb,0x1ec,0x1ed,0x1ed,0x1ee,0x1ef,0x1f0,0x1f1,0x1f2,0x1f3,0x1f4,0x1f5,0x1f6,0x1f6,0x1f7,0x1f8,0x1f9,0x1fa,0x1fb,0x1fc,0x1fd,0x1fe,0x1ff,0x200,0x201,0x201,0x202,0x203,0x204,0x205,0x206,0x207,0x208,0x209,0x20a,0x20b,0x20c,0x20d,0x20e,0x20f,0x210,0x210,0x211,0x212,0x213,0x214,0x215,0x216,0x217,0x218,0x219,0x21a,0x21b,0x21c,0x21d,0x21e,0x21f,0x220,0x221,0x222,0x223,0x224,0x225,0x226,0x227,0x228,0x229,0x22a,0x22b,0x22c,0x22d,0x22e,0x22f,0x230,0x231,0x232,0x233,0x234,0x235,0x236,0x237,0x238,0x239,0x23a,0x23b,0x23c,0x23d,0x23e,0x23f,0x240,0x241,0x242,0x244,0x245,0x246,0x247,0x248,0x249,0x24a,0x24b,0x24c,0x24d,0x24e,0x24f,0x250,0x251,0x252,0x253,0x254,0x256,0x257,0x258,0x259,0x25a,0x25b,0x25c,0x25d,0x25e,0x25f,0x260,0x262,0x263,0x264,0x265,0x266,0x267,0x268,0x269,0x26a,0x26c,0x26d,0x26e,0x26f,0x270,0x271,0x272,0x273,0x275,0x276,0x277,0x278,0x279,0x27a,0x27b,0x27d,0x27e,0x27f,0x280,0x281,0x282,0x284,0x285,0x286,0x287,0x288,0x289,0x28b,0x28c,0x28d,0x28e,0x28f,0x290,0x292,0x293,0x294,0x295,0x296,0x298,0x299,0x29a,0x29b,0x29c,0x29e,0x29f,0x2a0,0x2a1,0x2a2,0x2a4,0x2a5,0x2a6,0x2a7,0x2a9,0x2aa,0x2ab,0x2ac,0x2ae,0x2af,0x2b0,0x2b1,0x2b2,0x2b4,0x2b5,0x2b6,0x2b7,0x2b9,0x2ba,0x2bb,0x2bd,0x2be,0x2bf,0x2c0,0x2c2,0x2c3,0x2c4,0x2c5,0x2c7,0x2c8,0x2c9,0x2cb,0x2cc,0x2cd,0x2ce,0x2d0,0x2d1,0x2d2,0x2d4,0x2d5,0x2d6,0x2d8,0x2d9,0x2da,0x2dc,0x2dd,0x2de,0x2e0,0x2e1,0x2e2,0x2e4,0x2e5,0x2e6,0x2e8,0x2e9,0x2ea,0x2ec,0x2ed,0x2ee,0x2f0,0x2f1,0x2f2,0x2f4,0x2f5,0x2f6,0x2f8,0x2f9,0x2fb,0x2fc,0x2fd,0x2ff,0x300,0x302,0x303,0x304,0x306,0x307,0x309,0x30a,0x30b,0x30d,0x30e,0x310,0x311,0x312,0x314,0x315,0x317,0x318,0x31a,0x31b,0x31c,0x31e,0x31f,0x321,0x322,0x324,0x325,0x327,0x328,0x329,0x32b,0x32c,0x32e,0x32f,0x331,0x332,0x334,0x335,0x337,0x338,0x33a,0x33b,0x33d,0x33e,0x340,0x341,0x343,0x344,0x346,0x347,0x349,0x34a,0x34c,0x34d,0x34f,0x350,0x352,0x353,0x355,0x357,0x358,0x35a,0x35b,0x35d,0x35e,0x360,0x361,0x363,0x365,0x366,0x368,0x369,0x36b,0x36c,0x36e,0x370,0x371,0x373,0x374,0x376,0x378,0x379,0x37b,0x37c,0x37e,0x380,0x381,0x383,0x384,0x386,0x388,0x389,0x38b,0x38d,0x38e,0x390,0x392,0x393,0x395,0x397,0x398,0x39a,0x39c,0x39d,0x39f,0x3a1,0x3a2,0x3a4,0x3a6,0x3a7,0x3a9,0x3ab,0x3ac,0x3ae,0x3b0,0x3b1,0x3b3,0x3b5,0x3b7,0x3b8,0x3ba,0x3bc,0x3bd,0x3bf,0x3c1,0x3c3,0x3c4,0x3c6,0x3c8,0x3ca,0x3cb,0x3cd,0x3cf,0x3d1,0x3d2,0x3d4,0x3d6,0x3d8,0x3da,0x3db,0x3dd,0x3df,0x3e1,0x3e3,0x3e4,0x3e6,0x3e8,0x3ea,0x3ec,0x3ed,0x3ef,0x3f1,0x3f3,0x3f5,0x3f6,0x3f8,0x3fa,0x3fc,0x3fe,0x36c];
  var volume_mapping_table = [0,1,3,5,6,8,10,11,13,14,16,17,19,20,22,23,25,26,27,29,30,32,33,34,36,37,39,41,43,45,47,49,50,52,54,55,57,59,60,61,63,64,66,67,68,69,71,72,73,74,75,76,77,79,80,81,82,83,84,84,85,86,87,88,89,90,91,92,92,93,94,95,96,96,97,98,99,99,100,101,101,102,103,103,104,105,105,106,107,107,108,109,109,110,110,111,112,112,113,113,114,114,115,115,116,117,117,118,118,119,119,120,120,121,121,122,122,123,123,123,124,124,125,125,126,126,127,127];

  var GENMIDI_NUM_INSTRS = 128, GENMIDI_NUM_PERCUSSION = 47;
  var OPL_NUM_VOICES = 9;                       // OPL2
  var MIDI_CHANNELS_PER_TRACK = 16;
  var GENMIDI_FLAG_FIXED = 0x0001, GENMIDI_FLAG_2VOICE = 0x0004;
  var voice_operators = [
    [0x00,0x01,0x02,0x08,0x09,0x0a,0x10,0x11,0x12],
    [0x03,0x04,0x05,0x0b,0x0c,0x0d,0x13,0x14,0x15]];

  // ------------------------------------------------------------------ MUS (mus2mid.c)
  var controller_map = [0x00,0x20,0x01,0x07,0x0a,0x0b,0x5b,0x5d,0x40,0x43,0x78,0x7b,0x7e,0x7f,0x79];
  // MUS runs at a fixed 140 Hz (DMX; doomwiki + moddingwiki): one tick =
  // 1/140 s, no tempo meta in DMX MUS. Scheduler math evUs = tick*us/ticks
  // is exact with ticks_per_beat=140, us_per_beat=1s. (mus2mid emits
  // resolution 0x46=70 writing raw MUS deltas; per the 140Hz fact that MIDI
  // plays at half MUS speed — do NOT copy 0x46 with raw MUS ticks, it made
  // everything 2x too slow here. Verified: E1M1 = 13440 ticks = 96 s @140Hz,
  // matching the known ~1:36 loop, vs 192 s with the old constants.)
  var MUS_TICKS_PER_BEAT = 140;
  var DEFAULT_US_PER_BEAT = 1000 * 1000;

  function parseMus(bytes) {
    // returns [{tick, ev:[...]}] in stream order; ev = MIDI-ish tuples
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes[0] !== 0x4d || bytes[1] !== 0x55 || bytes[2] !== 0x53) return null;
    var scorestart = dv.getUint16(6, true);       // MUS header (mus2mid.c:59): id[4] scorelength@4 scorestart@6 primary@8 secondary@10 instrcount@12
    var channel_map = new Int32Array(16).fill(-1);
    var channelvelocities = new Uint8Array(16).fill(127);
    var events = [];
    var queuedtime = 0, pos = scorestart, hitscoreend = false;

    function getMidiChannel(mus_channel) {
      if (mus_channel === 15) return 9;
      if (channel_map[mus_channel] === -1) {
        var max = -1;
        for (var i = 0; i < 16; i++) if (channel_map[i] > max) max = channel_map[i];
        var result = max + 1;
        if (result === 9) result = 10;          // never allocate percussion channel
        channel_map[mus_channel] = result;
        // "The D_DDTBLU disease" fix: all-notes-off on first use
        events.push([queuedtime, ["cc", result, 0x7b, 0]]);
      }
      return channel_map[mus_channel];
    }

    while (!hitscoreend) {
      while (!hitscoreend) {
        var desc = bytes[pos++];
        var channel = getMidiChannel(desc & 0x0f);
        var ev = desc & 0x70;
        switch (ev) {
          case 0x00: { var key = bytes[pos++];
            events.push([queuedtime, ["off", channel, key & 0x7f, 0]]); break; }
          case 0x10: { var key2 = bytes[pos++];
            if (key2 & 0x80) channelvelocities[channel] = bytes[pos++] & 0x7f;
            events.push([queuedtime, ["on", channel, key2 & 0x7f, channelvelocities[channel]]]);
            break; }
          case 0x20: { var wheelkey = bytes[pos++];
            var wheel = (wheelkey * 64) & 0xffff;
            events.push([queuedtime, ["bend", channel, wheel & 0x7f, (wheel >> 7) & 0x7f]]);
            break; }
          case 0x30: { var cn = bytes[pos++];
            if (cn < 10 || cn > 14) return null;
            events.push([queuedtime, ["cc", channel, controller_map[cn], 0]]);
            break; }
          case 0x40: { var cn2 = bytes[pos++], cv = bytes[pos++];
            if (cn2 === 0) events.push([queuedtime, ["patch", channel, cv & 0x7f]]);
            else {
              if (cn2 < 1 || cn2 > 9) return null;
              events.push([queuedtime, ["cc", channel, controller_map[cn2] & 0x7f, cv]]);
            }
            break; }
          case 0x60: hitscoreend = true; break;
          default: return null;
        }
        if (desc & 0x80) break;
      }
      if (!hitscoreend) {
        var timedelay = 0, working;
        for (;;) {
          working = bytes[pos++];
          timedelay = timedelay * 128 + (working & 0x7f);
          if ((working & 0x80) === 0) break;
        }
        queuedtime += timedelay;
      }
    }
    events.push([queuedtime, ["eot"]]);
    return events;
  }

  // ------------------------------------------------------------------ OPL player (i_oplmusic.c)
  // Chip render rate. Real hardware: YM3812 analog DAC ~49.7 kHz. Chocolate
  // feeds OPL_Init() the audio device rate — music NEVER goes through DMX's
  // 11025 Hz digital mixer (it was analog). Rendering at 11025 band-limits
  // noise-based patches (cymbals!) to 5.5 kHz -> crunchy/wrong timbre.
  var wasm = null, chip = null, chipPtrBuf = 0, chipRate = 49716;
  var mainInstrs = null, percussionInstrs = null, genmidiBytes = null;

  var voices = [], voice_free_list = [], voice_alloced_list = [];
  var voice_free_num = 0, voice_alloced_num = 0;
  var channels = [];
  var songEvents = null, eventIndex = 0, running = false, songLooping = false;
  var us_per_beat = DEFAULT_US_PER_BEAT, ticks_per_beat = MUS_TICKS_PER_BEAT;
  var songUs = 0, restartUs = -1;
  var paused = false;
  // choco: I_OPL_SetMusicVolume takes MIDI 0..127; Chocolate's s_sound feeds
  // the 0..15 DMX master scaled <<3 (15 -> 120). Feeding raw 15 clamps every
  // MUS volume/velocity (MUS ctrl3 ~100) to 15 -> melody ~27dB under drums.
  var current_music_volume = 120, start_music_volume = 120;

  var musL = new Float64Array(512), musR = new Float64Array(512);
  var blockIdx = 0, renderPtr = 0;

  function instrField(instrOff, voice, field) {
    // Verified against assets/audio.js GENMIDI lump: instrument = 36 bytes:
    //   u32 flags (lo=u16 flags, byte2=fine_tuning, byte3=fixed_note),
    //   then 2 x 16-byte voice: mod op[6], feedback u8, carrier op[6], unused, s16 offset
    var b = genmidiBytes;
    var v = instrOff + 4 + voice * 16;
    switch (field) {
      case "flags": return b[instrOff] | (b[instrOff + 1] << 8);
      case "fine": return b[instrOff + 2];
      case "fixed_note": return b[instrOff + 3];
      case "feedback": return b[v + 6];
      case "offset": return (b[v + 14] | (b[v + 15] << 8)) << 16 >> 16;
      case "mod_tremolo": return b[v + 0];
      case "mod_attack": return b[v + 1];
      case "mod_sustain": return b[v + 2];
      case "mod_waveform": return b[v + 3];
      case "mod_scale": return b[v + 4];
      case "mod_level": return b[v + 5];
      case "car_tremolo": return b[v + 7];
      case "car_attack": return b[v + 8];
      case "car_sustain": return b[v + 9];
      case "car_waveform": return b[v + 10];
      case "car_scale": return b[v + 11];
      case "car_level": return b[v + 12];
    }
    return 0;
  }
  var INSTR_SIZE = 36;         // 4 flags/fine/fixed + 2*genmidi_voice_t(16)

  function oplWrite(reg, val) {
    wasm.opl_write_reg(reg, val);                // DBOPL: reg = YM3812 register #
  }

  function GetFreeVoice() {
    if (voice_free_num === 0) return null;
    var result = voice_free_list[0];
    voice_free_num--;
    for (var i = 0; i < voice_free_num; i++) voice_free_list[i] = voice_free_list[i + 1];
    voice_alloced_list[voice_alloced_num++] = result;
    return result;
  }

  function VoiceKeyOff(voice) {
    oplWrite(0xb0 + voice.index, voice.freq >> 8);
  }

  function ReleaseVoice(index) {
    var voice, double_voice, i;
    if (index >= voice_alloced_num) {          // Doom 2 1.666 OPL crash emulation
      voice_alloced_num = 0; voice_free_num = 0;
      return;
    }
    voice = voice_alloced_list[index];
    VoiceKeyOff(voice);
    voice.channel = null;
    voice.note = 0;
    double_voice = voice.current_instr_voice !== 0;
    voice_alloced_num--;
    for (i = index; i < voice_alloced_num; i++)
      voice_alloced_list[i] = voice_alloced_list[i + 1];
    voice_free_list[voice_free_num++] = voice;   // search to end of freelist (Doom!)
    // opl_doom_1_9: no recursive release (that is < 1.9 drivers only)
  }

  function opData(instrOff, voiceNo, which) {
    var p = which === "car" ? "car_" : "mod_";
    return { tremolo: instrField(instrOff, voiceNo, p + "tremolo"),
             attack: instrField(instrOff, voiceNo, p + "attack"),
             sustain: instrField(instrOff, voiceNo, p + "sustain"),
             waveform: instrField(instrOff, voiceNo, p + "waveform"),
             scale: instrField(instrOff, voiceNo, p + "scale"),
             level: instrField(instrOff, voiceNo, p + "level") };
  }

  function LoadOpOut(operator, o, max_level) {
    // YM3812 operator register bases (choco opl.h): tremolo 0x20, LEVEL 0x40,
    // attack 0x60, sustain 0x80, waveform 0xE0. (0xC0 is the per-CHANNEL
    // feedback register, NOT a level register.)
    var level = o.scale;
    if (max_level) level |= 0x3f;
    else level |= o.level;
    oplWrite(0x40 + operator, level);
    oplWrite(0x20 + operator, o.tremolo);
    oplWrite(0x60 + operator, o.attack);
    oplWrite(0x80 + operator, o.sustain);
    oplWrite(0xe0 + operator, o.waveform);
    return level;
  }

  function SetVoiceInstrument(voice, instrOff, instr_voice) {
    if (voice.current_instr === instrOff && voice.current_instr_voice === instr_voice)
      return;
    voice.current_instr = instrOff;
    voice.current_instr_voice = instr_voice;
    var modulating = (instrField(instrOff, instr_voice, "feedback") & 0x01) === 0;
    // Doom loads the second operator first, then the first.
    voice.car_volume = LoadOpOut(voice.op2 | voice.array,
      opData(instrOff, instr_voice, "car"), true);
    voice.mod_volume = LoadOpOut(voice.op1 | voice.array,
      opData(instrOff, instr_voice, "mod"), !modulating);
    OPL_WriteFeedback(voice, instrField(instrOff, instr_voice, "feedback"));
    voice.priority = 0x0f - (opData(instrOff, instr_voice, "car").attack >> 4)
                   + 0x0f - (opData(instrOff, instr_voice, "car").sustain & 0x0f);
  }

  function OPL_WriteFeedback(voice, feedback) {
    oplWrite(0xc0 + voice.index | voice.array, feedback | voice.reg_pan);
  }

  function SetVoiceVolume(voice, volume) {
    var instrOff = voice.current_instr, iv = voice.current_instr_voice;
    voice.note_volume = volume;
    var midi_volume = 2 * (volume_mapping_table[voice.channel.volume] + 1);
    var full_volume = (volume_mapping_table[voice.note_volume] * midi_volume) >> 9;
    var car_volume = 0x3f - full_volume;
    if (car_volume !== (voice.car_volume & 0x3f)) {
      voice.car_volume = car_volume | (voice.car_volume & 0xc0);
      oplWrite(0x40 + voice.op2 | voice.array, voice.car_volume);      // LEVEL reg
      var fb = instrField(instrOff, iv, "feedback");
      var mod = opData(instrOff, iv, "mod");
      if ((fb & 0x01) !== 0 && mod.level !== 0x3f) {
        var mod_volume = mod.level;
        if (mod_volume < car_volume) mod_volume = car_volume;
        mod_volume |= voice.mod_volume & 0xc0;
        if (mod_volume !== voice.mod_volume) {
          voice.mod_volume = mod_volume;
          oplWrite(0x40 + voice.op1 | voice.array,                     // LEVEL reg
                   mod_volume | (mod.scale & 0xc0));
        }
      }
    }
  }

  function SetChannelVolume(channel, volume, clip_start) {
    channel.volume_base = volume;
    if (volume > current_music_volume) volume = current_music_volume;
    if (clip_start && volume > start_music_volume) volume = start_music_volume;
    channel.volume = volume;
    for (var i = 0; i < OPL_NUM_VOICES; ++i)
      if (voices[i].channel === channel) SetVoiceVolume(voices[i], voices[i].note_volume);
  }

  function SetChannelPan(channel, pan) { /* OPL3-only: opl_opl3mode == 0 */ }

  function AllNotesOff(channel) {
    for (var i = 0; i < voice_alloced_num; i++) {
      if (voice_alloced_list[i].channel === channel) { ReleaseVoice(i); i--; }
    }
  }

  function ReplaceExistingVoice() {              // opl_doom_1_9 variant
    var result = 0;
    for (var i = 0; i < voice_alloced_num; i++) {
      if (voice_alloced_list[i].current_instr_voice !== 0
       || voice_alloced_list[i].channel >= voice_alloced_list[result].channel)
        result = i;
    }
    ReleaseVoice(result);
  }

  function FrequencyForVoice(voice) {
    var note = voice.note;
    var instrOff = voice.current_instr, iv = voice.current_instr_voice;
    if ((instrField(instrOff, iv, "flags") & GENMIDI_FLAG_FIXED) === 0)
      note += instrField(instrOff, iv, "offset");
    while (note < 0) note += 12;
    while (note > 95) note -= 12;
    var freq_index = 64 + 32 * note + voice.channel.bend;
    if (iv !== 0) freq_index += (instrField(instrOff, iv, "fine") / 2) - 64;
    if (freq_index < 0) freq_index = 0;
    if (freq_index < 284) return frequency_curve[freq_index];
    var sub_index = (freq_index - 284) % (12 * 32);
    var octave = Math.floor((freq_index - 284) / (12 * 32));
    if (octave >= 7) octave = 7;
    return frequency_curve[sub_index + 284] | (octave << 10);
  }

  function UpdateVoiceFrequency(voice) {
    var freq = FrequencyForVoice(voice);
    if (voice.freq !== freq) {
      oplWrite(0xa0 + voice.index | voice.array, freq & 0xff);
      oplWrite(0xb0 + voice.index | voice.array, (freq >> 8) | 0x20);
      voice.freq = freq;
    }
  }

  function VoiceKeyOn(channel, instrOff, instrument_voice, note, key, volume) {
    var voice = GetFreeVoice();
    if (voice === null) return;
    voice.channel = channel;
    voice.key = key;
    if ((instrField(instrOff, instrument_voice, "flags") & GENMIDI_FLAG_FIXED) !== 0)
      voice.note = instrField(instrOff, instrument_voice, "fixed_note");
    else voice.note = note;
    voice.reg_pan = channel.pan;
    SetVoiceInstrument(voice, instrOff, instrument_voice);
    SetVoiceVolume(voice, volume);
    voice.freq = 0;
    UpdateVoiceFrequency(voice);
  }

  function TrackChannelForEvent(chNum) {          // MUS 15/MIDI 9 swap (choco:671)
    var c = chNum;
    if (c === 9) c = 15;
    else if (c === 15) c = 9;
    return channels[c];
  }

  function KeyOffEvent(ch, key) {
    var channel = TrackChannelForEvent(ch);
    for (var i = 0; i < voice_alloced_num; i++) {
      if (voice_alloced_list[i].channel === channel && voice_alloced_list[i].key === key) {
        ReleaseVoice(i);
        i--;
      }
    }
  }

  function KeyOnEvent(ch, key, volume) {
    if (volume <= 0) { KeyOffEvent(ch, key); return; }
    var note = key, instrument;
    var channel = TrackChannelForEvent(ch);
    if (ch === 9) {
      if (key < 35 || key > 81) return;
      instrument = percussionInstrs + (key - 35) * INSTR_SIZE;
      note = 60;
    } else {
      instrument = channel.instrument;
    }
    var double_voice = (instrField(instrument, 0, "flags") & GENMIDI_FLAG_2VOICE) !== 0;
    // opl_doom_1_9:
    if (voice_free_num === 0) ReplaceExistingVoice();
    VoiceKeyOn(channel, instrument, 0, note, key, volume);
    if (double_voice) VoiceKeyOn(channel, instrument, 1, note, key, volume);
  }

  function ProgramChangeEvent(ch, instrument) {
    var channel = TrackChannelForEvent(ch);
    channel.instrument = mainInstrs + instrument * INSTR_SIZE;
  }

  function ControllerEvent(ch, controller, param) {
    var channel = TrackChannelForEvent(ch);
    switch (controller) {
      case 7:  SetChannelVolume(channel, param, true); break;   // VOLUME_MSB
      case 10: SetChannelPan(channel, param); break;            // PAN
      case 0x7b: AllNotesOff(channel); break;                   // ALL_NOTES_OFF
      default: break;
    }
  }

  function PitchBendEvent(ch, param2) {
    var channel = TrackChannelForEvent(ch);
    channel.bend = param2 - 64;
    for (var i = 0; i < voice_alloced_num; ++i)
      if (voice_alloced_list[i].channel === channel) UpdateVoiceFrequency(voice_alloced_list[i]);
  }

  function ProcessEvent(ev) {
    switch (ev[0]) {
      case "on":   KeyOnEvent(ev[1], ev[2], ev[3]); break;
      case "off":  KeyOffEvent(ev[1], ev[2]); break;
      case "cc":   ControllerEvent(ev[1], ev[2], ev[3]); break;
      case "patch": ProgramChangeEvent(ev[1], ev[2]); break;
      case "bend": PitchBendEvent(ev[1], ev[3]); break;   // param2 = MSB
      case "eot":  trackEnd(); break;
    }
  }

  function InitChannel(channel) {                 // choco InitChannel
    channel.instrument = mainInstrs;
    channel.volume = current_music_volume;
    channel.volume_base = 100;
    if (channel.volume > channel.volume_base) channel.volume = channel.volume_base;
    channel.pan = 0x30;
    channel.bend = 0;
  }

  function RestartSong() {                        // choco RestartSong
    running = true;
    eventIndex = 0;
    start_music_volume = current_music_volume;
    for (var i = 0; i < MIDI_CHANNELS_PER_TRACK; ++i) InitChannel(channels[i]);
  }

  function trackEnd() {                           // TrackTimerCallback EOT branch
    running = false;
    if (songLooping) restartUs = songUs + 5000;   // 5ms restart delay (anti-lockup)
  }

  // ------------------------------------------------------------------ block rendering
  function newBlock() {
    // advance song scheduler by one 512-frame block, then render chip
    if (songEvents) {
      var block_us = 512 * 1e6 / chipRate;
      if (!paused) {
        if (restartUs >= 0 && songUs + block_us >= restartUs) {
          restartUs = -1;
          songUs = 0;
          RestartSong();
        }
        var target = songUs + block_us;
        while (eventIndex < songEvents.length) {
          var ev = songEvents[eventIndex];
          var evUs = ev[0] * us_per_beat / ticks_per_beat;
          if (evUs > target) break;
          ProcessEvent(ev[1]);
          eventIndex++;
        }
        songUs = target;
      }
    }
    wasm.opl_generate(renderPtr, 512);
    var i32 = new Int32Array(wasm.memory.buffer, renderPtr, 512);
    for (var i = 0; i < 512; i++) {
      musL[i] = i32[i];
      musR[i] = i32[i];
    }
    blockIdx = 0;
  }

  function next() {
    var i = blockIdx;
    if (i >= 512) { newBlock(); i = blockIdx; }
    var l = musL[i], r = musR[i];
    blockIdx = i + 1;
    return [l, r];
  }

  function pause() { paused = true;               // choco I_OPL_PauseSong
    for (var i = 0; i < OPL_NUM_VOICES; ++i)
      if (voices[i].channel !== null && voices[i].current_instr < percussionInstrs)
        VoiceKeyOff(voices[i]);
  }
  function resume() { paused = false; }

  function stop() {                               // I_OPL_StopSong
    songEvents = null; eventIndex = 0; running = false; songLooping = false;
    restartUs = -1; songUs = 0;
    for (var i = 0; i < MIDI_CHANNELS_PER_TRACK; ++i) AllNotesOff(channels[i]);
  }

  function play(name, b64, looping) {             // Register + Play combined
    var bytes, i;
    if (typeof atob !== "undefined") {
      var bin = atob(b64), u8 = new Uint8Array(bin.length);
      for (i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      bytes = u8;
    } else bytes = Buffer.from(b64, "base64");
    stop();
    songEvents = parseMus(bytes);
    if (!songEvents) return;
    songLooping = looping;
    eventIndex = 0;
    songUs = 0;
    restartUs = -1;
    us_per_beat = DEFAULT_US_PER_BEAT;
    ticks_per_beat = MUS_TICKS_PER_BEAT;
    start_music_volume = current_music_volume;
    running = true;
    for (i = 0; i < MIDI_CHANNELS_PER_TRACK; ++i) InitChannel(channels[i]);
    blockIdx = 512;
    paused = false;                               // I_OPL_PlaySong: OPL_SetPaused(0)
  }

  function setMusicVolume(volume) {               // I_OPL_SetMusicVolume
    if (current_music_volume === volume) return;
    current_music_volume = volume;
    for (var i = 0; i < MIDI_CHANNELS_PER_TRACK; ++i) {
      if (i === 15) SetChannelVolume(channels[i], volume, false);
      else SetChannelVolume(channels[i], channels[i].volume_base, false);
    }
  }

  // ------------------------------------------------------------------ init
  function InitVoices() {
    voice_free_num = OPL_NUM_VOICES;
    voice_alloced_num = 0;
    voices.length = 0; voice_free_list.length = 0; voice_alloced_list.length = 0;
    for (var i = 0; i < OPL_NUM_VOICES; ++i) {
      voices[i] = { index: i, op1: voice_operators[0][i], op2: voice_operators[1][i],
        array: 0, current_instr: null, current_instr_voice: 0,
        channel: null, key: 0, note: 0, freq: 0, note_volume: 0,
        car_volume: 0, mod_volume: 0, reg_pan: 0x30, priority: 0 };
      voice_free_list[i] = voices[i];
    }
  }

  function loadGenmidi(b64) {
    if (typeof atob !== "undefined") {
      var bin = atob(b64), u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      genmidiBytes = u8;
    } else genmidiBytes = new Uint8Array(Buffer.from(b64, "base64"));
    mainInstrs = 8;                                // strlen("#OPL_II#")
    percussionInstrs = mainInstrs + GENMIDI_NUM_INSTRS * INSTR_SIZE;
  }

  async function init(wasmUrl, rate) {
    chipRate = rate || 49716;
    var resp = await fetch(wasmUrl);
    var bytes = new Uint8Array(await resp.arrayBuffer());
    var mod = await WebAssembly.instantiate(bytes,
      { wasi_snapshot_preview1: new Proxy({}, { get: function () { return function () { return -1; }; } }) });
    wasm = mod.instance.exports;
    wasm.opl_create(chipRate);
    renderPtr = wasm.malloc(512 * 4);
    loadGenmidi(ASSETS.genmidi);
    channels.length = 0;
    for (var i = 0; i < MIDI_CHANNELS_PER_TRACK; i++)
      channels.push({ instrument: mainInstrs, volume: current_music_volume,
                      volume_base: 100, pan: 0x30, bend: 0 });
    InitVoices();
    return api;
  }

  var api = { init: init, play: play, stop: stop, pause: pause, resume: resume,
              setVolume: setMusicVolume, newBlock: newBlock, next: next,
              setGenmidi: loadGenmidi,   // WAD hot-swap: reparse GENMIDI lump
              _musSample: function () {          // diagnostic: peak of current music block
                var p = 0; for (var i = 0; i < 512; i++) { var a = Math.abs(musL[i]); if (a > p) p = a; }
                return { peak: p, songUs: songUs, events: songEvents ? songEvents.length : -1, evIdx: eventIndex };
              } };

  if (typeof window !== "undefined") window.OPLMusic = api;
})();
