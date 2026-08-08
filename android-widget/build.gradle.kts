plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}

// The repo lives inside a OneDrive folder on the dev machine, and OneDrive
// keeps handles open on files it is syncing. Gradle then cannot delete its own
// output and every build after the first fails with
//   "Unable to delete directory ... app/build/tmp/kotlin-classes/debug"
// It would also cheerfully sync tens of thousands of build artefacts to the
// cloud, forever.
//
// So the build directory moves out of the synced tree — but LOCALLY ONLY. CI
// must keep the default layout: the workflow publishes the APK by path
// (app/build/outputs/apk/debug/app-debug.apk), and redirecting it there would
// produce a green build that releases nothing.
if (System.getenv("CI") == null) {
    val outside = File(System.getProperty("java.io.tmpdir"), "stsd-widget-build")
    subprojects {
        layout.buildDirectory.set(File(outside, name))
    }
}
