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
| `GET /v1/rooms/{code}/stream` with `X-Seat-Token` and WebSocket upgrade | Receive lobby snapshots. WebSocket commands currently support `ping` and `ready`. |

Seat tokens are random, room-scoped credentials. The server stores only their SHA-256 hashes. Keep the returned token in the Android app's private storage and send it only over HTTPS/WSS. A room expires after 24 hours without an authenticated room action.

The service currently implements room creation, joining, reconnection, ready state, and live lobby snapshots. It does not yet start a match or accept card-game actions; those must be added after the game state and action rules are finalized.

## Test

This directory has no third-party runtime or test dependencies:

```bash
npm test
```

The GitHub Actions workflow runs these tests on server changes.

## Run and deploy

For local development:

```bash
npx wrangler@latest dev
```

GitHub Actions deployment is defined in [worker-deploy.yml](../.github/workflows/worker-deploy.yml). Before enabling it:

1. In Cloudflare, create an API token with the **Edit Cloudflare Workers** policy and restrict it to the account that will host this Worker.
2. In the repository's **Settings → Secrets and variables → Actions**, add these repository secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. Add the repository variable `CLOUDFLARE_FREE_PLAN_CONFIRMED` with the value `true` only after confirming the Cloudflare account is on the Free plan.

Keep the API token in GitHub Secrets; never commit it or paste it into a chat. The workflow deploys only when the confirmation variable is exactly `true`, after tests pass. It runs for server changes pushed to `main` or `rewrite/android-native-start`. If the variable was unset when this workflow was added, the initial run is skipped; after setting the secrets and variable, push a change under `server/` to start the first deployment.

The project ID is configured as `cardgame-1b151` in `wrangler.jsonc`. Change that value only if the Firebase Authentication app uses another Firebase project. No paid plan, Firebase Cloud Functions, or service-account secret is needed for the room server. Cloudflare Free quotas are hard limits; the service may stop accepting requests after the account reaches a limit.

The Android lobby remains disabled until Firebase Google sign-in is configured in the Android app and the deployed Worker URL is added to its build configuration.
