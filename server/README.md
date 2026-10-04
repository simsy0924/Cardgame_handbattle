# Hand Battle room server

The game server runs on Cloudflare Workers Free. Each four-digit room code maps to one SQLite-backed Durable Object, which serializes room changes and sends viewer-specific snapshots over WebSockets. Firebase Authentication remains the identity provider; the Worker verifies Firebase ID token signatures and claims using Google's published public certificates. No Firebase service-account key is required.

## Implemented API

Every route except `GET /health` requires `Authorization: Bearer <Firebase ID token>`.

| Request | Purpose |
| --- | --- |
| `POST /v1/rooms` with `{}` or `{"displayName":"..."}` | Create a room; response includes the four-digit `roomCode`, seat number, and one-time `seatToken`. |
| `POST /v1/rooms/{code}/join` | Join the open second seat; response includes its `seatToken`. |
| `POST /v1/rooms/{code}/reconnect` with `X-Seat-Token` | Restore the same player's seat after disconnecting. |
| `GET /v1/rooms/{code}/state` with `X-Seat-Token` | Read the caller's room snapshot. |
| `POST /v1/rooms/{code}/ready` with `X-Seat-Token` and `{"ready":true,"deck":{"main":[...],"key":[...]}}` | Validate and save the caller's deck for this room, then change ready state. |
| `POST /v1/rooms/{code}/leave` with `X-Seat-Token` | Leave the room and release the caller's seat. |
| `POST /v1/rooms/{code}/action` with `X-Seat-Token` and a game action | Submit a turn, summon, effect, attack, or pending player choice. |
| `GET /v1/rooms/{code}/stream` with `X-Seat-Token` and WebSocket upgrade | Receive lobby and sanitized game snapshots. WebSocket commands support `ping` and pre-match `ready`. |

Seat tokens are random, room-scoped credentials. The server stores only their SHA-256 hashes. The Android app stores its seat token in app-private storage and sends it only over HTTPS/WSS. A room expires after 24 hours without an authenticated room action.

When both players are ready, the Durable Object starts a match from their separately submitted deck lists and becomes the sole owner of its state. It uses the uploaded JSON card definitions and JavaScript effect engine in `src/cards/` and `src/engine.mjs`. The Android client submits actions and choices; private hands, deck lists, and unresolved choice details are filtered from room snapshots.

## Starter match rules

- The editor's default list has 54 main cards: three copies of every main-deck card in the Penguin and generic card files. It selects every available key card once.
- Players can edit one saved deck on their device. The server requires 40–60 main cards, no more than four copies of a main card, and no more than one copy of a key card. There is no total key-deck size limit.
- First player is chosen randomly. The first player starts with six cards; the second starts with seven and draws at the start of their first turn.
- A player may normally summon one main-deck monster per turn. Key summons and card-effect summons follow the uploaded engine rules.
- The game ends when a player's hand reaches zero cards. The current engine resolves card choices and response windows through server-saved pending actions.

## Test

This directory has no third-party runtime or test dependencies:

```bash
npm test
```

The GitHub Actions workflow runs these tests on server changes.

## Run and deploy

Install Wrangler for local development and deployment:

```bash
npx wrangler@latest dev
```

Before the first deployment, sign in to the Cloudflare account that will host the Worker, confirm that it is on the Free plan, then deploy:

```bash
npx wrangler@latest login
npx wrangler@latest whoami
npx wrangler@latest deploy
```

The project ID is configured as `cardgame-1b151` in `wrangler.jsonc`. Change that value only if the Firebase Authentication app uses another Firebase project. No paid plan, Cloud Functions, or service-account secret is needed for the room server. Cloudflare Free quotas are hard limits; the service may stop accepting requests after the account reaches a limit.

The Android app has Google sign-in, room create/join, the deck editor, a ready lobby, and an online duel screen wired to the deployed Worker URL. Finish Firebase Console setup and add `app/google-services.json` as described in [`../docs/FIREBASE_SETUP.md`](../docs/FIREBASE_SETUP.md).
