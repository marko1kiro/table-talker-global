# GitHub and Vercel Account Migration Design

## Goal

Move ongoing Table Talker development to a separate local folder, private GitHub repository, and Vercel account while preserving complete Git history. Promote the verified multi-restaurant branch to the new repository's `main` branch. Keep current Supabase and Cloudflare R2 resources unchanged.

## Targets

- Local folder: `C:\Users\dirga\Documents\table-talker-global`
- GitHub repository: `marko1kiro/table-talker-global`
- Vercel project: `table-talker-global`
- Production branch: `main`
- Existing Supabase project and R2 bucket remain authoritative.

## Safety Boundaries

- Do not modify or delete `C:\Users\dirga\Documents\table-talker`.
- Do not rewrite published Git history.
- Do not copy `.vercel`, `supabase/.temp`, generated working-tree noise, or unrelated uncommitted files.
- Do not expose secrets while transferring environment variables.
- Do not delete or unlink old GitHub/Vercel resources.
- Do not move production domains during this migration.

## Git Migration

1. Authenticate GitHub CLI as `marko1kiro` and verify access to the private target repository.
2. Create the target folder by cloning `marko1kiro/table-talker-global`.
3. Add the current repository as temporary remote `legacy` and fetch all branches and tags.
4. Base new `main` on `legacy/feat/restaurants-phase1`, preserving its ancestry.
5. Reapply only the verified crew-session loop fix from the old worktree and run full verification.
6. Commit that fix in the new repository using the new Git identity.
7. Push `main`, all useful legacy branches, and all tags to the new repository without force-pushing.
8. Remove temporary `legacy` remote after verifying remote refs.

The empty target repository may already have an initialization commit. If so, stop and inspect it before changing `main`; do not force-push or discard it silently.

## Vercel Migration

1. Authenticate Vercel CLI with the new account and verify identity.
2. Import `marko1kiro/table-talker-global` through Vercel Git integration as project `table-talker-global`.
3. Set `main` as production branch and retain automatic deployments for pushes and pull requests.
4. Recreate required environment variables in Production, Preview, and Development scopes using values from the existing project or approved local environment. Never print secret values.
5. Keep Supabase project URL/keys, restaurant-code encryption key, and R2 credentials/resource identifiers pointed at existing resources.
6. Trigger deployment from the Git-connected `main` branch rather than standalone archive deployment.

## Verification

Before push:

- Full test suite passes.
- Typecheck passes.
- Production build passes.
- Git diff contains only intended crew fix and its regression test.

After GitHub migration:

- New `main` contains multi-restaurant implementation and crew fix.
- Legacy branches and tags are visible in the target repository.
- Repository remains private.

After Vercel migration:

- Deployment source identifies `marko1kiro/table-talker-global` and `main`.
- `CKRBUL` restaurant login succeeds.
- Crew name claim remains stable and dashboard opens.
- Audio manifest sync completes.
- Super Admin route loads its currently implemented pre-Phase-6 interface.
- A harmless follow-up push or PR proves Git auto-deploy wiring.

## Rollback

The old local folder, GitHub repository, Vercel project, Supabase project, and R2 bucket remain untouched. If migration verification fails, stop using the new deployment and diagnose it without changing old production resources.

## Out of Scope

- Phase 6 Super Admin redesign
- Supabase migration to a new project
- R2 bucket migration
- Domain transfer
- Deletion or archival of old accounts and projects
