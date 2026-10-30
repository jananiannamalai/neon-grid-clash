# Neon Grid Clash

A browser based 2–4 player turn-taking game. Supabase Anonymous Auth gives each browser a persistent player identity; Postgres functions hold and validate the match state; Supabase Realtime sends committed board updates to the room.

## Rules

- One player creates a room and shares its six-character code or invite link.
- The host starts the game once at least two players have joined. Up to four players can join before the host starts the round.
- Players take turns claiming one open tile. A normal tile scores 1; a marked neon bonus tile scores 3. Bonus tiles are fixed at positions 3, 7, 9, 13, 17, 19, and 23 (counting left to right, top to bottom from 1).
- The round ends after three minutes or when all 25 tiles are claimed. Highest score wins; a tie shares the win.
- The database clock and a row lock serialize all moves. Calls from the wrong player, claims to occupied tiles, late moves, and invalid tile indices are rejected on the server.

## Supabase setup (about 10 minutes)

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard). Choose a nearby region.
2. In **Authentication → Sign In / Providers**, enable **Anonymous Sign-Ins**. No account information or service-role key is needed in the browser.
3. In **SQL Editor**, run the full [`supabase/schema.sql`](supabase/schema.sql) file.
4. In **Project Settings → API**, copy the **Project URL** and the **publishable key** (or legacy `anon` key). These are intended for browser use. Never use or share the `service_role` / secret key.
5. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to those two values.
6. Start locally with `npm install`, then `npm run dev`. Visit the local URL shown by Vite.

The match table has row level security. Players can read only rooms whose player list contains their authenticated anonymous identity; direct client writes are revoked. Only the exposed, authenticated RPC functions can create/join rooms or make a move.

## Build and deploy

`npm run build` creates the static site in `outputs/site/`. Deploy that folder to any static host (for example, Vercel or Netlify) and configure the same two `VITE_` variables as build environment variables. The Supabase project remains the real-time backend. Add the public site origin to Supabase Auth's allowed redirect URLs if you later add OAuth; anonymous sign-in does not require it.

## Tests

Run `npm test` for local game utility tests and `npm run build` to validate the browser bundle. Cross-device internet play requires a configured Supabase project, applied schema, and deployed frontend; local unit tests alone do not verify those hosted services.
