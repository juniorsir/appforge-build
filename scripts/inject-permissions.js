const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

console.log("🤖 Running AppForge Universal Injector...");

// --- Environment Variables ---
const appVersion = process.env.APP_VERSION || '1.0.0';
const appName = process.env.APP_NAME || 'AppForge App';
const packageId = process.env.PACKAGE_ID || 'com.appforge.app';
const baseDir = process.env.PROJECT_DIR ? path.resolve(process.env.PROJECT_DIR) : process.cwd();

// Build Number Calculation (e.g., "1.0.5" -> 10005)
const buildNumber = parseInt(appVersion.split('.').map(v => v.padStart(2, '0')).join('').slice(0, 8)) || 1;

console.log(`-> Target Directory: ${baseDir}`);
console.log(`-> Target Metadata: ${appName} | ${packageId} | v${appVersion} (${buildNumber})`);

// --- Paths ---
const manifestPath = path.join(baseDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const gradleAppPathGroovy = path.join(baseDir, 'android', 'app', 'build.gradle');
const gradleAppPathKts = path.join(baseDir, 'android', 'app', 'build.gradle.kts');
const plistPath = fs.existsSync(path.join(baseDir, 'ios', 'Runner', 'Info.plist')) 
    ? path.join(baseDir, 'ios', 'Runner', 'Info.plist') 
    : path.join(baseDir, 'ios', 'App', 'App', 'Info.plist');
const packageJsonPath = path.join(baseDir, 'package.json');
const pubspecYamlPath = path.join(baseDir, 'pubspec.yaml');

// =================================================================
// 1. UNIVERSAL METADATA INJECTION (Name, ID, Version)
// =================================================================

// A. Inject into pubspec.yaml
if (fs.existsSync(pubspecYamlPath)) {
    try {
        let pubspec = fs.readFileSync(pubspecYamlPath, 'utf8');
        if (pubspec.match(/^version:/m)) {
            pubspec = pubspec.replace(/^version:\s*.*$/m, `version: ${appVersion}+${buildNumber}`);
        } else {
            pubspec = pubspec.replace(/^description:\s*.*$/m, `$& \nversion: ${appVersion}+${buildNumber}`);
        }
        fs.writeFileSync(pubspecYamlPath, pubspec);
        console.log(`    + Flutter: Updated pubspec.yaml version`);
    } catch(e) { console.error("    - Failed to update pubspec version.", e); }
}

// B. Force Package ID and App Name into build.gradle
let targetGradlePath = fs.existsSync(gradleAppPathKts) ? gradleAppPathKts : (fs.existsSync(gradleAppPathGroovy) ? gradleAppPathGroovy : null);

if (targetGradlePath) {
    try {
        let gradle = fs.readFileSync(targetGradlePath, 'utf8');
        // Force the Package ID
        gradle = gradle.replace(/applicationId\s*=?\s*["'][^"']+["']/g, `applicationId = "${packageId}"`);
        gradle = gradle.replace(/applicationId\s+["'][^"']+["']/g, `applicationId "${packageId}"`);
        // Force the Namespace to match
        gradle = gradle.replace(/namespace\s*=?\s*["'][^"']+["']/g, `namespace = "${packageId}"`);
        gradle = gradle.replace(/namespace\s+["'][^"']+["']/g, `namespace "${packageId}"`);
        fs.writeFileSync(targetGradlePath, gradle);
        console.log(`    + Android: Forced Gradle applicationId to "${packageId}"`);
    } catch(e) { console.error("    - Failed to inject Package ID into Gradle.", e); }
}

// C. Inject iOS Version
if (fs.existsSync(plistPath)) {
    try {
        execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${appVersion}" "${plistPath}"`);
        execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${buildNumber}" "${plistPath}"`);
        console.log(`    + iOS: Set version to ${appVersion}`);
    } catch (e) { }
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

// =================================================================
// 3. ENABLE ANDROID 13+ PERMISSIONS (permission_handler)
// =================================================================
const propertiesPath = path.join(baseDir, 'android', 'gradle.properties');
if (fs.existsSync(propertiesPath) && Object.keys(deps).includes('permission_handler')) {
    try {
        let props = fs.readFileSync(propertiesPath, 'utf8');
        if (!props.includes('flutter.compileSdkVersion=34')) {
            props += '\nflutter.compileSdkVersion=34\nflutter.targetSdkVersion=34\nflutter.minSdkVersion=21\n';
            fs.writeFileSync(propertiesPath, props);
            console.log("    + Android: Forced compileSdkVersion to 34 for modern permissions.");
        }
    } catch(e) {}
}

// =================================================================
// 4. DESUGARING INJECTION
// =================================================================
console.log("-> Analyzing installed plugins for required native features...");
const permsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'permissions.json'), 'utf8'));

