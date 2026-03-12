const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

console.log("🤖 Running AppForge Universal Permission Injector...");

const appVersion = process.env.APP_VERSION || '1.0.0';
const baseDir = process.env.PROJECT_DIR ? path.resolve(process.env.PROJECT_DIR) : process.cwd();
console.log(`-> Scanning project in directory: ${baseDir}`);
// --- Universal Paths ---
const manifestPath = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
const gradlePath = path.join('android', 'app', 'build.gradle');

// Capacitor uses ios/App/App, Flutter uses ios/Runner
const plistPath = fs.existsSync(path.join('ios', 'Runner', 'Info.plist')) 
    ? path.join('ios', 'Runner', 'Info.plist') 
    : path.join('ios', 'App', 'App', 'Info.plist');

const packageJsonPath = path.join(baseDir, 'package.json');
const pubspecYamlPath = path.join(baseDir, 'pubspec.yaml');
// =================================================================
// 1. VERSION INJECTION (Same as before)
// =================================================================
console.log(`-> Injecting app version: ${appVersion}`);
if (fs.existsSync(gradlePath)) {
    try {
        let gradle = fs.readFileSync(gradlePath, 'utf8');
        gradle = gradle.replace(/versionName\s+['"].*['"]/, `versionName "${appVersion}"`);
        const versionCode = parseInt(appVersion.split('.').map(v => v.padStart(2, '0')).join('').slice(0, 8)) || 1;
        gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
        fs.writeFileSync(gradlePath, gradle);
    } catch(e) {}
}

if (fs.existsSync(plistPath)) {
    try {
        execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${appVersion}" "${plistPath}"`);
        const buildNumber = parseInt(appVersion.split('.').map(v => v.padStart(2, '0')).join('').slice(0, 8)) || 1;
        execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${buildNumber}" "${plistPath}"`);
    } catch (e) {}
}

// =================================================================
// 1.5. DESUGARING INJECTION
// =================================================================
let needsDesugaring = false;

// We need to parse the dependencies first to check for the flag
if (fs.existsSync(packageJsonPath) || fs.existsSync(pubspecYamlPath)) {
    // ... (Your existing dependency parsing logic for `deps` goes here) ...
    for (const plugin of Object.keys(deps)) {
        if (permsData[plugin] && permsData[plugin].requiresDesugaring) {
            needsDesugaring = true;
            console.log(`-> Plugin ${plugin} requires Android core library desugaring.`);
            break; // We only need to find one
        }
    }
}

if (needsDesugaring && fs.existsSync(gradlePath)) {
    console.log("-> Enabling core library desugaring...");
    try {
        let gradle = fs.readFileSync(gradlePath, 'utf8');
        // Add the desugaring dependency
        if (!gradle.includes('coreLibraryDesugaring "com.android.tools:desugar_jdk_libs:')) {
            gradle = gradle.replace(
                'dependencies {', 
                'dependencies {\n    coreLibraryDesugaring "com.android.tools:desugar_jdk_libs:2.0.4"'
            );
        }
        // Enable the compile option
        if (!gradle.includes('coreLibraryDesugaringEnabled = true')) {
            gradle = gradle.replace(
                /compileOptions\s*{/, 
                'compileOptions {\n        coreLibraryDesugaringEnabled = true'
            );
        }
        fs.writeFileSync(gradlePath, gradle);
        console.log("    + Android: Enabled desugaring in build.gradle");
    } catch (e) {
        console.error("    - Android: Failed to enable desugaring.", e);
    }
}

// =================================================================
// 2. UNIVERSAL DEPENDENCY SCANNER
// =================================================================
let deps = {};

if (fs.existsSync(packageJsonPath)) {
    console.log("-> Detected Web/Capacitor project (package.json)");
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
} 
else if (fs.existsSync(pubspecYamlPath)) {
    console.log("-> Detected Flutter project (pubspec.yaml)");
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
} 
else {
    console.log("No package.json or pubspec.yaml found. Skipping permissions.");
    process.exit(0);
}
// =================================================================
// 3. PERMISSION INJECTION
// =================================================================
console.log("-> Analyzing installed plugins for permissions...");
const permsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'permissions.json'), 'utf8'));

let androidPerms = new Set(permsData.base?.android || []);
let iosPerms = { ...(permsData.base?.ios || {}) };

for (const plugin of Object.keys(deps)) {
    if (permsData[plugin]) {
        console.log(`    - Found known plugin: ${plugin}`);
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

console.log("✅ Injection complete.");
