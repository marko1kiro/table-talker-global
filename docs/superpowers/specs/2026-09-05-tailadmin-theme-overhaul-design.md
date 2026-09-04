# TailAdmin Theme Overhaul — Design Spec (Phase 1)

Date: 2026-09-05
Status: Approved (pending user review of this written spec)
Branch: `feat/tailadmin-theme` (from `6fe1be5`)

## Goal

Adopt the TailAdmin design language (https://demo.tailadmin.com, MIT-licensed
template) as a **full UI/UX overhaul of the Manager dashboard and the Super
Admin console only** — their sidebar, top header, and dashboard layout — while
leaving every piece of function/logic/core-engine untouched.

## Hard constraint (non-negotiable)

**UI/UX only.** No changes to: Supabase RPCs/migrations, server functions,
TanStack Query wiring, the realtime occupancy hook, the notice queue, the
reminder computation, auth/session, routing data loaders, or any data shape.
New visual affordances (e.g. stat cards) MUST derive from data already fetched
in the component — never a new query or backend call.

## Decisions (locked with user)

1. **Full overhaul** following TailAdmin (not a light reskin): adopt TailAdmin's
   sidebar + top header + dashboard content layout for both dashboards.
2. **Adjustments are incremental** — this spec is Phase 1 (shell + tokens +
   core components + wiring). Charts, dark mode, and per-page polish are Phase 2+.
