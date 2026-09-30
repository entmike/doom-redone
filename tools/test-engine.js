// tools/test-engine.js — headless smoke test for engine.js
// Boots the WAD (wadboot-host), loads E1M1 from the binary WAD, then runs
// one frame and asserts the framebuffer is not blank.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

// browser-ish sandbox: script-level `const/let` in assets.js becomes a
// global lexical binding of the context, visible to later scripts.
const ctx = vm.createContext({ console, Buffer });

require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js);
vm.runInContext(fs.readFileSync(path.join(root, 'src', 'tables.js'), 'utf8'), ctx,
    { filename: 'src/tables.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'src/engine.js'), 'utf8'), ctx,
    { filename: 'src/engine.js' });

function run(expr) { return vm.runInContext(expr, ctx); }
let failures = 0;
function check(name, cond, extra) {
    if (cond) console.log('ok   -', name);
    else { failures++; console.log('FAIL -', name, extra || ''); }
}

vm.runInContext('loadMap(JSON.parse(__maps["E1M1"]));', ctx);

// --- lump sanity -----------------------------------------------------------
check('vertexes sane', run('numvertexes') > 50, run('numvertexes'));
check('linedefs sane', run('numlines') > 50, run('numlines'));
check('sectors sane (E1M1=85)', run('numsectors') > 10 && run('numsectors') < 128, run('numsectors'));
check('subsectors > 20', run('numsubsectors') > 20, run('numsubsectors'));
check('nodes == subsectors-1', run('numnodes') === run('numsubsectors') - 1,
    run('numnodes') + '/' + run('numsubsectors'));
check('blockmap loaded', run('bmapwidth') > 0 && run('bmapheight') > 0);
{
    // every BLOCKMAP list is 0xFFFF-terminated
    const term = vm.runInContext(`(function(){
        var ok = true, bl = blockmaplump, n = bmapwidth*bmapheight;
        for (var b = 0; b < n; b++) {
            var p = blockmap[b];
            while (bl[p] !== -1) { p++; if (p > bl.length) { ok = false; break; } }
        }
        return ok;
    })()`, ctx);
    check('blockmap lists terminated', term);
}
check('P_GroupLines sector lines', vm.runInContext('sectors[0].lines && sectors[0].lines.length > 0', ctx));

// --- BSP point lookup ------------------------------------------------------
{
    const r = vm.runInContext(`(function(){
        var ssi = R_PointInSubsector(1056*FRACUNIT|0, -3616*FRACUNIT|0);   // E1M1 start
        var ss = subsectors[ssi];
        return { ssi: ssi, sec: subsectors[ssi].sector === null ? -1 : numsectors,
                 secIdx: sectors.indexOf(ss.sector),
                 fl: ss.sector.floorheight/65536, cl: ss.sector.ceilingheight/65536,
                 light: ss.sector.lightlevel };
    })()`, ctx);
    // MAP01 start room: floor 0, light 160-ish, a normal (non-sky) sector
    check('R_PointInSubsector valid', r.ssi >= 0 && r.ssi < run('numsubsectors'));
    check('start room sector sane (floor 0, skyless, lit)',
        r.fl === 0 && r.cl > 0 && r.light >= 128, JSON.stringify(r));
    ctx.__r = r;
}

// --- P_CheckSight ----------------------------------------------------------
{
    const sight = vm.runInContext(`(function(){
        // two synthetic mobjs in the start room, clear line of sight
        function mk(x,y){
            var m = { x:x, y:y, z:0, height: 56*FRACUNIT, flags: MF_SOLID,
                      subsector: subsectors[R_PointInSubsector(x,y)],
                      snext:null,sprev:null,bnext:null,bprev:null };
            return m;
        }
        var a = mk(1056*FRACUNIT|0, -3616*FRACUNIT|0);   // E1M1 player start
        var b = mk(1008*FRACUNIT|0, -3600*FRACUNIT|0);   // sergeant slot beside it
        var sees = P_CheckSight(a,b);
        // far across the map, blocked by doors/walls
        var c = mk(192*FRACUNIT|0, -320*FRACUNIT|0);   // far room
        var sees2 = P_CheckSight(a,c);
        return {sees: sees, sees2: sees2};
    })()`, ctx);
    check('P_CheckSight near pair sees', sight.sees === true, JSON.stringify(sight));
}

// --- render one frame ------------------------------------------------------
{
    const res = vm.runInContext(`(function(){
        if (viewwidth === 0) R_SetViewSize(11, 0);
        R_ExecuteSetViewSize();
        // synthetic viewplayer per brief: x/y/angle on top, C fields under .player
        var vp = { x: -512*FRACUNIT|0, y: -576*FRACUNIT|0, angle: 0,
                   player: { viewz: 41*FRACUNIT|0, extralight: 0,
                             fixedcolormap: 0, mo: { flags: 0, x: -512*FRACUNIT|0,
                             y: -576*FRACUNIT|0, angle: 0,
                             subsector: subsectors[R_PointInSubsector(-512*FRACUNIT|0,-576*FRACUNIT|0)] } } };
        // synthetic sprite in view: spawn a medkit-ish thing
        var med = { x: -300*FRACUNIT|0, y: -450*FRACUNIT|0, z: 0, angle: 0,
                    sprite: 'MEDA', frame: 0, flags: MF_SPECIAL,
                    health: 0, tics: 0 };
        P_SetThingPosition(med);
        viewbuffer.fill(0xff000000);
        var cleared = viewbuffer[0];
        var t0 = Date.now();
        R_RenderPlayerView(vp);
        var ms = Date.now() - t0;
        var diff = 0;
        for (var i = 0; i < viewbuffer.length; i++)
            if (viewbuffer[i] !== cleared) diff++;
        return { diff: diff, ms: ms, w: viewwidth, h: viewheight,
                 nonblack: diff };
    })()`, ctx);
    check('viewsize = 320x200 at blocks 11', res.w === 320 && res.h === 200, JSON.stringify(res));
    check('frame non-blank', res.diff > 1000, JSON.stringify(res));
    console.log('   render:', res.diff, 'px changed in', res.ms, 'ms');
}

// --- low detail ("blocky") mode: R_SetViewSize(blocks, 1) halves viewwidth
// and every drawn column/span pixel must come in equal adjacent pairs
// (R_DrawColumnLow / R_DrawSpanLow write each texel twice, r_draw.c).
{
    const res = vm.runInContext(`(function(){
        R_SetViewSize(11, 1); R_ExecuteSetViewSize();
        if (colfunc !== R_DrawColumnLow || spanfunc !== R_DrawSpanLow)
            return {err: 'funcs not Low'};
        var vp = { x: -512*FRACUNIT|0, y: -576*FRACUNIT|0, angle: 0,
                   player: { viewz: 41*FRACUNIT|0, extralight: 0,
                             fixedcolormap: 0, mo: { flags: 0, x: -512*FRACUNIT|0,
                             y: -576*FRACUNIT|0, angle: 0,
                             subsector: subsectors[R_PointInSubsector(-512*FRACUNIT|0,-576*FRACUNIT|0)] } } };
        viewbuffer.fill(0xff000000);
        R_RenderPlayerView(vp);
        var painted = 0;
        for (var i = 0; i < viewbuffer.length; i++)
            if (viewbuffer[i] !== 0xff000000) painted++;
        var mism = 0, tot = 0;
        var vwLo = viewwidth, shLo = detailshift;   // capture BEFORE restore
        for (var y = 0; y < viewheight; y++)
            for (var x = 0; x < SCREENWIDTH; x += 2) {
                tot++;
                if (viewbuffer[y*SCREENWIDTH+x] !== viewbuffer[y*SCREENWIDTH+x+1]) mism++;
            }
        // back to high detail so later sections/tests see normal funcs
        R_SetViewSize(11, 0); R_ExecuteSetViewSize();
        var okBack = (colfunc === R_DrawColumn && spanfunc === R_DrawSpan);
        return { vw: vwLo, shift: shLo, mism: mism, tot: tot, okBack: okBack, painted: painted };
    })()`, ctx);
    check('low detail: viewwidth halved to 160', res.vw === 160 && res.shift === 1, JSON.stringify(res));
    check('low detail: frame non-blank', res.painted > 1000, JSON.stringify(res));
    check('low detail: every even/odd px pair equal', res.mism === 0, JSON.stringify(res));
    check('high detail restored after toggle', res.okBack === true, JSON.stringify(res));
}
{
    // Regression (user-reported "sprites broken in low mode"): gospel
    // R_DrawColumnLow mutated the GLOBAL dc_x (dc_x <<= 1) while
    // R_DrawVisSprite loops on dc_x -> only 1 sprite column drew. Our
    // Low column must NEVER modify dc_x.
    const r = vm.runInContext(`(function(){
        R_SetViewSize(10,1); R_ExecuteSetViewSize();
        dc_yl = 10; dc_yh = 12; dc_x = 57;
        dc_source = flatpix[0]; dc_srcoff = 0; dc_colormap = 0;
        dc_texturemid = 0; dc_iscale = FRACUNIT;
        var drawn = [];
        for (var x = 20; x <= 22; x++) { dc_x = x; colfunc(); drawn.push(dc_x); }
        R_SetViewSize(10,0); R_ExecuteSetViewSize();
        return JSON.stringify({drawn:drawn});
    })()`, ctx);
    const rr = JSON.parse(r);
    check('R_DrawColumnLow does not mutate dc_x', JSON.stringify(rr.drawn) === '[20,21,22]', r);
}

if (failures) { console.log('\n' + failures + ' FAILURES'); process.exit(1); }
console.log('\nALL CHECKS PASSED');

