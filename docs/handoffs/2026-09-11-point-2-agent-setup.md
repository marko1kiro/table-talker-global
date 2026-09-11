# Point 2 Agent Setup Notes

This is a reproducible checkpoint for future agents. Read
`2026-09-11-point-2-p0-1-checkpoint.md` first.

## Workspace constraints

- Keep all code work local until the user explicitly approves the next external
  action.
- Never apply migrations to Supabase, deploy Vercel, merge, or push follow-up
  code while blockers remain. The user explicitly approved pushing this
  state-preservation checkpoint branch so future agents can clone it.
- Use one commit per closed blocker, then stop and report with a local checkpoint.

## Toolchain

The hosted arm64 image may not include Node. Install Node 22 arm64 from the
official tarball, run `npm ci`, and keep `node_modules` outside the 1 GiB
workspace if needed. The embedded PostgreSQL package refuses to initialize as
root. Run DB tests under a non-root uid.

If embedded-postgres fails with the unhelpful init-script error, the image may
lack `en_US.UTF-8`. An available `C.utf8` locale can be aliased to
`en_US.utf8` before running the tests.

## Verification

Use the project scripts where possible:

```text
npm test
npm run typecheck
npm run lint
npm run build
```

The DB tests use disposable PostgreSQL and replay the full migration chain. Do
not substitute a linked or remote Supabase database.

## Git handoff

The authoritative state is the branch and commit named in the checkpoint doc.
Read the audit findings and candidate review already committed under
workspace archive when the branch is available.
