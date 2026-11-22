<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

<!-- AGENT-MEMORY:BEGIN -->
- Accounts use username-only login mapped to a synthetic email (see src/lib/db.ts usernameToEmail); never change a username after signup or login breaks.
- Calls are WebRTC mesh signaled over a Realtime broadcast channel per conversation; one call type, camera/screen toggled via replaceTrack so no renegotiation is needed.
- Replace remote stream identity when negotiated tracks arrive so mounted call tiles bind audio even when signaling finishes after their first render.
- Media lives in the private `media` bucket (public buckets are blocked); always render via signed URLs.
- Admin access: has_role in user_roles; code check and first-admin bootstrap happen server-side in claim_admin RPC.
- Admin password resets use authenticated server functions with a has_role check before loading the privileged client; clients never receive admin credentials.
- Presence uses authenticated heartbeat timestamps; browser-specific theme and sound preferences stay local, while image positioning is baked into uploaded crops for consistent display everywhere.
- Admin call voice effects use RLS-protected recipient events rather than trusting Realtime broadcast payloads for admin privileges.
<!-- AGENT-MEMORY:END -->
