#!/usr/bin/env python3
"""Static test server that disables ALL caching.
Usage: python3 tools/serve.py [port]   (default 8791)
Every response gets Cache-Control: no-store so edits to engine.js / maps /
index.html are picked up on plain reload — no ?v= bumps needed for testing.
"""
import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter than default
        pass


if __name__ == "__main__":
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"serving {ROOT} on http://127.0.0.1:{PORT}/index.html (no-store)")
        httpd.serve_forever()
