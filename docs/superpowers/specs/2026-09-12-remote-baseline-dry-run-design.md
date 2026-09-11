# Remote Baseline Dry-Run Design

## Scope

Validate missing Point 2 migration chain on an isolated Supabase development branch. Production database, Vercel, and `main` remain unchanged.

## Procedure

Create a development branch from current production schema. Inventory branch migrations, schema, grants, RLS, and active crew-login dependencies. Apply the missing Point 2 migrations in repository order to the development branch only, including P1-5 registry migration.

Run repository disposable-PostgreSQL tests and branch-targeted read-only schema checks. Run crew-login smoke against development branch credentials only: authenticated crew session claim/heartbeat contract, RLS visibility, and role-session token path. Stop before production action if any migration fails, crew contract changes, grant/RLS drift appears, or smoke fails.

## Success

Development branch contains full intended migration chain; P1-5 registry and function security contract exist; crew login smoke passes; production migration history remains unchanged. Output records exact applied versions, branch ID, checks, and a production rollout recommendation.

## Constraints

No production migration, merge, Vercel deploy, force-push, or P2-6 work. Branch is deleted after evidence capture unless retained for follow-up.
