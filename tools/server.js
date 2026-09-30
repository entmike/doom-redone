#!/usr/bin/env node
// tools/server.js — pure-JS dev host for the DOOM port (replaces
// tools/nocache_server.py; no dependencies, node stdlib only).
//
//   node tools/server.js [port] [host]      defaults: 8791 0.0.0.0
//
// - Static files from the repo root (parent of tools/).
// - Cache-Control: no-store on everything (Chrome must never serve a stale
//   src/*.js after a commit — this was the cause of phantom "feature
//   missing" reports during development).
// - GET /wads        -> JSON array of server-hosted .wad filenames
//                       (the cheat-panel dropdown source; /wads/list.json
//                        is kept as a legacy alias)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = +(process.argv[2] || 8791);
const HOST = process.argv[3] || '0.0.0.0';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.wasm': 'application/wasm',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.map': 'application/json',
  '.wad': 'application/octet-stream', '.md': 'text/markdown; charset=utf-8',
};

const WADS_DIR = process.env.WADS_DIR || path.join(ROOT, 'wads');
function wadList() {
  try {
    return fs.readdirSync(WADS_DIR)
      .filter(n => n.toLowerCase().endsWith('.wad'))
      .sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1);
  } catch (e) { return []; }
}

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); }
  catch (e) { res.writeHead(400); res.end(); return; }

  const json = (code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store, max-age=0',
    });
    res.end(body);
  };

  // /wads API (the dropdown's only listing source)
  if (url === '/wads' || url === '/wads/')
    return json(200, wadList());

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end(); return;
  }

  // static: canonicalize inside ROOT (no .. traversal, no symlink escapes)
  let file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  const deliver = (f, stat) => {
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store, max-age=0',
      'Pragma': 'no-cache',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(f).pipe(res);
  };

  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      // directory: serve its index.html when present (covers '/' -> index.html)
      const idx = path.join(file, 'index.html');
      fs.stat(idx, (e3, ist) => {
        if (!e3 && ist.isFile()) { deliver(idx, ist); return; }
        if (!url.endsWith('/')) { res.writeHead(301, { Location: url + '/' }); res.end(); return; }
        // minimal directory listing (autoindex fallback for the dropdown)
        fs.readdir(file, (e2, items) => {
          if (e2) { res.writeHead(404); res.end('not found'); return; }
          const rows = items.sort().map(n =>
            '<li><a href="' + encodeURIComponent(n) + '">' + n + '</a></li>').join('\n');
          const body = '<!DOCTYPE HTML><html><body><h1>' + url +
            '</h1><ul>' + rows + '</ul></body></html>';
          res.writeHead(200, {
            'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(body),
            'Cache-Control': 'no-store, max-age=0',
          });
          res.end(body);
        });
      });
      return;
    }
    if (err) { res.writeHead(404); res.end('not found: ' + url); return; }
    deliver(file, st);
  });
});

server.listen(PORT, HOST, () => {
  console.log('doom dev server: http://' + HOST + ':' + PORT + '/  (root ' + ROOT + ')');
  console.log('wads API:        http://' + HOST + ':' + PORT + '/wads');
});
