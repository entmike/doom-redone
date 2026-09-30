# DOOM 1.10 JS port — static host.
#
# The app is pure static files + tools/server.js (node stdlib only): it
# serves the game and lists server-hosted .wad files at GET /wads (the
# in-game dropdown). NO WADs are baked into the image — the game refuses to
# boot without one, so mount a directory of .wads at /app/wads:
#
#   docker build -t doom-redone .
#   docker run -d -p 8791:8791 -v /path/to/your/wads:/app/wads:ro doom-redone
#   # then open http://localhost:8791/  (or ?wad=wads/DOOM2.wad to pick one)
#
# Without the volume the page boots to its "WAD not found" error, which is
# faithful: vanilla I_WadExists is a hard requirement, never a baked stub.
FROM node:24-alpine

WORKDIR /app

# server.js resolves ROOT as the parent of tools/, so keep that layout.
COPY index.html map.html ./
COPY src/ ./src/
COPY tools/server.js ./tools/

ENV PORT=8791
EXPOSE 8791
USER node
CMD ["node", "tools/server.js", "8791", "0.0.0.0"]
