// Which version-identifying / version-gated lumps exist in each WAD?
const WAD = require('../src/wad.js'), fs = require('fs');
const names = ['TITLEPIC', 'M_DOOM', 'HELP1', 'HELP2', 'CREDIT', 'END', 'ENDSCRIPT',
               'SWSTRING', 'MENUTITLE', 'STPARS', 'STCFN033', 'FLOOR7_2', 'ROCK1',
               'D_VICTOR', 'D_BUNNY', 'INTERPIC', 'WILV0', 'WILV00', 'WILV2', 'WILV29',
               'M_EPISOD', 'M_READT1', 'M_EPITOD', 'WI_KILLCNT', 'STBAR'];
for (const f of ['wads/doom1.wad', 'wads/doom1.9-retail.wad']) {
  const b = fs.readFileSync(f);
  const w = WAD.load(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const have = new Set(w.lumps.map(l => l.name));
  const maps = WAD.mapList(w).map(m => m.name);
  console.log(f, 'lumps=' + w.lumps.length, 'maps=' + maps.join(','));
  console.log('  ' + names.map(n => n + (have.has(n) ? ':Y' : ':-')).join(' '));
  console.log('  IWAD marker: ' + (w.info && w.info.wadtype || '?') + '  E1M9? ' + have.has('E1M9'));
}
