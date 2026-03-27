const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

console.log("🤖 Running AppForge Universal Cloud Engine...");

// --- Environment Variables ---
const appVersion = process.env.APP_VERSION || '1.0.0';
const appName = process.env.APP_NAME || 'AppForge App';
const packageId = process.env.PACKAGE_ID || 'com.appforge.app';
const baseDir = process.env.PROJECT_DIR ? path.resolve(process.env.PROJECT_DIR) : process.cwd();

console.log(`-> Target Directory: ${baseDir}`);

// --- Universal Paths ---
let manifestPath = path.join(baseDir, 'app', 'src', 'main', 'AndroidManifest.xml');
if (!fs.existsSync(manifestPath)) manifestPath = path.join(baseDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

let gradleAppPathKts = path.join(baseDir, 'app', 'build.gradle.kts');
if (!fs.existsSync(gradleAppPathKts)) gradleAppPathKts = path.join(baseDir, 'android', 'app', 'build.gradle.kts');

let gradleAppPathGroovy = path.join(baseDir, 'app', 'build.gradle');
if (!fs.existsSync(gradleAppPathGroovy)) gradleAppPathGroovy = path.join(baseDir, 'android', 'app', 'build.gradle');

let targetGradlePath = fs.existsSync(gradleAppPathKts) ? gradleAppPathKts : (fs.existsSync(gradleAppPathGroovy) ? gradleAppPathGroovy : null);

const plistPath = fs.existsSync(path.join(baseDir, 'ios', 'Runner', 'Info.plist')) 
    ? path.join(baseDir, 'ios', 'Runner', 'Info.plist') 
    : path.join(baseDir, 'ios', 'App', 'App', 'Info.plist');

const packageJsonPath = path.join(baseDir, 'package.json');
const pubspecYamlPath = path.join(baseDir, 'pubspec.yaml');
const propertiesPath = path.join(baseDir, 'android', 'gradle.properties');

// =================================================================
// 1. CLOUD METADATA VERIFICATION
// =================================================================
console.log(`\n-> Stage 1: Verifying Local Metadata Injection`);
let verificationFailed = false;

// Verify App Name in Manifest
if (fs.existsSync(manifestPath)) {
    const manifest = fs.readFileSync(manifestPath, 'utf8');
    if (!manifest.includes(`android:label="${appName}"`)) {
        console.error(`    ❌ Warning: Manifest does not contain App Name "${appName}"`);
        verificationFailed = true;
    } else {
        console.log(`    ✅ Verified App Name: "${appName}"`);
    }
} else {
    console.error("    ❌ Critical: AndroidManifest.xml not found!");
}

// Verify Package ID in Gradle
if (targetGradlePath) {
    const gradle = fs.readFileSync(targetGradlePath, 'utf8');
    if (!gradle.includes(`"${packageId}"`)) {
        console.error(`    ❌ Warning: Gradle does not contain Package ID "${packageId}"`);
        verificationFailed = true;
    } else {
         console.log(`    ✅ Verified Package ID: "${packageId}"`);
    }
} else {
    console.error("    ❌ Critical: app/build.gradle(.kts) not found!");
}

if (verificationFailed) {
    console.log("⚠️  WARNING: Local metadata injection may have failed or was overridden by native templates. The app might build with default metadata.");
} else {
    console.log("✅ Local Metadata Verified successfully.");
}

// =================================================================
// 1.5 CLOUD ICON INJECTION
// =================================================================
console.log(`\n-> Stage 1.5: Injecting Custom App Icon`);

// Look for the icon at the root of the unzipped directory (baseDir)
const iconSource = path.join(baseDir, 'appforge_icon.png');

if (fs.existsSync(iconSource) && fs.existsSync(manifestPath)) {
    console.log("    - Found custom icon: appforge_icon.png");
    
    // Find the 'res' directory where Android stores icons
    const resDir = path.join(path.dirname(manifestPath), 'res');
    
    // The standard Android icon buckets
    const mipmaps = ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi'];
    
    let injectedCount = 0;
    mipmaps.forEach(m => {
        const targetDir = path.join(resDir, m);
        if (fs.existsSync(targetDir)) {
            // Overwrite the default ic_launcher.png
            fs.copyFileSync(iconSource, path.join(targetDir, 'ic_launcher.png'));
            
            // Overwrite the round version if it exists
            const roundIcon = path.join(targetDir, 'ic_launcher_round.png');
            if (fs.existsSync(roundIcon)) {
                fs.copyFileSync(iconSource, roundIcon);
            }
            injectedCount++;
        }
    });

    if (injectedCount > 0) {
        console.log(`    ✅ Successfully injected custom icon into ${injectedCount} resolutions.`);
    } else {
        console.error(`    ❌ Warning: 'res/mipmap' folders not found. Icon not injected.`);
    }
} else {
    console.log("    - No custom icon found (appforge_icon.png). Using default.");
}

// =================================================================
// 2. UNIVERSAL DEPENDENCY SCANNER
// =================================================================
console.log(`\n-> Stage 2: Scanning Dependencies`);
let deps = {};

if (fs.existsSync(packageJsonPath)) {
    console.log("    - Detected Web/Capacitor project (package.json)");
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
} 
else if (fs.existsSync(pubspecYamlPath)) {
    console.log("    - Detected Flutter project (pubspec.yaml)");
    const pubspec = fs.readFileSync(pubspecYamlPath, 'utf8');
    let inDeps = false;
    pubspec.split('\n').forEach(line => {
        if (line.startsWith('dependencies:')) { inDeps = true; return; }
        if (line.match(/^[a-zA-Z]/)) { inDeps = false; } 
        if (inDeps && line.trim().length > 0 && !line.trim().startsWith('#')) {
            const match = line.match(/^\s+([a-zA-Z0-9_-]+):/);
            if (match) deps[match[1]] = true; 
        }
    });
} else {
    console.log("    ⚠️ No package.json or pubspec.yaml found. Skipping advanced plugin injection.");
    process.exit(0);
}

// =================================================================
// 3. ENABLE ANDROID 13+ PERMISSIONS (e.g., permission_handler)
// =================================================================
console.log(`\n-> Stage 3: Configuring Target SDKs`);
if (fs.existsSync(propertiesPath) && Object.keys(deps).includes('permission_handler')) {
    try {
        let props = fs.readFileSync(propertiesPath, 'utf8');
        if (!props.includes('flutter.compileSdkVersion=34')) {
            props += '\nflutter.compileSdkVersion=34\nflutter.targetSdkVersion=34\n';
            fs.writeFileSync(propertiesPath, props);
            console.log("    + Android: Forced compileSdkVersion to 34 for modern permission support.");
        } else {
            console.log("    ✓ Android: compileSdkVersion is already 34+");
        }
    } catch(e) {
        console.error("    - Error updating gradle.properties:", e);
    }
}

// =================================================================
// 4. NATIVE PERMISSION ANALYSIS & DESUGARING
// =================================================================
console.log(`\n-> Stage 4: Analyzing Hardware Requirements`);
const permsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'permissions.json'), 'utf8'));

