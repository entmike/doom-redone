// PLUTONIA probe: demo headers + commercial content lumps
const WAD = require('../src/wad.js'), fs = require('fs');
const b = fs.readFileSync('wads/PLUTONIA.wad');
const w = WAD.load(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
for (const n of ['DEMO1', 'DEMO2', 'DEMO3']) {
  const d = w.lumps[w.find(n)].data();
  console.log(n, 'ver', d[0], 'skill', d[1], 'ep', d[2], 'map', d[3]);
}
const have = new Set(w.lumps.map(l => l.name));
for (const n of ['DM2TTL', 'D_DM2TTL', 'D_DM2INT', 'WILV20', 'WILV21', 'WILV00',
                 'WIA1000', 'WIA2000', 'WIURH0', 'WIPAX0', 'WIMAP0', 'WIMAP1', 'WIMAP2',
                 'HELP', 'HELP1', 'HELP2', 'CREDIT', '/end', 'INTERPIC', 'CREDIT',
                 'M_EPISOD', 'M_EPI1', 'SRBAR', 'LVBAR', 'STTNUM0', 'RROCK14', 'SLIME16',
                 'D_VICTOR', 'D_BUNNY', 'D_READ_M', 'D_STALKS', 'D_COUNTD', 'D_DOOM',
                 'D_THEEND', 'D_OMEGA'])
  if (have.has(n)) console.log('HAS', n);
