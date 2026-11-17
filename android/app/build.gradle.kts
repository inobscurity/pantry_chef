plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.pantrychef.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.pantrychef.app"
        minSdk = 26
        targetSdk = 35
        // Set by the GitHub build from its run number, so each new app installs over the last.
        versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
        versionName = "1.${System.getenv("VERSION_CODE") ?: "0"}"
    }

    signingConfigs {
        // The same key for every build, so updates install over the previous version. It's kept
        // in the repository: this app is installed by hand, not published on the Play Store.
        create("pantrychef") {
            storeFile = file("pantrychef.keystore")
            storePassword = "pantrychef"
            keyAlias = "pantrychef"
            keyPassword = "pantrychef"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("pantrychef")
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
