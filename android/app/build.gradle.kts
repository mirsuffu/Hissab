plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.sufiyan.hisaab"
    compileSdk = 34

    defaultConfig {
        applicationId = "org.sufiyan.hisaab"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("debug") // Allows instant testing of release build
        }
        debug {
            applicationIdSuffix = ".debug"
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }

    sourceSets {
        getByName("main") {
            assets.srcDirs("src/main/assets")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    
    // High-performance WebView Asset Loader for offline zero-latency web apps
    implementation("androidx.webkit:webkit:1.10.0")
    
    // Native Android OS BiometricPrompt (direct hardware fingerprint sensor, NOT Google Passkey)
    implementation("androidx.biometric:biometric:1.1.0")
    
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
}

// Automatically sync the root web app assets into the Android assets directory before compilation
val syncWebAssets = tasks.register<Copy>("syncWebAssets") {
    val rootDir = project.rootDir.parentFile
    val targetDir = file("src/main/assets/www")

    from(rootDir) {
        include("index.html")
        include("manifest.json")
        include("sw.js")
        include("logo-*.png")
        include("fonts/**")
        include("css/**")
        include("js/**")

    }
    into(targetDir)
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
}

tasks.named("preBuild") {
    dependsOn(syncWebAssets)
}
