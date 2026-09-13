# Aturan kerja wajib

- Sebelum commit + push, jalankan full quality gate: `npm run verify` (test + typecheck + lint + build). Commit/push hanya bila exit 0.
- `main` adalah protected branch (PR-only, required check `CI / verify`, strict, enforce_admins). Alur: branch -> push -> PR -> tunggu CI hijau -> squash merge. Jangan pernah push langsung ke `main`; jangan pakai `--no-verify` atau bypass apapun.
