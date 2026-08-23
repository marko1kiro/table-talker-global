# GitHub and Vercel Account Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate complete project history to `marko1kiro/table-talker-global`, promote verified multi-restaurant work to `main`, and connect new Vercel project `table-talker-global` with existing Supabase and R2 resources.

**Architecture:** Authenticate new accounts first, then construct clean target clone from remote history rather than copying working directory. Transfer only verified crew-session fix, validate new `main`, push preserved branches/tags, then configure Vercel Git integration and environment scopes. Keep all old resources intact for rollback.

**Tech Stack:** Git, GitHub CLI, Vercel CLI, Vite, Vitest, TypeScript, Supabase, Cloudflare R2

---

### Task 1: Authenticate New Accounts

**Files:**
- No files changed

- [ ] **Step 1: Check current GitHub identity**

Run:

```powershell
gh auth status
```

Expected: current identity is shown. If it is not `marko1kiro`, continue to Step 2.

- [ ] **Step 2: Authenticate GitHub CLI in browser**

Run:

```powershell
gh auth login --hostname github.com --git-protocol https --web
```

Expected: browser authorization completes for `marko1kiro`.

- [ ] **Step 3: Verify target repository access**

Run:

```powershell
gh auth status
gh repo view marko1kiro/table-talker-global --json nameWithOwner,isPrivate,defaultBranchRef
```

Expected: account `marko1kiro`; repository `marko1kiro/table-talker-global`; `isPrivate: true`.

- [ ] **Step 4: Authenticate Vercel CLI**

Run:

```powershell
npx vercel logout
npx vercel login
```

Expected: browser authorization completes for new Vercel account.

- [ ] **Step 5: Verify Vercel identity**

Run:

```powershell
npx vercel whoami
```

Expected: new Vercel username, not `miracle1min` unless new account intentionally uses that username.

### Task 2: Commit Migration Spec in Legacy Feature Branch

**Files:**
- Create: `docs/superpowers/specs/2026-08-23-github-vercel-account-migration-design.md`

- [ ] **Step 1: Inspect intended spec diff**

Run:

```powershell
git diff -- docs/superpowers/specs/2026-08-23-github-vercel-account-migration-design.md
git status --short
```

Expected: spec is only intended documentation addition; unrelated files remain unstaged.

- [ ] **Step 2: Commit only migration spec**

Run:

```powershell
git add docs/superpowers/specs/2026-08-23-github-vercel-account-migration-design.md
git commit -m "docs: design github and vercel migration"
```

Expected: one commit containing only migration spec.

### Task 3: Commit Verified Crew Session Fix

**Files:**
- Modify: `src/hooks/use-remote-crew.ts`
- Modify: `tests/use-remote-crew.test.ts`

- [ ] **Step 1: Run focused regression test**

Run:

```powershell
npx vitest run tests/use-remote-crew.test.ts
```

Expected: 24 tests pass, including `keeps remote registration stable when claim issues crew credentials`.

- [ ] **Step 2: Inspect exact fix diff**

Run:

```powershell
git diff --check -- src/hooks/use-remote-crew.ts tests/use-remote-crew.test.ts
git diff -- src/hooks/use-remote-crew.ts tests/use-remote-crew.test.ts
```

Expected: `crewRegistrationKey` excludes `crewSessionToken`; effect depends on stable registration key; one regression test covers token issuance.

- [ ] **Step 3: Run full validation**

Run independently:

```powershell
npm test -- --run
npx tsc --noEmit
npm run build
```

Expected: all tests pass, typecheck exits 0, build exits 0.

- [ ] **Step 4: Commit only fix and regression test**

Run:

```powershell
git add src/hooks/use-remote-crew.ts tests/use-remote-crew.test.ts
git commit -m "fix: keep crew claim registration stable"
```

Expected: commit excludes `src/routeTree.gen.ts`, `supabase/.temp/`, and unrelated plans.

### Task 4: Create Separate Target Clone

**Files:**
- Create directory: `C:\Users\dirga\Documents\table-talker-global`

- [ ] **Step 1: Verify target parent and absence of target folder**

