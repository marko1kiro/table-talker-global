-- Poin 3 hard cutover: drop the account-less crew claim path and revoke all
-- pre-cutover role sessions so every device must re-register via CrewLoginFlow.
--
-- claim_role_session's LIVE signature after 20260902020000 (which added p_pin)
-- and the 20260907180000 rate-limit fix is (uuid, text, text, text, timestamptz,
-- text). The original 5-arg (uuid, text, text, text, timestamptz) overload was
-- already DROPped in 20260902020000, so only the 6-arg form survives into this
-- migration; it is dropped below by that exact arity. No other DB object depends
-- on it: grep over every later migration finds claim_role_session only in
-- comments, and no function body / view performs or selects it (the occupancy
-- RPCs trust role_session_tokens rows directly, never the claim RPC). Dropping
-- the function therefore cannot orphan a caller. The FK from
-- role_session_tokens.role_session_id -> crew_role_sessions is ON DELETE CASCADE
-- and this migration only DELETES token rows (never drops the table), so
-- crew_role_sessions history stays fully queryable for the manager roster.
drop function if exists public.claim_role_session(uuid, text, text, text, timestamptz, text);

-- Revoke every live role session (force-logout of the legacy name+PIN crews):
-- the new account flow re-mints its own tokens via crew_shift_claim, and the old
-- anonymous-claimed ones have no auth_uid lineage to be revalidated against.
-- NOTE: this also clears any Poin-3 role_session_tokens, but at cutover time
-- crew_accounts is empty (nobody has paired yet), so no Poin-3 session exists to
-- lose -- the table is empty in practice. Kept unconditional so a replay against
-- a partially-populated dev DB is still a clean, idempotent full revoke.
delete from public.role_session_tokens;
