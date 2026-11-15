import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.srinath.tubeclean"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.srinath.tubeclean"
        minSdk = 22 // Fire OS 5 (Android 5.1), e.g. the 2015 Fire TV box and 2nd-gen Fire TV Stick
        targetSdk = 35
        versionCode = 4
        versionName = "1.3"
    }

    signingConfigs {
        // TubeClean's own key, kept outside the repo: the Android debug key that signed 1.0 (SHA-256
        // 5C:CF:A4:61…). Sideloaded updates only install over it, so back the file up. Unlike
        // ~/.android/debug.keystore, a missing file stops the build instead of quietly making a new key.
        create("tubeclean") {
            storeFile = file("${System.getProperty("user.home")}/.android/tubeclean.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("tubeclean")
        }
        release {
            isMinifyEnabled = false // sideloaded only
            signingConfig = signingConfigs.getByName("tubeclean")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")

    testImplementation("junit:junit:4.13.2")
    // Android's org.json is a stub in local unit tests; this is the real implementation.
    testImplementation("org.json:json:20240303")
}