let androidPerms = new Set(permsData.base?.android || []);
let iosPerms = { ...(permsData.base?.ios || {}) };
let needsDesugaring = false;

for (const plugin of Object.keys(deps)) {
    if (permsData[plugin]) {
        console.log(`    - Found known plugin: ${plugin}`);
        (permsData[plugin].android || []).forEach(p => androidPerms.add(p));
        Object.assign(iosPerms, permsData[plugin].ios || {});
        if (permsData[plugin].requiresDesugaring) {
            needsDesugaring = true;
            console.log(`    - Plugin ${plugin} requires Android core library desugaring.`);
        }
    }
}

if (needsDesugaring && targetGradlePath) {
    console.log("-> Enabling core library desugaring...");
    try {
        let gradle = fs.readFileSync(targetGradlePath, 'utf8');
        const isKts = targetGradlePath.endsWith('.kts');

        if (isKts) {
            if (gradle.includes('compileOptions {')) {
                if (!gradle.includes('isCoreLibraryDesugaringEnabled = true')) gradle = gradle.replace(/compileOptions\s*\{/, 'compileOptions {\n        isCoreLibraryDesugaringEnabled = true');
            } else {
                gradle = gradle.replace(/android\s*\{/, 'android {\n    compileOptions {\n        isCoreLibraryDesugaringEnabled = true\n    }\n');
            }
            if (!gradle.includes('coreLibraryDesugaring(')) gradle += '\n\ndependencies {\n    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")\n}\n';
        } else {
            if (gradle.includes('compileOptions {')) {
                if (!gradle.includes('coreLibraryDesugaringEnabled = true')) gradle = gradle.replace(/compileOptions\s*\{/, 'compileOptions {\n        coreLibraryDesugaringEnabled = true');
            } else {
                gradle = gradle.replace(/android\s*\{/, 'android {\n    compileOptions {\n        coreLibraryDesugaringEnabled = true\n    }\n');
            }
            if (!gradle.includes('coreLibraryDesugaring "')) gradle += '\n\ndependencies {\n    coreLibraryDesugaring "com.android.tools:desugar_jdk_libs:2.0.4"\n}\n';
        }
        fs.writeFileSync(targetGradlePath, gradle);
        console.log(`    + Android: Enabled desugaring successfully.`);
    } catch (e) { console.error("    - Android: Failed to enable desugaring.", e); }
}

// =================================================================
// 5. NUCLEAR PERMISSION & MANIFEST INJECTION
// =================================================================
// B. Force App Name into AndroidManifest.xml (Crucial for Flutter)
if (fs.existsSync(manifestPath)) {
    try {
        let manifest = fs.readFileSync(manifestPath, 'utf8');
        // Ensure tools namespace
        if (!manifest.includes('xmlns:tools=')) {
            manifest = manifest.replace('<manifest', '<manifest xmlns:tools="http://schemas.android.com/tools"');
        }
        // Force the App Name
        manifest = manifest.replace(/android:label="[^"]+"/g, `android:label="${appName}"`);
        manifest = manifest.replace(/<application/g, '<application tools:replace="android:label"');
        fs.writeFileSync(manifestPath, manifest);
        console.log(`    + Android: Forced App Name to "${appName}"`);
    } catch(e) {}
}

// C. Inject into build.gradle (Just as a fallback, Flutter create should handle this)
let targetGradlePath = fs.existsSync(gradleAppPathKts) ? gradleAppPathKts : (fs.existsSync(gradleAppPathGroovy) ? gradleAppPathGroovy : null);

if (targetGradlePath) {
    try {
        let gradle = fs.readFileSync(targetGradlePath, 'utf8');
        // This is now just a safety check.
        gradle = gradle.replace(/applicationId\s*=?\s*["'][^"']+["']/g, `applicationId = "${packageId}"`);
        fs.writeFileSync(targetGradlePath, gradle);
    } catch(e) {}
}
// Inject iOS Permissions
if (fs.existsSync(plistPath)) {
    for (const [key, desc] of Object.entries(iosPerms)) {
        try { execSync(`/usr/libexec/PlistBuddy -c "Print :${key}" "${plistPath}"`, {stdio: 'ignore'}); } 
        catch (e) {
            execSync(`/usr/libexec/PlistBuddy -c "Add :${key} string '${desc}'" "${plistPath}"`);
            console.log(`    + iOS: Added permission key ${key}`);
        }
    }
}

console.log("✅ Injection complete.");
