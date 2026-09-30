# DOOM Redone

A browser port of **DOOM 1.10** (the id Software `linuxdoom-1.10` source release) to
plain JavaScript - no build step, no bundler, no dependencies. Every game asset
(maps, textures, flats, sprites, palette, colormaps, status bar, menus, sound
effects, music, GENMIDI instruments) is **hot-loaded from a binary `.wad` file at
runtime**; there is zero baked game content in this repository. The game refuses to
boot without a WAD, exactly as vanilla's `I_WadExists` did.

The reference C source in `reference/linuxdoom-1.10/` (kept locally, not
committed) is treated as **gospel**: behavior is matched tic-for-tic and
byte-for-byte wherever the browser allows, and most source lines carry their
`file.c:line` citation. Every intentional departure is tagged `DEVIATION` in a
comment.

## Quick start

```sh
node tools/server.js            # http://localhost:8791  (node stdlib only)
```

Drop a WAD into `wads/` (gitignored) or serve one via `?wad=`:

```
http://localhost:8791/                              # defaults to wads/doom1.wad
http://localhost:8791/index.html?wad=wads/DOOM2.wad
http://localhost:8791/index.html?wad=wads/E1M5.wad&map=E1M5   # direct-map boot
```

Tested with `doom1.wad` (shareware), `doom1.9-retail.wad`, `ultimate-doom.wad`,
`DOOM2.wad`, `PLUTONIA.wad`, `TNT.wad`, `NERVE.wad`, `freedoom2.wad`. Gamemode
(shareware / registered / retail / commercial) is detected from WAD content, not
the filename.

The server also lists its WAD directory at `GET /wads`, which feeds the in-game
WAD picker - hot-swap DOOM 1 → DOOM 2 without reloading the page (full engine
teardown/restart: sprite/patch/DMX/OPL caches, then back into the title or the
same map).

### Docker

The image contains **no WADs** (faithfully - the game errors out without one):

```sh
docker build -t doom-redone .
docker run -d -p 8791:8791 -v /path/to/your/wads:/app/wads:ro doom-redone
```

## Controls

