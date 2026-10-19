#!/usr/bin/env bash
# Builds the release APK on the ARM64 VPS. Google's aapt2 is an x86_64 binary: it runs through qemu-user,
# with an x86_64 glibc in /opt/x86_64-sysroot (see README.md).
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-arm64}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export QEMU_LD_PREFIX="${QEMU_LD_PREFIX:-/opt/x86_64-sysroot}"
./gradlew --no-daemon assembleRelease "$@"
mkdir -p dist
cp app/build/outputs/apk/release/app-release.apk dist/bopomofo-auto.apk
echo "APK: $(pwd)/dist/bopomofo-auto.apk"
