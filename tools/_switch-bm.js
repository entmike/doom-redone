// Deep dive: why does P_PathTraverse see no lines at (152,2400) facing west in DOOM2 MAP01?
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const boot = require('./wadboot-host.js');
const ctx = { console, Buffer, Math, JSON, Date,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary') };
vm.createContext(ctx);
boot(ctx, 'DOOM2.wad');
for (const f of ['src/engine.js', 'src/game.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const S = (c) => vm.runInContext(c, ctx);
S(`G.currentMapJson = WAD.mapJson(__wad, "MAP01"); G.G_InitNew(3, 0, 1);`);

console.log(S(`(function(){
  const bm = G.mapdata.blockmap;
  const px = 152*65536, py = 2400*65536;
  const orgx = bm.bmaporgx !== undefined ? bm.bmaporgx : bm.orgx;
  const orgy = bm.bmaporgy !== undefined ? bm.bmaporgy : bm.orgy;
  const w = bm.bmapwidth !== undefined ? bm.bmapwidth : bm.width;
  const h = bm.bmapheight !== undefined ? bm.bmapheight : bm.height;
  const cx = (px - orgx) >> 23, cy = (py - orgy) >> 23;
  const l84 = G.lines[84];
  return JSON.stringify({
    bmKeys: Object.keys(bm).slice(0,12), orgx: orgx/65536, orgy: orgy/65536, w, h,
    cell: [cx, cy],
    cellList: bm.lineLists ? bm.lineLists[cy*w+cx] : 'no lineLists',
    l84mid: [Math.round((l84.v1.x+l84.v2.x)/2/65536), Math.round((l84.v1.y+l84.v2.y)/2/65536)],
    bmaporgxGlobal: [G.bmaporgx/65536, G.bmaporgy/65536, G.bmapwidth, G.bmapheight],
    // which cells does line84's midpoint live in?
    l84cell: [ (((l84.v1.x+l84.v2.x)/2|0) - orgx) >> 23, (((l84.v1.y+l84.v2.y)/2|0) - orgy) >> 23 ],
    // FRACBITS/MAPBLOCKSHIFT sanity
    FU: (typeof FRACBITS!=="undefined"?FRACBITS:16)
  });
})()`));

console.log(S(`(function(){
  // walk the ray cells manually: what does the iterator yield per cell?
  const orgx = G.bmaporgx, orgy = G.bmaporgy, w = G.bmapwidth;
  const cells = [];
  for (let cx = 11; cx >= 10; cx--) {
    const got = [];
    G.P_BlockLinesIterator(cx, 26, function(ld){ got.push(G.lines.indexOf(ld)); return true; });
    cells.push({ cx, n: got.length, has84: got.indexOf(84) !== -1 });
  }
  // and the raw list entry type
  const bm = G.mapdata.blockmap;
  const raw = bm.lineLists[26*w+11];
  return JSON.stringify({ cells, rawType: typeof raw, rawIsArr: Array.isArray(raw),
    rawSample: Array.isArray(raw) ? raw.slice(0,8) : raw });
})()`));

console.log(S(`(function(){
  const l = G.lines[84];
  const px = 214*65536, py = 2440*65536, ang = 202.1*65536/360*65536|0;
  // short-trace branch s1/s2 for a 64-unit aim ray from the player
  const fx = G.finecosine[(ang>>>19)], fy = G.finesine[(ang>>>19)];
  const rx = (px + 64*fx)|0, ry = (py + 64*fy)|0;
  const s1 = G.P_PointOnLineSide ? G.P_PointOnLineSide(px,py,l) : 'n/a';
  return JSON.stringify({
    v1: [l.v1.x/65536, l.v1.y/65536], v2: [l.v2.x/65536, l.v2.y/65536],
    twoSided: l.sidenum[1] !== -1, frontTex: G.sides[l.sidenum[0]].texture,
    aimEnd: [Math.round(rx/65536), Math.round(ry/65536)],
    frontIsPlayerSide: (function(){
      // point-on-line-side for player point: which side is the player on?
      const dx=l.v2.x-l.v1.x, dy=l.v2.y-l.v1.y;
      const ldx=px-l.v1.x, ldy=py-l.v1.y;
      return (dy*ldx - ldy*dx) > 0 ? '+' : '-';
    })()
  });
})()`));
