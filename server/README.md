# Hand Battle room server

The room server runs on Cloudflare Workers Free. Each four-digit room code maps to one SQLite-backed Durable Object, which serializes room changes and sends sanitized lobby snapshots over WebSockets. Firebase Authentication remains the identity provider; the Worker verifies Firebase ID token signatures and claims using Google's published public certificates. No Firebase service-account key is required.

## Implemented API

Every route except `GET /health` requires `Authorization: Bearer <Firebase ID token>`.

| Request | Purpose |
| --- | --- |
| `POST /v1/rooms` with `{}` or `{"displayName":"..."}` | Create a room; response includes the four-digit `roomCode`, seat number, and one-time `seatToken`. |
| `POST /v1/rooms/{code}/join` | Join the open second seat; response includes its `seatToken`. |
| `POST /v1/rooms/{code}/reconnect` with `X-Seat-Token` | Restore the same player's seat after disconnecting. |
| `GET /v1/rooms/{code}/state` with `X-Seat-Token` | Read the caller's room snapshot. |
| `POST /v1/rooms/{code}/ready` with `X-Seat-Token` and `{"ready":true}` | Change the caller's ready state. |
| `POST /v1/rooms/{code}/leave` with `X-Seat-Token` | Leave the room and release the caller's seat. |
| `GET /v1/rooms/{code}/stream` with `X-Seat-Token` and WebSocket upgrade | Receive lobby snapshots. WebSocket commands currently support `ping` and `ready`. |

Seat tokens are random, room-scoped credentials. The server stores only their SHA-256 hashes. The Android app stores its seat token in app-private storage and sends it only over HTTPS/WSS. A room expires after 24 hours without an authenticated room action.

The service implements room creation, joining, leaving, reconnection, ready state, and live lobby snapshots. It does not start a match or accept card-game actions.

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

The Android app now has Google sign-in and room create/join requests wired to the deployed Worker URL. Finish Firebase Console setup and add `app/google-services.json` as described in [`../docs/FIREBASE_SETUP.md`](../docs/FIREBASE_SETUP.md). Card-game match actions are not implemented yet.
