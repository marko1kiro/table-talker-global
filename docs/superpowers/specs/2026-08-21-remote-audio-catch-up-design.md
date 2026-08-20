# Remote Audio Catch-up Design

## Problem

Remote audio command reaches `remote_commands`, while target crew is connected, visible, and audio-ready, but no acknowledgement occurs. Direct transport test proves Supabase Realtime works. Current crew hook processes only live `INSERT` events, so any event missed during subscription or reconnect is permanently lost.

## Design

Add authenticated RPC `claim_pending_remote_command()` returning newest command for `auth.uid()` where `status = 'sent'` and `expires_at > now()`. Function exposes no cross-user data and requires authenticated role.

After remote command channel reports `SUBSCRIBED`, crew hook calls RPC once and passes returned command to existing `createRemoteCommandProcessor`. Live event and catch-up query can race safely because existing processed-ID and newest-command state deduplicates both paths.

No polling, retry loop, TTL change, catalog change, or playback change. Existing five-second expiry remains authoritative.

## Error Handling

Catch-up failure marks delivery uncertain but does not tear down healthy Realtime subscription. Empty result is normal. Playback and acknowledgement continue through existing paths.

## Testing

- Migration test requires authenticated-only RPC and own-user pending-command filter.
- Hook source/integration test requires catch-up call after subscription.
- Existing processor tests verify dedupe for duplicate live/query delivery.
- Full tests and TypeScript must pass before migration and deployment.