let androidPerms = new Set(permsData.base?.android || []);
let iosPerms = { ...(permsData.base?.ios || {}) };
let needsDesugaring = false;

for (const plugin of Object.keys(deps)) {
    if (permsData[plugin]) {
        console.log(`    - Detected hardware plugin: ${plugin}`);
        (permsData[plugin].android || []).forEach(p => androidPerms.add(p));
        Object.assign(iosPerms, permsData[plugin].ios || {});
        if (permsData[plugin].requiresDesugaring) {
            needsDesugaring = true;
            console.log(`      ! Requires Android core library desugaring.`);
        }
    }
}

// Apply Desugaring if required
if (needsDesugaring && targetGradlePath) {
    console.log("    -> Enabling core library desugaring...");
    try {
        let gradle = fs.readFileSync(targetGradlePath, 'utf8');
        const isKts = targetGradlePath.endsWith('.kts');

        if (isKts) {
            if (!gradle.includes('isCoreLibraryDesugaringEnabled = true')) {
                gradle = gradle.includes('compileOptions {') 
                    ? gradle.replace('compileOptions {', 'compileOptions {\n        isCoreLibraryDesugaringEnabled = true') 
                    : gradle.replace('android {', 'android {\n    compileOptions {\n        isCoreLibraryDesugaringEnabled = true\n    }\n');
            }
            if (!gradle.includes('coreLibraryDesugaring(')) {
                gradle += '\n\ndependencies {\n    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")\n}\n';
            }
        } else {
            if (!gradle.includes('coreLibraryDesugaringEnabled = true')) {
                gradle = gradle.includes('compileOptions {') 
                    ? gradle.replace('compileOptions {', 'compileOptions {\n        coreLibraryDesugaringEnabled = true') 
                    : gradle.replace('android {', 'android {\n    compileOptions {\n        coreLibraryDesugaringEnabled = true\n    }\n');
            }
            if (!gradle.includes('coreLibraryDesugaring "')) {
                gradle += '\n\ndependencies {\n    coreLibraryDesugaring "com.android.tools:desugar_jdk_libs:2.0.4"\n}\n';
            }
        }
        fs.writeFileSync(targetGradlePath, gradle);
        console.log(`    + Android: Desugaring enabled successfully.`);
    } catch (e) { console.error("    - Error enabling desugaring:", e); }
}

