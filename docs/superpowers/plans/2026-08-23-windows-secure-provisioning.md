# Windows Secure Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision restaurant codes securely on Windows through protected stdin or validated temporary/home code files.

**Architecture:** Keep provisioning code material in process memory. `--code-stdin` accepts piped input only and removes one terminal newline. File input retains Unix mode checks; Windows requires an approved temp/home path and rejects broad read/write ACL entries from native `icacls` output.

**Tech Stack:** Node.js ESM, native `node:fs`, `node:os`, `node:path`, `node:child_process`, `icacls`, Vitest.

---

### Task 1: Lock Secure Input Contract

**Files:**
- Modify: `tests/restaurant-code-provisioning.test.ts`

- [ ] **Step 1: Write failing tests**

Add source-contract assertions for `--code-stdin`, `process.stdin.isTTY`, removal of one terminal newline, Windows `icacls` validation, and retained Unix mode validation.

- [ ] **Step 2: Run focused test to verify failure**

Run: `npm test -- tests/restaurant-code-provisioning.test.ts`

Expected: FAIL because secure stdin and Windows ACL handling are absent.

### Task 2: Add Portable Secure Input Handling

**Files:**
- Modify: `scripts/provision-restaurant-code.mjs`
- Modify: `README.md`

- [ ] **Step 1: Implement minimal secure input path**

Add `--code-stdin` mode that rejects TTY stdin, reads raw stdin without output, and strips exactly one trailing `\n` or `\r\n`. Preserve UUID validation. On Unix, retain `0600`-style mode rejection. On Windows, resolve code-file paths only beneath `os.tmpdir()` or `os.homedir()`, run `icacls`, reject broad principals with read/write rights, and fail closed on inspection failure.

- [ ] **Step 2: Document operator commands**

Document a PowerShell pipeline using `Read-Host -AsSecureString`, `ConvertFrom-SecureString -AsPlainText`, and `--code-stdin`; include an `icacls` verification command for protected files. State no secret is printed.

- [ ] **Step 3: Run focused test to verify pass**

Run: `npm test -- tests/restaurant-code-provisioning.test.ts`

Expected: PASS.

### Task 3: Verify And Commit

**Files:**
- Modify: `tests/restaurant-code-provisioning.test.ts`
- Modify: `scripts/provision-restaurant-code.mjs`
- Modify: `README.md`

- [ ] **Step 1: Run full verification**

Run: `npm test; npx tsc --noEmit`

Expected: both commands exit 0.

- [ ] **Step 2: Inspect staged diff and commit**

Run:

```bash
git add scripts/provision-restaurant-code.mjs tests/restaurant-code-provisioning.test.ts README.md docs/superpowers/plans/2026-08-23-windows-secure-provisioning.md
```

Expected: only secure provisioning files are committed.
