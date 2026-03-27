Standalone autopost (panel + publish pipeline only).

Docker: docker build -t autopost .
Render: connect repo; Dockerfile at repo root; or use render.yaml (autopost-panel/Dockerfile + context .).

Regenerate from monorepo: pnpm export:autopost-standalone