3. Title "DASHBOARD" in the Manager sidebar stays **RGB neon** (user's call).
4. Super Admin sidebar becomes **light** (was dark slate-950).
5. Super Admin accent **amber → brand-blue** everywhere.
6. **Crew stations (SS/kasir/satgas/clear_up) and the SS soundboard are OUT of
   scope** and must not change visually.

## Key architectural finding

`src/components/OwnerUi.tsx` and `src/components/CrewHeader.tsx` are **shared by
crew routes** (e.g. `src/routes/clear-up/index.tsx` imports `OwnerPage`,
`OwnerNotice`, `OwnerEmpty`, `OwnerRetry`, `CrewHeader`). Reskinning them in
place would drag crew along — violating constraint #6.

**Resolution:** introduce a NEW TailAdmin component set used ONLY by Manager +
Super Admin. `OwnerUi` and `CrewHeader` stay exactly as-is for crew. The two
dashboards migrate off them onto the new set.

## Design tokens (additive, scoped by usage)

Add to `src/styles.css` `@theme` block — **new names only**, do not touch the
existing brutal/shadcn tokens (crew + SS keep using those):

```css
--font-outfit: "Outfit", sans-serif;
--color-brand-50:#ecf3ff; --color-brand-100:#dde9ff; --color-brand-200:#c2d6ff;
--color-brand-300:#9cb9ff; --color-brand-400:#7592ff; --color-brand-500:#465fff;
--color-brand-600:#3641f5; --color-brand-700:#2a31d8;
--color-ta-gray-25:#fcfcfd; --color-ta-gray-50:#f9fafb; --color-ta-gray-100:#f2f4f7;
--color-ta-gray-200:#e4e7ec; --color-ta-gray-300:#d0d5dd; --color-ta-gray-400:#98a2b3;
--color-ta-gray-500:#667085; --color-ta-gray-600:#475467; --color-ta-gray-700:#344054;
--color-ta-gray-800:#1d2939; --color-ta-gray-900:#101828;
--color-ta-success:#12b76a; --color-ta-error:#f04438; --color-ta-warning:#f79009;
--shadow-theme-xs:0 1px 2px rgba(16,24,40,.05);
--shadow-theme-sm:0 1px 3px rgba(16,24,40,.1),0 1px 2px rgba(16,24,40,.06);
--shadow-theme-md:0 4px 8px -2px rgba(16,24,40,.1),0 2px 4px -2px rgba(16,24,40,.06);
```

- Gray tokens are namespaced `ta-gray-*` to avoid colliding with Tailwind's
  built-in `gray-*` used by crew/OwnerUi.
- Load Outfit via `@import url("https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap")`
  at the top of `styles.css`; apply `font-outfit` ONLY on the two dashboards'
  root wrappers (crew/SS keep Space Grotesk).
- These utilities are only *used* inside the new components, so registering them
  globally changes nothing for crew/SS.

## New components (`src/components/dashboard/`)

### `AppShell.tsx` — the shared TailAdmin shell
Props (presentation-only; callers keep their own state/logic):
```ts
type NavItem = { id: string; label: string; icon: LucideIcon; active: boolean; onSelect: () => void };
AppShell({
  brand,            // ReactNode: logo + title (Manager passes the RGB "DASHBOARD")
  navItems,         // sidebar menu
  headerTitle,      // string shown in the top bar
  headerRight,      // ReactNode (avatar/logout/etc.)
  notice,           // OccupancyNotice|null -> TailAdmin banner under header (Manager only)
  footer,           // ReactNode pinned bottom of sidebar (Manager branding)
  children,         // page content
})
```
- Sidebar: white, `w-64`, collapsible on desktop, off-canvas drawer on mobile
  (reuse the existing mobile-drawer pattern). Nav item = TailAdmin `menu-item`
  (`rounded-lg px-3 py-2 text-sm font-medium`, active `bg-brand-50 text-brand-500`,
  inactive `text-ta-gray-700 hover:bg-ta-gray-100`).
- Top header: sticky, white, `border-b border-ta-gray-200`, `headerTitle` left,
  `headerRight` right. When `notice` is present, render a slim banner row below
  it (the live occupancy toast; data still comes from `useNoticeQueue`).
- Content: `bg-ta-gray-50 min-h-screen`, padded, `font-outfit`.

### TailAdmin primitives (`src/components/dashboard/ui.tsx`)
Mirror the OwnerUi API so Super Admin page migration is mostly an import swap:
- `TaCard` (white, `border-ta-gray-200`, `shadow-theme-sm`, `rounded-xl`)
- `TaPageHeader` (title + description + action)
- `TaStatCard` (label, value, delta, icon) — Phase 1 uses it for derived counts
- `TaTable` / `TaTh` / `TaTd` (header `bg-ta-gray-50 text-ta-gray-400 uppercase`,
  row `border-ta-gray-200`, `hover:bg-ta-gray-50`)
- `TaButton` (primary `bg-brand-500 hover:bg-brand-600 text-white`, secondary,
  danger `bg-ta-error`)
- `TaBadge` (success/error/warning/info/neutral via ta-* tokens)
- `TaNotice` (replaces OwnerNotice tones with TailAdmin alert styling)
- `TaEmpty`, `TaRetry`, `TaLoading`, `TaPagination` (TailAdmin-styled equivalents)

## Integration — Manager dashboard

- Rewrite `src/components/ManagerLayout.tsx` to render `<AppShell>` (nav = the 3
  menus; brand = RGB "DASHBOARD"; footer = branding; `notice` = live toast).
- `src/routes/manager/index.tsx`: keep ALL logic (identity guard, snapshot/crew
  queries, realtime hook + `bind_manager_session_realtime`, reminder ticks,
  `activeStation` tabs, log accumulation). Swap the presentational wrappers:
  `CrewHeader` -> AppShell header+notice; `OwnerNotice/OwnerEmpty/OwnerRetry` ->
  `Ta*`; table/crew/log sections wrapped in `TaCard`. Add a `TaStatCard` row
  (Terisi / Kosong / Perlu Dicek >2 jam) computed from the existing `tables` +
  `reminders` arrays.
- Mobile: AppShell keeps the responsive drawer + the mobile table/crew-tab
  layouts already built; restyle to TailAdmin tokens.

## Integration — Super Admin console

- Rewrite `src/routes/super-admin/route.tsx` shell to `<AppShell>`: light sidebar
  (brand-blue active), nav items = the existing 7 routes, header with logout.
- Migrate super-admin pages (`index`, `restaurants/index`, `restaurants/$id`,
  `audio`, `history`, `error-log`, `esb-export`, `managers`) from `OwnerUi`
  imports to `dashboard/ui` (`Ta*`). Component APIs match, so this is an import +
  name swap; **no data/logic changes**.
- Replace amber accents with brand-blue throughout these pages.

## Preserved (must not change)

- `OwnerUi.tsx`, `CrewHeader.tsx`, `Header.tsx` (SS), all crew routes, the
  neo-brutalism tokens, and every server fn / RPC / migration / hook.

## Testing (TDD, UI-only)

- `tailadmin-tokens.test.ts`: `styles.css` defines the brand/ta-gray/shadow
  tokens + Outfit import; existing brutal tokens still present.
- `app-shell.test.ts` (source contract): AppShell renders sidebar nav, sticky
  header, notice banner slot, mobile drawer classes.
- `manager-shell.test.ts`: `ManagerLayout` uses `AppShell`; `manager/index.tsx`
  still references `useTableOccupancyRealtime`, `bind_manager_session_realtime`,
  `buildStaleReminders`, `activeStation` (logic intact) and now `TaCard`/`TaStatCard`.
- `super-admin-shell.test.ts`: `route.tsx` uses `AppShell`; pages import from
  `dashboard/ui` (no `OwnerUi` in super-admin routes); brand-blue present, amber
  absent in super-admin routes.
- Update existing `manager-layout.test.ts` / `manager-dashboard-route.test.ts` /
  `crew-header-notice.test.ts` to the new shell contract where they asserted old
  classes; **crew tests must stay green** (crew untouched).
- Full `npm run verify` exit 0 before any commit (repo AGENTS.md gate).

## Out of scope (Phase 2+)

- Charts (use the already-installed `recharts`), dark mode, per-page widget
  polish, TailAdmin's exact stat-card data (we only show derived counts), and
  any change to crew/SS theming.

## Risks / rollback

- Largest risk is over-reaching into logic; mitigated by the hard UI-only
  constraint + keeping component APIs identical during migration.
- Everything lives on `feat/tailadmin-theme`; `main`/production untouched until
  the user approves a merge. Rollback = abandon branch, or `git revert` the
  isolated per-area commits.
