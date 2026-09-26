"""Serve the built React app (frontend/dist) with client-side routing fallback."""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse

NOT_BUILT_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Trip Planner</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 36rem; margin: 4rem auto; line-height: 1.5">
<h1>The web app hasn't been built yet</h1>
<p>Run <code>npm run build</code> from the repo root, or use <code>npm run dev</code> and open
<a href="http://localhost:5173">http://localhost:5173</a>.</p>
</body></html>"""


def mount_frontend(app: FastAPI, dist: Path) -> None:
    index = dist / "index.html"
    root = dist.resolve()

    @app.get("/{full_path:path}", include_in_schema=False, response_model=None)
    def spa(full_path: str) -> FileResponse | HTMLResponse:
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        if full_path:
            candidate = (dist / full_path).resolve()
            # Only serve real files that live inside dist (no path traversal).
            if candidate.is_file() and candidate.is_relative_to(root):
                return FileResponse(candidate)
        if index.is_file():
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
        return HTMLResponse(NOT_BUILT_PAGE, status_code=503)
