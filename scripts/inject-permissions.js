const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

console.log("🤖 Running AppForge Universal Injector...");

const appVersion = process.env.APP_VERSION || '1.0.0';
const baseDir = process.env.PROJECT_DIR ? path.resolve(process.env.PROJECT_DIR) : process.cwd();

console.log(`-> Scanning project in directory: ${baseDir}`);

const manifestPath = path.join(baseDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const gradlePath = path.join(baseDir, 'android', 'app', 'build.gradle');
const gradleAppPathGroovy = path.join(baseDir, 'android', 'app', 'build.gradle');
const gradleAppPathKts = path.join(baseDir, 'android', 'app', 'build.gradle.kts');
const plistPath = fs.existsSync(path.join(baseDir, 'ios', 'Runner', 'Info.plist')) 
    ? path.join(baseDir, 'ios', 'Runner', 'Info.plist') 
    : path.join(baseDir, 'ios', 'App', 'App', 'Info.plist');
const packageJsonPath = path.join(baseDir, 'package.json');
const pubspecYamlPath = path.join(baseDir, 'pubspec.yaml');

// =================================================================
// 1. VERSION INJECTION
// =================================================================
console.log(`-> Injecting app version: ${appVersion}`);

// =================================================================
// 1. UNIVERSAL METADATA INJECTION (Name, ID, Version)
// =================================================================

// A. Inject into pubspec.yaml (Bulletproof Regex)
if (fs.existsSync(pubspecYamlPath)) {
    try {
        let pubspec = fs.readFileSync(pubspecYamlPath, 'utf8');
        // This regex ensures we only replace the root version line, not a dependency version
        if (pubspec.match(/^version:/m)) {
            pubspec = pubspec.replace(/^version:\s*.*$/m, `version: ${appVersion}+${buildNumber}`);
        } else {
            pubspec = pubspec.replace(/^description:\s*.*$/m, `$& \nversion: ${appVersion}+${buildNumber}`);
        }
        fs.writeFileSync(pubspecYamlPath, pubspec);
        console.log(`    + Flutter: Updated pubspec.yaml version to ${appVersion}+${buildNumber}`);
    } catch(e) { console.error("    - Failed to update pubspec version."); }
}

// B. Force Package ID into AndroidManifest.xml (Crucial for Flutter)
if (fs.existsSync(manifestPath)) {
    try {
        let manifest = fs.readFileSync(manifestPath, 'utf8');
        if (manifest.includes('package=')) {
            manifest = manifest.replace(/package="[^"]+"/g, `package="${packageId}"`);
            fs.writeFileSync(manifestPath, manifest);
            console.log(`    + Android: Set Manifest Package ID to "${packageId}"`);
        }
    } catch(e) {}
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
    console.log("No package.json or pubspec.yaml found. Skipping advanced injection.");
    process.exit(0);
}

// =================================================================
// 3. DESUGARING & PERMISSION INJECTION
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
// =================================================================
// 3. DESUGARING INJECTION
// =================================================================
if (needsDesugaring) {
    console.log("-> Enabling core library desugaring...");

    const gradleAppPathGroovy = path.join(baseDir, 'android', 'app', 'build.gradle');
    const gradleAppPathKts = path.join(baseDir, 'android', 'app', 'build.gradle.kts');

    let targetGradlePath = null;
    let isKts = false;

    if (fs.existsSync(gradleAppPathKts)) {
        targetGradlePath = gradleAppPathKts;
        isKts = true;
    } else if (fs.existsSync(gradleAppPathGroovy)) {
        targetGradlePath = gradleAppPathGroovy;
    }

    if (targetGradlePath) {
        try {
            let gradle = fs.readFileSync(targetGradlePath, 'utf8');

            if (isKts) {
                // --- KOTLIN SCRIPT (.kts) INJECTION ---
                console.log("    - Detected Kotlin Script (build.gradle.kts)");
                
                // 1. Enable the compile option
                if (gradle.includes('compileOptions {')) {
                    if (!gradle.includes('isCoreLibraryDesugaringEnabled = true')) {
                        gradle = gradle.replace(
                            /compileOptions\s*\{/, 
                            'compileOptions {\n        isCoreLibraryDesugaringEnabled = true'
                        );
                    }
                } else {
                    gradle = gradle.replace(
                        /android\s*\{/, 
                        'android {\n    compileOptions {\n        isCoreLibraryDesugaringEnabled = true\n    }\n'
                    );
                }

                // 2. Add the dependency (FOOLPROOF APPEND)
                if (!gradle.includes('coreLibraryDesugaring(')) {
                    gradle += '\n\n// Injected by AppForge\ndependencies {\n    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")\n}\n';
                }

            } else {
                // --- GROOVY SCRIPT (.gradle) INJECTION ---
                console.log("    - Detected Groovy Script (build.gradle)");
                
                // 1. Enable the compile option
                if (gradle.includes('compileOptions {')) {
                    if (!gradle.includes('coreLibraryDesugaringEnabled = true')) {
                        gradle = gradle.replace(
                            /compileOptions\s*\{/, 
                            'compileOptions {\n        coreLibraryDesugaringEnabled = true'
                        );
                    }
                } else {
                    gradle = gradle.replace(
                        /android\s*\{/, 
                        'android {\n    compileOptions {\n        coreLibraryDesugaringEnabled = true\n    }\n'
                    );
                }

                // 2. Add the dependency (FOOLPROOF APPEND)
                if (!gradle.includes('coreLibraryDesugaring "')) {
                    gradle += '\n\n// Injected by AppForge\ndependencies {\n    coreLibraryDesugaring "com.android.tools:desugar_jdk_libs:2.0.4"\n}\n';
                }
            }

            fs.writeFileSync(targetGradlePath, gradle);
            console.log(`    + Android: Enabled desugaring successfully.`);
            
        } catch (e) {
            console.error(`    - Android: Failed to enable desugaring in ${targetGradlePath}.`, e);
        }
    } else {
         console.log("    - Android: Could not find build.gradle or build.gradle.kts to inject desugaring.");
    }
}

// Inject Android Permissions
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

// Inject iOS Permissions
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