| Input | Action |
|---|---|
| Mouse (pointer-locked) | turn · **LMB / Ctrl / Space** fire · **RMB / E / Enter** use |
| `W` `S` | forward / back · `A` `D` strafe (browser additions) |
| Arrows | turn / move (also strafe without Alt; vanilla numpad semantics) |
| Alt + mouse/arrows | strafe |
| Shift | run (`key_speed`, per gospel) |
| `1`–`7`, mouse wheel | weapon select / cycle (loop: fist→pistol→shotgun→SSG→chaingun→rocket→plasma→BFG) |
| `Tab` | in-game automap (vanilla: follow mode, arrows still walk) |
| `` ` `` | side-panel automap toggle (**DEVIATION** - vanilla has no second map; panel also has right-click teleport) |
| `-` / `=` | screen size |
| `F1` panel · `F2` save · `F3` load · `F4` sound · `F5` detail · `F6` quicksave · `F7` end game · `F8` messages · `F9` quickload · `F10` quit · `F12` spy | vanilla `g_game.c` defaults |
| `Esc` | control panel; menus behave like vanilla |

Cheat panel (beside the side map) runs the exact cheat bodies from
`st_stuff.c ST_Responder`: GOD, NOCLIP, IDFA, KFA, CHOPPERS, behold (`v s i r
a l`), MYPOS, MUSIC, level RESTART, WAD hot-load (file picker or server list),
and idclev-style map warp. The warp carries equipment like a normal level
change; RESTART is a fresh level load.

## How it's laid out

Everything is classic scripts loaded in dependency order by `index.html`
(there is deliberately no module system so the port stays openable with one
HTTP server):

| `src/` | Gospel source | What it does |
|---|---|---|
| `engine.js` | `r_*.c`, `p_maputl.c` (BSP) | Map parsing, blockmap, `R_RenderPlayerView`, column/span/flat/sprite/fuzz/masked draw, detail levels, automap geometry helpers |
| `game.js` | `p_mobj/p_map/p_move/p_floor/p_doors/p_plats/p_switch/p_spec/p_lights/p_enemy/p_pspr/p_inter/p_tick.c`, `d_player.h` | The whole simulation — dense `states[]`/`mobjinfo[]` tables generated from `info.c` (index == `statenum_t` / `mobjtype_t`) |
| `sound.js` | `s_sound.c`, `soundsrv.c` | DMX stack: channel manager + mixer at 11025 Hz, DMXWAV decode of `DS*` lumps; music sink on its own cursor at the OPL chip rate (49716 Hz AudioContext request + linear-interpolation fallback) |
| `opl.js` | `i_oplmusic.c`, `mus2mid` | MUS parser + choco GENMIDI driver over DBOPL compiled to `opl2.wasm` (rebuild: `tools/build-opl-wasm.sh`) |
| `tables.js` | `tables.c` | Verbatim trig-table literals (finesine/finetangent/tantoangle) — NOT reproducible from JS `Math`, embedded byte-exact |
| `wad.js` | `w_wad.c`, `r_data.c` | Binary WAD parser: lumps, maps, textures (TEXTURE1/2 + PNAMES, single-patch raw columns per `R_GenerateLookup`), flats, sprites, PLAYPAL/COLORMAPS, MUS/DS/GENMIDI |
| `wadinstall.js` | — (browser I/O layer) | Installs a parsed WAD as the live content set + content fingerprint (drives save namespacing) + hot-swap seams |
| `main.js` | `d_main.c`, `g_game.c`, `i_*` | Host loop: rAF tic pacing (no catch-up clamp, 120-tic browser-safety cap), input → ticcmd (`G_BuildTiccmd`), pointer lock, cheat panel, WAD boot flow, canvas fit, localStorage settings (`m_misc.c` analogue) |
| `m_menu.js` | `m_menu.c` | Menus incl. NEW GAME episode/skill pages, options |
| `wi.js` | `wi_stuff.c` | Intermission (animated tallies + sfx, par times) |
| `f_finale.js` | `f_finale.c` | Endings (episode texts, MAP06/11/20/30, cast call) |
| `f_wipe.js` | `f_wipe.c` | Dissolve melt (35 Hz driven, matches vanilla pacing) |
| `p_saveg.js` | `p_saveg.c` | Vanilla save envelope (PADSAVEP slot alignment, version-110 header, `0x1d` terminator) over localStorage, namespaced by WAD fingerprint |
| `hud.js` | `st_*.c` | Status bar widget system |
| `hu.js` | `hu_*.c` | HUD message widgets |
| `am_map.js` | `am_map.c` | Vanilla automap (Tab) |
| `automap.js` | — (DEVIATION) | Browser side-panel map + `map.html` sync feed |

| `tools/` | What it does |
|---|---|
| `server.js` | Dev host: static + no-store headers + `GET /wads` listing |
| `wadboot-host.js` | vm bootstrap used by tests: installs a real WAD into a Node `vm` context exactly like the browser does |
| `test-*.js` | Regression gates (see Testing) |
| `cdp-*.js`, `_*-*.js` | Live-browser probes over Chrome DevTools Protocol (`_`-prefixed are repro/diagnostic scripts) |

`index.html` wires nothing itself - `main.js` boots the flow: fetch WAD (with a
canvas progress bar at the real render size), install, title screen with the
attract demo, menu, game.

## Fidelity notes

Things that are *deliberately* faithful even though they look like bugs:

- **Fixed-point everywhere.** `fixed_t` math keeps C's arithmetic-shift and
  truncation semantics; the dense `states[]`/`mobjinfo[]` tables are index-true
  against `info.c` so `mobjinfo[type]` and saved state numbers match vanilla.
- **No tic catch-up clamp.** `TryRunTics` runs all elapsed tics like `d_net.c`;
  only a 120-tic cap protects against background-tab rAF freezes.
- **Vanilla bugs ported bug-for-bug** where user-visible (e.g. blocky-mode
  half-res seams follow PrBoom-style fixes only where 1.10's C was provably
  broken mid-implementation; fuzz/spectre, masked mid-textures, single-patch
  sky offset, intermission "didsecret" splat, etc.).
- **Sound positioning/clipping** is gospel `S_AdjustSoundParams` (1200-unit
  clip, distance volume steps) - including sector `soundorg` in fixed point.
- **Music is OPL, not MIDI-to-synth.** Authentic YM3812 rendering via DBOPL
  WASM at the chip's native rate; MUS tempo is the fixed 140 Hz DMX tick.

Documented `DEVIATION`s (grep for the tag): WASD + mouse wheel weapon cycling +
RMB-use conveniences, side-panel automap (backquote) with right-click teleport,
"secret is revealed" HUD message (screen-centered, per request - vanilla is
silent), per-WAD save namespacing (vanilla had one IWAD), episode-2/3 starts on
retail via canonical `E%eM%m` map keys, hard-cut instead of wipe for the
browser-only level-reload seams, and the E1M8-victory restart landing on a
fresh E1M1 new game.

### Saves

Slots live in `localStorage` as `doom-redone:save:<fp>:doomsavN` where `<fp>` is
a content fingerprint (FNV-1a over lump names+sizes) of the installed WAD -
saves made under one IWAD never load under another, but foreign slots are
*preserved* so hot-swapping back restores them. A silently blocked storage
write surfaces as `SAVE FAILED` instead of a false "game saved.".

## Testing

No framework; each gate is a self-contained Node script that boots the real
files inside a `vm` context on a real WAD (`tools/wadboot-host.js`) and asserts
behavior - geometry, pixels, fixed-point values, state chains, audio buffers -
then exits non-zero on failure. The full battery:

```sh
for t in test-menu test-save test-automap test-wad test-wad-live test-engine \
         test-wipe test-demo-cmd test-sight-alert test-intermission \
         test-fixedmath test-things test-nosector test-weapons \
         test-doorsfx test-telefog test-levelcarry test-secret-msg; do
  node tools/$t.js >/dev/null 2>&1 && echo "ok   $t" || echo "FAIL $t"
done
```

Highlights: `test-wad`/`test-wad-live` (parser + full render from binary WAD),
`test-fixedmath` (SlopeDiv vs gospel), `test-demo-cmd` (the three shareware
demos' raw ticcmd bytes), `test-levelcarry` (equipment persists across levels
via `G_DoLoadLevel`, stripped powers/cards, skill preserved),
`test-doorsfx`/`test-telefog` (fixed-point soundorg; MT_TFOG not the stale
type-7 literal). `tools/cdp-*.js` scripts drive a real Chromium over CDP for
pixel/audio/input verification (`tools/launch-probe-chrome.sh` starts a
debuggable instance on `:9333`).

## Repository conventions

- Commit messages: imperative subject, body explains root cause + verification.
- Every fix gets a regression gate under `tools/test-*.js`; probes/diagnostics
  use the `_`- or `cdp-` prefix families and are kept for reuse.
- `reference/` and `wads/*.wad` are gitignored (licensed content and the
  gospel C stay out of the repo).
- `assets/` is an empty legacy shim - all content now comes from the WAD.

## License

This port is distributed under the GNU General Public License v2 (see
`LICENSE.TXT`), the same license id Software released the DOOM 1 source
under. Game content is *not* licensed or distributed here: WADs must be
supplied by the user from their own retail copies.
