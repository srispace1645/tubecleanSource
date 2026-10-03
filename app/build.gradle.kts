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
        versionCode = 2
        versionName = "1.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Sideloaded only. Updates must be signed with this same key, so back up ~/.android/debug.keystore.
            signingConfig = signingConfigs.getByName("debug")
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