// =================================================================
// 5. NUCLEAR PERMISSION INJECTION (AndroidManifest.xml)
// =================================================================
console.log(`\n-> Stage 5: Injecting Native Security Manifest`);
if (fs.existsSync(manifestPath)) {
    try {
        let manifest = fs.readFileSync(manifestPath, 'utf8');
        
        // Ensure tools namespace exists so we can use tools:node="replace"
        if (!manifest.includes('xmlns:tools=')) {
            manifest = manifest.replace('<manifest', '<manifest xmlns:tools="http://schemas.android.com/tools"');
        }

        // Inject Nuclear Permissions
        let injectedCount = 0;
        for (const p of androidPerms) {
            // Aggressively strip out old, broken versions of the permission
            const permRegex = new RegExp(`<uses-permission android:name="${p}"[^>]*>`, 'g');
            manifest = manifest.replace(permRegex, '');
            // Inject the absolute, override version
            manifest = manifest.replace('</manifest>', `    <uses-permission android:name="${p}" tools:node="replace" />\n</manifest>`);
            injectedCount++;
        }
        
        fs.writeFileSync(manifestPath, manifest);
        console.log(`    + Android: Successfully injected ${injectedCount} strict permissions.`);
    } catch(e) { console.error("    - Error injecting nuclear manifest:", e); }
}

// =================================================================
// 6. IOS PERMISSION INJECTION (Info.plist)
// =================================================================
if (process.platform === 'darwin') {
    console.log(`\n-> Stage 6: Injecting iOS Plist Descriptions`);
    if (fs.existsSync(plistPath)) {
        let injectedCount = 0;
        for (const [key, desc] of Object.entries(iosPerms)) {
            try { 
                // Check if key exists
                execSync(`/usr/libexec/PlistBuddy -c "Print :${key}" "${plistPath}"`, {stdio: 'ignore'}); 
            } catch (e) {
                // Key doesn't exist, inject it
                execSync(`/usr/libexec/PlistBuddy -c "Add :${key} string '${desc}'" "${plistPath}"`);
                injectedCount++;
            }
        }
        console.log(`    + iOS: Successfully injected ${injectedCount} usage descriptions.`);
    } else {
        console.error("    ❌ Critical: iOS Info.plist not found!");
    }
} else {
    console.log(`\n-> Stage 6: Skipping iOS Injection (Running on ${process.platform}, not macOS).`);
}

// =================================================================
// 6. UNIVERSAL APP SIGNING (TOP-INJECTION OVERRIDE)
// =================================================================
const ksPass = process.env.KS_PASS;
const ksAlias = process.env.KS_ALIAS;
const kPass = process.env.K_PASS;
const buildType = process.env.BUILD_TYPE || 'debug';

if (targetGradlePath && ksPass && ksAlias && kPass) {
    console.log(`\n-> Stage 6: Force-Injecting Permanent App Signature (${buildType})`);
    try {
        let gradle = fs.readFileSync(targetGradlePath, 'utf8');
        const isKts = targetGradlePath.endsWith('.kts');

        // 1. Clean previous AppForge injections
        gradle = gradle.split("// --- APPFORGE SIGNING START ---")[0];

        // 2. Create the blocks
        let signingConfigBlock = "";
        let applyToRelease = "";
        let applyToDebug = "";

        if (isKts) {
            signingConfigBlock = `
    signingConfigs {
        create("appforgeSign") {
            storeFile = file("appforge.keystore")
            storePassword = "${ksPass}"
            keyAlias = "${ksAlias}"
            keyPassword = "${kPass}"
        }
    }
`;
            applyToRelease = 'signingConfig = signingConfigs.getByName("appforgeSign")';
            applyToDebug = 'signingConfig = signingConfigs.getByName("appforgeSign")';
        } else {
            signingConfigBlock = `
    signingConfigs {
        appforgeSign {
            storeFile file("appforge.keystore")
            storePassword "${ksPass}"
            keyAlias "${ksAlias}"
            keyPassword "${kPass}"
        }
    }
`;
            applyToRelease = 'signingConfig signingConfigs.appforgeSign';
            applyToDebug = 'signingConfig signingConfigs.appforgeSign';
        }

        // --- THE MAGIC INJECTION ---

        // A. Inject signingConfigs at the very top of the android {} block
        gradle = gradle.replace(/android\s*\{/, `android {\n    // --- APPFORGE SIGNING START ---\n${signingConfigBlock}`);

        // B. Inject the signingConfig command into the release block
        if (isKts) {
            gradle = gradle.replace(/getByName\("release"\)\s*\{/, `getByName("release") {\n        ${applyToRelease}`);
            gradle = gradle.replace(/getByName\("debug"\)\s*\{/, `getByName("debug") {\n        ${applyToDebug}`);
        } else {
            // Groovy: find release { ... } and inject
            gradle = gradle.replace(/release\s*\{/, `release {\n            ${applyToRelease}`);
            // Force remove any existing signingConfig in debug so our override works
            gradle = gradle.replace(/signingConfig signingConfigs\.debug/g, `// override`);
            gradle = gradle.replace(/debug\s*\{/, `debug {\n            ${applyToDebug}`);
        }

        fs.writeFileSync(targetGradlePath, gradle);
        console.log(`    + Android: Permanent signature injected into ${isKts ? 'Kotlin' : 'Groovy'} Gradle.`);
    } catch(e) {
        console.error(`    - Android: Failed to force signing config.`, e);
    }
}
console.log("\n✅ Cloud Engine Initialization Complete. Proceeding to compile...");
