#!/bin/bash

# AppForge Universal Permission Injector
# This script reads package.json and injects the required
# permissions into AndroidManifest.xml and Info.plist.

echo "🤖 Running AppForge Permission Injector..."

# --- File Paths ---
MANIFEST="android/app/src/main/AndroidManifest.xml"
PLIST="ios/App/App/Info.plist"

# Check if package.json exists
if [ ! -f "package.json" ]; then
  echo "No package.json found. Skipping permission injection."
  exit 0
fi

# FUNCTION TO INJECT ANDROID PERMISSIONS
# Inserts a permission line just before the </manifest> tag.
inject_android_permission() {
  local permission=$1
  if ! grep -q "$permission" "$MANIFEST"; then
    sed -i "/<\/manifest>/i \ \ \ \ <uses-permission android:name=\"$permission\" />" "$MANIFEST"
    echo "    + Android: Added $permission"
  fi
}

# FUNCTION TO INJECT IOS PERMISSIONS
# Uses PlistBuddy to add a key/string pair to Info.plist.
inject_ios_permission() {
  local key=$1
  local description=$2
  # Check if the key already exists before adding
  if ! /usr/libexec/PlistBuddy -c "Print :$key" "$PLIST" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Add :$key string '$description'" "$PLIST"
    echo "    + iOS: Added $key"
  fi
}

# KNOWLEDGE BASE: Map Capacitor Plugins to Native Permissions
# --- Geolocation ---
if grep -q '"@capacitor/geolocation"' package.json; then
  echo "-> Found Geolocation plugin, configuring permissions..."
  if [ -f "$MANIFEST" ]; then
    inject_android_permission "android.permission.ACCESS_COARSE_LOCATION"
    inject_android_permission "android.permission.ACCESS_FINE_LOCATION"
  fi
  if [ -f "$PLIST" ]; then
    inject_ios_permission "NSLocationWhenInUseUsageDescription" "This app needs your location to provide location-based features."
  fi
fi

# --- Camera ---
if grep -q '"@capacitor/camera"' package.json; then
  echo "-> Found Camera plugin, configuring permissions..."
  if [ -f "$MANIFEST" ]; then
    inject_android_permission "android.permission.CAMERA"
    # Required for picking images from gallery on older Android
    inject_android_permission "android.permission.READ_EXTERNAL_STORAGE"
    inject_android_permission "android.permission.WRITE_EXTERNAL_STORAGE"
  fi
  if [ -f "$PLIST" ]; then
    inject_ios_permission "NSCameraUsageDescription" "This app needs camera access to take pictures."
    inject_ios_permission "NSPhotoLibraryUsageDescription" "This app needs photo library access to select pictures."
  fi
fi

# --- Push Notifications ---
if grep -q '"@capacitor/push-notifications"' package.json; then
  echo "-> Found Push Notifications plugin, configuring permissions..."
  if [ -f "$MANIFEST" ]; then
    # Required for Android 13+
    inject_android_permission "android.permission.POST_NOTIFICATIONS"
  fi
  # iOS push notifications require entitlements configured in Xcode, not just Info.plist.
  # This part is handled when the user opens the project on their Mac.
fi

# --- Haptics (Vibration) ---
if grep -q '"@capacitor/haptics"' package.json; then
  echo "-> Found Haptics plugin, configuring permissions..."
  if [ -f "$MANIFEST" ]; then
    inject_android_permission "android.permission.VIBRATE"
  fi
fi

# --- Network Status ---
if grep -q '"@capacitor/network"' package.json; then
  echo "-> Found Network plugin, configuring permissions..."
  if [ -f "$MANIFEST" ]; then
    inject_android_permission "android.permission.ACCESS_NETWORK_STATE"
  fi
fi

echo "✅ Permission injection complete."
