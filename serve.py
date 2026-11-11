#!/usr/bin/env python3
"""Local dev server for Game.

Same as `python3 -m http.server`, but tells the browser not to cache anything,
so a normal reload always picks up the latest code (no stale half-updated modules).

Usage: python3 serve.py [port]    (default 8000, listens on localhost only)
"""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f"Game running at http://localhost:{port}  (Ctrl+C to stop)")
http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
