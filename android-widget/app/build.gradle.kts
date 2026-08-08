plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.stonedragon.schedule"
    compileSdk = 34

    // A committed key, because CI runners generate a throwaway debug keystore on
    // every job and Android refuses an update whose signature does not match the
    // installed app — "update not installed", with no way past it but uninstall.
    // The password is in the clear on purpose: this is a debug key, no more
    // secret than the well-known one the Android SDK ships. It buys update
    // continuity, not security. Anyone holding it could build an APK Android
    // would accept as an update to this one, but they would still have to get it
    // onto the phone by hand — the same bar as any sideload. If this app ever
    // leaves one personal device, replace it with a real release key from a
    // GitHub secret.
    val signingKey = rootProject.file("signing/widget.jks")

    signingConfigs {
        getByName("debug") {
            if (signingKey.exists()) {
                storeFile = signingKey
                storePassword = "stonedragon"
                keyAlias = "widget"
                keyPassword = "stonedragon"
            }
        }
    }

    defaultConfig {
        applicationId = "com.stonedragon.schedule"
        minSdk = 26
        targetSdk = 34
        // Monotonic per CI build, so Android can tell newer from older and the
        // release page is not four APKs all claiming to be version 1.
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "0.1." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")

        // Public by design — the same pair the web app ships in config.js. RLS,
        // not secrecy, is what keeps one coach out of another's bookings.
        buildConfigField(
            "String",
            "SUPABASE_URL",
            "\"https://thhfslggjmtciavxrwwz.supabase.co\"",
        )
        buildConfigField(
            "String",
            "SUPABASE_ANON_KEY",
            "\"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoaGZzbGdnam10Y2lhdnhyd3d6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NzI2ODgsImV4cCI6MjA5ODM0ODY4OH0.PCD2RIwyn2lV4ZLGbg4z4zOe8_k8DXOeEEcLnjfSqFc\"",
        )
        buildConfigField(
            "String",
            "APP_URL",
            "\"https://stonedragonstrength.github.io/STSD/\"",
        )
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // Plain JVM unit tests. They exist for the things a screenshot cannot
    // check — hashes, arithmetic, colour maths — and they are deliberately
    // written to need no Android stubs and no Robolectric, so `gradle
    // testDebugUnitTest` stays a few seconds rather than a minute.
    testImplementation("junit:junit:4.13.2")

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
