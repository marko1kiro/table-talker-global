# Remote Audio Catch-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover unexpired remote-audio commands missed during Realtime subscription or reconnect.

**Architecture:** Add authenticated security-definer RPC returning newest pending command owned by `auth.uid()`. After channel reaches `SUBSCRIBED`, hook calls RPC once and sends result through existing command processor, whose shared state deduplicates query/event races.

**Tech Stack:** PostgreSQL/Supabase RPC and RLS, React hook, TypeScript, Vitest.

---

### Task 1: Pending-command RPC

**Files:**
- Create: `supabase/migrations/20260821010000_remote_audio_catch_up.sql`
- Modify: `tests/remote-audio-migration.test.ts`

- [ ] **Step 1: Write failing migration assertions**

Add assertions requiring `claim_pending_remote_command()`, `auth.uid()` ownership, `status = 'sent'`, future expiry, newest-first ordering, single-row limit, authenticated execute grant, and revoked public/anon access.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/remote-audio-migration.test.ts`
Expected: FAIL because migration does not exist or required SQL is absent.

- [ ] **Step 3: Add minimal migration**

```sql
create or replace function public.claim_pending_remote_command()
returns public.remote_commands
language sql
stable
security definer
set search_path = public
as $$
  select command
  from public.remote_commands command
  where command.target_session_id = auth.uid()
    and command.status = 'sent'
    and command.expires_at > now()
  order by command.created_at desc, command.id desc
  limit 1;
$$;

revoke all on function public.claim_pending_remote_command() from public, anon;
grant execute on function public.claim_pending_remote_command() to authenticated;
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/remote-audio-migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/remote-audio-migration.test.ts supabase/migrations/20260821010000_remote_audio_catch_up.sql
git commit -m "fix: add pending remote command catch-up RPC"
```

### Task 2: Hook catch-up delivery

**Files:**
- Modify: `src/hooks/use-remote-crew.ts:422-475`
- Modify: `tests/remote-audio-hook.test.ts`

- [ ] **Step 1: Write failing hook assertion**

Require subscription activation to call `claim_pending_remote_command` and pass non-null row through `processor.process(toRemoteCommand(...))`.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/remote-audio-hook.test.ts`
Expected: FAIL because hook never calls catch-up RPC.

- [ ] **Step 3: Add minimal catch-up helper inside claim flow**

After processor creation, define:

```ts
const catchUp = async () => {
  const { data, error } = await client.rpc("claim_pending_remote_command");
  if (error) {
    update(setDeliveryUncertain, true);
    return;
  }
  if (data) await processor.process(toRemoteCommand(data as RemoteCommandRow));
};
```

Invoke `void catchUp()` inside `activatePresence` after setting connection state online and before/alongside heartbeat activation. Reuse same processor instance so live and catch-up delivery share dedupe state.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/remote-audio-hook.test.ts`
Expected: PASS.

- [ ] **Step 5: Run focused remote tests**

Run: `npm test -- tests/remote-audio-domain.test.ts tests/remote-audio-hook.test.ts tests/remote-audio-migration.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-remote-crew.ts tests/remote-audio-hook.test.ts
git commit -m "fix: catch up missed remote audio commands"
```

### Task 3: Verify and ship

**Files:**
- No code changes expected.

- [ ] **Step 1: Run full verification**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all tests pass, TypeScript emits no errors, build exits 0. Lint remains skipped per user instruction.

- [ ] **Step 2: Apply migration**

Run: `npx supabase db push`
Expected: `20260821010000_remote_audio_catch_up.sql` applied.

- [ ] **Step 3: Verify remote migration**

Run: `npx supabase migration list`
Expected: local and remote both list `20260821010000`.

- [ ] **Step 4: Push and deploy**

Run: `git push && npx vercel --prod --yes`
Expected: push succeeds and deployment reaches Ready.

- [ ] **Step 5: Production retest**

Keep HP page visible and audio-ready, send remote audio from Super Admin, then query newest `remote_commands`. Expected: command status becomes `played` with non-null `acknowledged_at`, or `failed` with bounded `failure_reason` identifying browser playback issue.
