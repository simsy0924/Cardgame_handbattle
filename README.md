# Hand Battle

Hand Battle is an Android online 1v1 card game. The old web client is not part of this codebase; card definitions and a server-side JavaScript effect engine now power online matches.

## Online game direction

- Private rooms use a four-digit invitation code.
- A player can reconnect to their seat after a temporary disconnect.
- The server owns the match state and validates every game action.
- The app sends action requests and observes sanitized room snapshots; it never writes match state directly.
- Firebase Authentication is used for Google sign-in; room and game data live on the game server.

## No-cost server direction

- **Identity:** keep the existing Firebase Authentication project on the no-cost plan for Google accounts.
- **Game server:** Cloudflare Workers Free with SQLite-backed Durable Objects. A room is handled by one durable object, which serializes player actions and stores the authoritative state.
- **Transport:** HTTPS for room create/join/reconnect and a WebSocket for live room updates.
- **Security:** the Worker verifies the Firebase ID token. Clients send commands and receive filtered snapshots; they never write canonical game state.
- **Billing:** no Firebase Cloud Functions, Firebase Realtime Database, or paid Cloudflare plan for the MVP. Cloudflare Free has hard quotas; when a quota is reached, requests fail until it resets instead of automatically becoming paid usage.

The server in [`server/`](server/) handles room creation, joining, leaving, seat-token reconnection, match state, card effects, and filtered WebSocket snapshots. When both players are ready, the Worker starts a duel. The Android app includes the live lobby and duel screen. The Worker is deployed at `https://handbattle-game-server.simsy0924.workers.dev`. Finish the Firebase Console setup in [`Firebase setup`](docs/FIREBASE_SETUP.md) and add the Android config file before testing sign-in.

## Game rules currently recorded

- Main deck: 40–60 cards, up to 4 copies of one card.
- Opening hand: first player 6 cards, second player 7 cards.
- The second player draws at the start of their first turn.
- Win by reducing the opponent's hand to zero cards.
- Display text is kept separate from executable effect data.
- Each player can edit and save a deck on their device. The main deck must contain 40–60 cards with up to four copies of a card; the key-card deck allows one copy of each selected key card.
- The editor starts with the former 54-card starter list and all available key cards selected. Both players bring their own saved lists into a match.
- The editor displays the supplied Korean card text separately from executable effect data.

## Build

JDK 17, Android SDK API 37, Android Gradle Plugin 9.4.0, and Gradle 9.6.0 are used. Open the project in Android Studio or run:

```bash
gradle :app:testDebugUnitTest
gradle :app:assembleDebug
```

GitHub Actions runs unit tests and builds a debug APK on pushes and pull requests.

## Firebase Android setup

The app uses Firebase project `cardgame-1b151`, which must match the project ID configured on the Worker. Follow [`docs/FIREBASE_SETUP.md`](docs/FIREBASE_SETUP.md) to register `com.simsy.handbattle`, enable Google sign-in, add the signing certificate SHA-1, and place `google-services.json` in `app/`.

## Source layout

```text
app/src/main/java/com/simsy/handbattle/
  MainActivity.kt
  DuelScreen.kt
  game/CardRules.kt
  online/RoomApi.kt
  online/RoomCode.kt
server/
  src/index.js
  src/room.js
  src/duel.js
  src/engine.mjs
  src/cards/
  src/firebase-auth.js
  test/
```
