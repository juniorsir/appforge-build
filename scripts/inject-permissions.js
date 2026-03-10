const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

console.log("🤖 Running AppForge JSON-Driven Permission Injector...");

const manifestPath = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
const plistPath = path.join('ios', 'App', 'App', 'Info.plist');

if (!fs.existsSync('package.json')) {
    console.log("No package.json found. Skipping.");
    process.exit(0);
}
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
const permsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'permissions.json'), 'utf8'));
let androidPerms = new Set(permsData.base?.android || []);
let iosPerms = { ...(permsData.base?.ios || {}) };

for (const plugin of Object.keys(deps)) {
    if (permsData[plugin]) {
        console.log(`-> Found installed plugin: ${plugin}`);
        (permsData[plugin].android || []).forEach(p => androidPerms.add(p));
        Object.assign(iosPerms, permsData[plugin].ios || {});
    }
}

if (fs.existsSync(manifestPath)) {
    let manifest = fs.readFileSync(manifestPath, 'utf8');
    for (const p of androidPerms) {
        if (!manifest.includes(`android:name="${p}"`)) {
            manifest = manifest.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
            console.log(`    + Android: Added ${p}`);
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
            console.log(`    + iOS: Added ${key}`);
        }
    }
}

console.log("✅ Permission injection complete.");
