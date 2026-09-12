# P1-4 Stale Identity Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove stale manager browser identity on definitive handoff failures and route unresolved handoffs safely back to login recovery.

**Architecture:** Handoff core owns post-write definitive identity removal through injected storage dependency. Login route owns paired pending-record retirement and non-manager role stale cleanup. Manager route detects unresolved pending recovery, removes usable identity, and redirects to login for exact-pair resume.

**Tech Stack:** React, TanStack Router, TypeScript, Vitest, jsdom.

---

### Task 1: Core definitive cleanup

**Files:**
- Modify: `src/lib/manager-login-handoff.ts:19-135`
- Modify: `tests/manager-handoff-round7.test.ts`

- [ ] **Step 1: Write failing core tests**

Add storage probe and assertions for post-write navigation rejection, authoritative `failed`, successful `pending` cleanup, `unknown`, and cleanup throw. Assert definitive results remove identity exactly once; unresolved results do not remove it.

```ts
const removed: string[] = [];
const result = await managerLoginHandoffCore(identity, deps({
  navigate: async () => { throw new Error("navigation failed"); },
  removeIdentity: () => removed.push("identity"),
}));
expect(result).toEqual({ ok: false, reason: "handoff_failed" });
expect(removed).toEqual(["identity"]);
```

- [ ] **Step 2: Run focused core tests; expect failure**

Run: `npx vitest run tests/manager-handoff-round7.test.ts`

Expected: failure because `removeIdentity` does not exist and identity remains after definitive paths.

- [ ] **Step 3: Add minimum core cleanup**

Add required `removeIdentity` dependency. Split cleanup into result-producing operation, then remove identity only when cleanup returns `handoff_failed`. Remove identity on navigation rejection and reconciliation `failed`. Preserve identity on `cleanup_failed` and `reconciliation_unknown`.

```ts
const cleanup = async (): Promise<ManagerHandoffResult> => {
  try {
    await deps.cleanupPending(identity.managerToken, identity.rateLimitReservationId);
    deps.removeIdentity();
    return { ok: false, reason: "handoff_failed" };
  } catch {
    return { ok: false, reason: "cleanup_failed" };
  }
};
```

- [ ] **Step 4: Run focused core tests; expect pass**

Run: `npx vitest run tests/manager-handoff-round7.test.ts`

Expected: PASS.

### Task 2: Login and manager-route recovery

**Files:**
- Modify: `src/routes/manager/login.tsx:51-166`
- Modify: `src/routes/manager/index.tsx:76-106`
- Modify: `tests/point-2-manager-login-route.test.tsx`

- [ ] **Step 1: Write failing route tests**

Add real jsdom route tests asserting both storage keys disappear after navigation failure, authoritative failure, and successful cleanup; both remain on unknown/cleanup failure. Add test where `/manager` mounts with pending record plus identity, removes identity, and redirects `/manager/login`. Add AM/SA outcome tests that clear old manager identity.

```ts
expect(sessionStorage.getItem("table-talker.manager-identity")).toBeNull();
expect(sessionStorage.getItem("table-talker.manager-pending-handoff")).toBeNull();
```

- [ ] **Step 2: Run focused route tests; expect failure**

Run: `npx vitest run tests/point-2-manager-login-route.test.tsx`

Expected: failure because navigation failure leaves identity and `/manager` trusts it.

- [ ] **Step 3: Wire core and route storage policy**

Pass `removeIdentity: () => removeManagerIdentity(storage)` to core. Preserve current pending removal for successful and definitive results. In manager dashboard hydration effect, check `readPendingManagerHandoff`; if present, remove manager identity and redirect to `/manager/login` before reading identity. Keep unknown/cleanup-failed pair for login resume. Retain AM cleanup and add SA path cleanup only where successful role result is known.

```ts
const pending = readPendingManagerHandoff(browserManagerStorage());
if (pending) {
  removeManagerIdentity(browserManagerStorage());
  void navigate({ to: "/manager/login" });
  return;
}
```

- [ ] **Step 4: Run focused route tests; expect pass**

Run: `npx vitest run tests/point-2-manager-login-route.test.tsx`

Expected: PASS.

### Task 3: Storage helper edge cases and ablation

**Files:**
- Modify: `tests/point-2-r12-p1-3-equality-and-persistence.test.ts`
- Modify: `tests/manager-session-identity.test.ts`
- Modify: `tests/point-2-manager-login-route.test.tsx`

- [ ] **Step 1: Add storage absence and partial-write tests**

Use `StorageLike` probes where `setItem` writes then throws, and absent storage. Assert no successful identity is accepted after partial identity write and definitive cleanup removes the identity key best-effort. Assert no token appears in result values or DOM.

- [ ] **Step 2: Run focused suites; expect failure**

Run: `npx vitest run tests/point-2-r12-p1-3-equality-and-persistence.test.ts tests/manager-session-identity.test.ts tests/point-2-manager-login-route.test.tsx`

Expected: failure until new cleanup wiring handles tested paths.

- [ ] **Step 3: Keep minimum helper behavior**

Only change helper code if failure exposes incorrect partial-write semantics. Do not add retry registry, timers, background confirm, migration, or new storage key.

- [ ] **Step 4: Run focused suites and ablation**

Run focused suites above; then temporarily remove each of (1) core definitive `removeIdentity` calls and (2) manager-route pending guard, rerun relevant focused tests, restore exact production code, and rerun. Expected: each ablation fails its new tests; restored code passes.

### Task 4: Full verification and blocker commit

**Files:**
- Modify only files proven necessary by Tasks 1-3.

- [ ] **Step 1: Audit changes**

Run `git diff --check`, `git diff --cached --check`, `git status --short`, and targeted searches for raw bearer leakage. Confirm no changed `supabase/migrations` files; therefore no grants/search-path/RLS changes.

- [ ] **Step 2: Run exact gate**

Run: `npm run verify`

Expected: exit 0.

- [ ] **Step 3: Commit one blocker**

```bash
git add src/lib/manager-login-handoff.ts src/routes/manager/login.tsx src/routes/manager/index.tsx tests
git commit -m "fix(auth): clear stale manager identity after definitive handoff failure"
```

- [ ] **Step 4: Push and confirm CI**

Push fast-forward to `origin/fix/point-2-blockers-r12`, fetch, confirm exact pushed SHA, then wait for GitHub `CI` `verify` success. Stop after green CI.
