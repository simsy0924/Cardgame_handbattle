# Firebase setup for Android

The game server verifies Firebase ID tokens for project `cardgame-1b151`. The Android app must use that same Firebase project unless the Worker configuration is changed too.

1. Open the Firebase Console and select project `cardgame-1b151`.
2. In **Project settings → General → Your apps**, add an Android app with package name `com.simsy.handbattle` if one is not already registered.
3. Add the app's SHA-1 signing fingerprint. For a local debug build, run `gradle :app:signingReport` from the project directory and copy the SHA-1 under the `debug` variant. Add the Play App Signing SHA-1 later if you publish through Google Play.
4. In **Authentication → Sign-in method**, enable **Google** and select a project support email.
5. Download the Android `google-services.json` again after configuring Google sign-in and place it at `app/google-services.json`.
6. Add that config file to the repository so GitHub Actions can build the Firebase-enabled APK. Firebase's Android config contains app identifiers and is distributed with the app; do not put Firebase ID tokens, service-account private keys, or OAuth client secrets in the Android app.

The Gradle build applies the Google Services plugin only when `app/google-services.json` exists, so tests and CI can still build before the Firebase Console steps are complete. Once the file is present, the app gets its Web client ID from the generated `default_web_client_id` resource and exchanges Google ID tokens for Firebase credentials.

The first successful Google login enables the app to call the deployed Worker. The **새 방 만들기** button should return a four-digit invitation code; a second signed-in account can enter it and select **방 참가**. The seat token stays in app memory and is not shown on screen.