Run:

```powershell
Test-Path -LiteralPath "C:\Users\dirga\Documents"
Test-Path -LiteralPath "C:\Users\dirga\Documents\table-talker-global"
```

Expected: parent `True`; target `False`. If target is `True`, stop and inspect it.

- [ ] **Step 2: Clone private target repository**

Run:

```powershell
gh repo clone marko1kiro/table-talker-global "C:\Users\dirga\Documents\table-talker-global"
```

Expected: new folder contains `.git`; origin points to target repository.

- [ ] **Step 3: Inspect target initialization state**

Run in target folder:

```powershell
git remote -v
git status --short
git log --oneline --decorate -5
```

Expected: clean clone. If repository has an initialization commit, stop and compare before promoting multi-restaurant history.

### Task 5: Import Legacy History and Promote Multi-Restaurant Main

**Files:**
- Git refs only

- [ ] **Step 1: Add legacy repository remote**

Run in target folder:

```powershell
git remote add legacy https://github.com/miracle1min/table-talker
git fetch legacy --prune --tags
```

Expected: legacy branches and tags fetched without changing working tree.

- [ ] **Step 2: Verify crew-fix commits exist on legacy feature branch**

Run:

```powershell
git log --oneline legacy/feat/restaurants-phase1 -5
```

Expected: migration spec commit and `fix: keep crew claim registration stable` appear at branch tip.

- [ ] **Step 3: Create new main from exact multi-restaurant tip**

If target repository is empty, run:

```powershell
git switch -c main legacy/feat/restaurants-phase1
```

If target already has `main`, stop for explicit reconciliation; do not force or reset silently.

Expected: local `main` points to legacy multi-restaurant tip.

- [ ] **Step 4: Set new commit identity locally**

Run:

```powershell
git config user.name "marko1kiro"
git config user.email "marko1.kiro@gmail.com"
```

Expected: identity applies only to target clone.

- [ ] **Step 5: Push promoted main without force**

Run:

```powershell
git push -u origin main
```

Expected: target `main` created and tracks `origin/main`.

### Task 6: Preserve Useful Branches and Tags

**Files:**
- Git refs only

- [ ] **Step 1: List legacy branches**

Run:

```powershell
git branch -r --list "legacy/*"
```

Expected: legacy feature branches visible. Exclude symbolic `legacy/HEAD`.

- [ ] **Step 2: Push each legacy branch under the same name**

For each branch name returned, run equivalent non-force command:

```powershell
git push origin refs/remotes/legacy/<branch>:refs/heads/<branch>
```

Do not overwrite `main`; new `main` already points to multi-restaurant tip.

Expected: each useful branch created in target repository.

- [ ] **Step 3: Push all tags**

Run:

```powershell
git push origin --tags
```

Expected: all tags uploaded without force.

- [ ] **Step 4: Verify target refs and privacy**

Run:

```powershell
gh repo view marko1kiro/table-talker-global --json nameWithOwner,isPrivate,defaultBranchRef
git ls-remote --heads --tags origin
```

Expected: private repository; default branch `main`; branches/tags present.

- [ ] **Step 5: Remove temporary legacy remote**

Run:

```powershell
git remote remove legacy
git remote -v
```

Expected: only target `origin` remains.

### Task 7: Verify New Repository Main

**Files:**
- No files changed

- [ ] **Step 1: Install locked dependencies**

Run in target folder:

```powershell
npm ci
```

Expected: install exits 0 without modifying lockfile.

- [ ] **Step 2: Run clean-clone validation**

Run independently:

```powershell
npm test -- --run
npx tsc --noEmit
npm run build
```

Expected: all tests pass, typecheck exits 0, build exits 0.

- [ ] **Step 3: Verify clean working tree**

Run:

```powershell
git status --short
git log --oneline --decorate -5
```

Expected: no tracked or untracked changes; `HEAD` and `origin/main` match.

### Task 8: Create Git-Connected Vercel Project

**Files:**
- Create locally via Vercel linking: `.vercel/project.json` (ignored by Git)

- [ ] **Step 1: Import repository through Vercel dashboard**

