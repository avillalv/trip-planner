---
paths:
  - "backend/tripplanner/models/**"
  - "backend/tripplanner/migrations/**"
---

# Database migrations

- Every schema change gets an Alembic migration in `backend/tripplanner/migrations/versions/`.
  `trip-planner serve` (npm start, autostart) applies pending ones at startup after a backup;
  `npm run dev` doesn't, so run `uv run --no-sync --project backend trip-planner migrate` there.
