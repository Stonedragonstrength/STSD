plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.stonedragon.schedule"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.stonedragon.schedule"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1"

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
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
