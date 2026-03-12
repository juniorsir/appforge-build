const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

console.log("🤖 Running AppForge Injector (Version & Permissions)...");

// --- Define Paths and Config ---
const manifestPath = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
const gradlePath = path.join('android', 'app', 'build.gradle'); // For Android version
const plistPath = path.join('ios', 'App', 'App', 'Info.plist'); // For iOS version
const appVersion = process.env.APP_VERSION || '1.0.0'; // Read version from env var

// =================================================================
// 1. VERSION INJECTION
// =================================================================
console.log(`-> Injecting app version: ${appVersion}`);

// Android Version Injection
if (fs.existsSync(gradlePath)) {
    try {
        let gradle = fs.readFileSync(gradlePath, 'utf8');
        // Use a robust regex to find and replace versionName
        gradle = gradle.replace(/versionName\s+['"].*['"]/, `versionName "${appVersion}"`);
        // Also create and update versionCode (e.g., 1.0.1 -> 10001)
        const versionCode = parseInt(appVersion.split('.').map(v => v.padStart(2, '0')).join('').slice(0, 8)) || 1;
        gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
        fs.writeFileSync(gradlePath, gradle);
        console.log(`    + Android: Set version to ${appVersion} (Code: ${versionCode})`);
    } catch(e) {
        console.error('    - Android: Failed to inject version number.', e);
    }
}

// iOS Version Injection
if (fs.existsSync(plistPath)) {
    try {
        // CFBundleShortVersionString is the display version (e.g., "1.0.1")
        execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${appVersion}" "${plistPath}"`);
        // CFBundleVersion is the build number, we'll use the same as android's versionCode for consistency
        const buildNumber = parseInt(appVersion.split('.').map(v => v.padStart(2, '0')).join('').slice(0, 8)) || 1;
        execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${buildNumber}" "${plistPath}"`);
        console.log(`    + iOS: Set version to ${appVersion} (Build: ${buildNumber})`);
    } catch (e) {
        console.error("    - iOS: Failed to inject version number.", e);
    }
}

// =================================================================
// 2. PERMISSION INJECTION
// =================================================================

// Check if package.json exists (required for permission logic)
if (!fs.existsSync('package.json')) {
    console.log("No package.json found. Skipping permission injection.");
} else {
    console.log("-> Analyzing installed plugins for permissions...");
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const permsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'permissions.json'), 'utf8'));
    
    let androidPerms = new Set(permsData.base?.android || []);
    let iosPerms = { ...(permsData.base?.ios || {}) };

    for (const plugin of Object.keys(deps)) {
        if (permsData[plugin]) {
            console.log(`    - Found plugin: ${plugin}`);
            (permsData[plugin].android || []).forEach(p => androidPerms.add(p));
            Object.assign(iosPerms, permsData[plugin].ios || {});
        }
    }

    if (fs.existsSync(manifestPath)) {
        let manifest = fs.readFileSync(manifestPath, 'utf8');
        for (const p of androidPerms) {
            if (!manifest.includes(`android:name="${p}"`)) {
                manifest = manifest.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
                console.log(`    + Android: Added permission ${p}`);
            }
        }
        fs.writeFileSync(manifestPath, manifest);
    }

    if (fs.existsSync(plistPath)) {
        for (const [key, desc] of Object.entries(iosPerms)) {
            try {
                execSync(`/usr/libexec/PlistBuddy -c "Print :${key}" "${plistPath}"`, {stdio: 'ignore'});
            } catch (e) {
                execSync(`/usr/libexec/PlistBuddy -c "Add :${key} string '${desc}'" "${plistPath}"`);
                console.log(`    + iOS: Added permission key ${key}`);
            }
        }
    }
}

console.log("✅ Injection complete.");