In new Vercel account, import Git repository `marko1kiro/table-talker-global`, choose project name `table-talker-global`, and set production branch `main`.

Expected: Git integration enabled; project exists under new account.

- [ ] **Step 2: Link local target clone**

Run in target folder:

```powershell
npx vercel link --project table-talker-global
```

Expected: `.vercel/project.json` points to new project and new account scope.

- [ ] **Step 3: Verify project configuration**

Run:

```powershell
npx vercel project inspect table-talker-global
```

Expected: project name `table-talker-global`; framework Vite; root directory `.`; production branch configured as `main` in dashboard.

### Task 9: Transfer Environment Variables Safely

**Files:**
- Local temporary env files only; never commit

- [ ] **Step 1: Inventory required variable names from application source**

Verify these names exist in old project configuration:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPER_ADMIN_PASSWORD
RESTAURANT_CODE_ENCRYPTION_KEY
CF_ACCOUNT_ID
CF_R2_ACCESS_KEY_ID
CF_R2_SECRET_ACCESS_KEY
CF_R2_BUCKET
CF_R2_PUBLIC_URL
```

Also include any additional names returned by old project environment inventory. Do not print values.

- [ ] **Step 2: Rotate exposed Super Admin password before copying**

Generate a new strong password outside the repository, then set `SUPER_ADMIN_PASSWORD` in new project scopes. Do not reuse exposed `Marko123`.

- [ ] **Step 3: Add each variable to all required scopes**

Use Vercel dashboard or stdin-based CLI input for each variable in Production, Preview, and Development. Never place secret values directly in shell history.

Expected: environment inventory shows each required name in correct scopes.

- [ ] **Step 4: Confirm resource continuity**

Verify Supabase URL/project reference remains `ulimjedriuncqqphjxwv`, R2 bucket remains `soundboard`, and R2 public URL remains `https://static.xdirga.xyz`.

Expected: no new Supabase project or R2 bucket created.

### Task 10: Validate Git Auto-Deploy and Application Flow

**Files:**
- No application files changed

- [ ] **Step 1: Inspect deployment created from pushed main**

Run:

```powershell
npx vercel ls table-talker-global
```

Expected: Ready production deployment sourced from `marko1kiro/table-talker-global` branch `main`.

- [ ] **Step 2: Smoke-test crew flow**

Using deployment URL:

1. Enter restaurant code `CKRBUL`.
2. Enter unique crew name.
3. Confirm name form stays closed.
4. Confirm audio sync completes.
5. Confirm dashboard opens.

Expected: no session invalidation loop.

- [ ] **Step 3: Smoke-test current Super Admin flow**

1. Open `/super-admin`.
2. Authenticate with rotated password.
3. Confirm current pre-Phase-6 interface loads.
4. Confirm restaurant list and audio management data load from existing Supabase/R2 resources.

Expected: current panel works; Phase 6 redesign is not expected yet.

- [ ] **Step 4: Prove automatic deployment wiring**

Use next intentional Phase 6 commit or a dedicated documentation-only commit, push to `main`, and inspect Vercel deployment source. Do not create an empty commit.

Expected: push automatically creates new Vercel deployment without `npx vercel deploy`.

### Task 11: Final Safety Audit

**Files:**
- No files changed

- [ ] **Step 1: Verify old resources remain intact**

Check:

```text
C:\Users\dirga\Documents\table-talker
https://github.com/miracle1min/table-talker
old Vercel project table-talker
```

Expected: all remain available and unchanged.

- [ ] **Step 2: Verify target repository and deployment**

Run:

```powershell
git status --short
git remote -v
git branch -vv
gh repo view marko1kiro/table-talker-global --json nameWithOwner,isPrivate,defaultBranchRef
npx vercel whoami
npx vercel project inspect table-talker-global
```

Expected: clean target clone, only new origin, `main` tracking target repository, private GitHub repository, new Vercel identity and project.

- [ ] **Step 3: Record migration result without secrets**

Report target folder, GitHub repository, Vercel project/deployment URL, validation command results, and smoke-test results. Do not include environment values or credentials.
