plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// Firebase config is supplied by the project owner after registering the Android app.
// Keeping this conditional lets the source build in CI before that file is added.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

val ciSigningStorePath = System.getenv("ANDROID_KEYSTORE_PATH")?.takeIf { it.isNotBlank() }
val ciSigningStorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
val ciSigningKeyAlias = System.getenv("ANDROID_KEY_ALIAS")
val ciSigningKeyPassword = System.getenv("ANDROID_KEY_PASSWORD")

android {
    if (ciSigningStorePath != null) {
        signingConfigs {
            create("ci") {
                storeFile = file(ciSigningStorePath)
                storePassword = ciSigningStorePassword
                    ?: throw GradleException("ANDROID_KEYSTORE_PASSWORD is required when CI signing is enabled.")
                keyAlias = ciSigningKeyAlias
                    ?: throw GradleException("ANDROID_KEY_ALIAS is required when CI signing is enabled.")
                keyPassword = ciSigningKeyPassword
                    ?: throw GradleException("ANDROID_KEY_PASSWORD is required when CI signing is enabled.")
            }
        }
    }

    buildTypes {
        getByName("debug") {
            if (ciSigningStorePath != null) {
                signingConfig = signingConfigs.getByName("ci")
            }
        }
    }

    namespace = "com.simsy.handbattle"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.simsy.handbattle"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "ROOM_SERVER_URL", "\"https://handbattle-game-server.simsy0924.workers.dev\"")
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"cardgame-1b151\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services.auth)
    implementation(libs.googleid)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.okhttp)
    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
}
