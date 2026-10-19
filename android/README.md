# Bopomofo for Android Auto

An Android Auto client for practice in the car. It has the exercises that work without looking for long or typing:

| Car menu | Exercise | Web equivalent |
|---|---|---|
| Speak › Say the symbol | A symbol shows; say its name, hands-free | Reading |
| Speak › Repeat syllables | Hear a MOE syllable, say it back | Speaking (syllables) |
| Speak › Repeat sentences | Your saved sentences, said back | Speaking (sentences) |
| Speak › Say the number | Digits show; say them in Mandarin | Numbers (speak) |
| Choose › Which tone? | Hear a syllable, tap its tone | Listening (tone) |
| Choose › Which Bopomofo? | Hear a syllable, tap its spelling | Listening (zhuyin) |
| Choose › Characters | See a traditional character, tap its meaning | Characters |
| Choose › Hear numbers | Hear a number, tap it | Numbers (listen) |

Answers are saved through the same API routes and fields as the web app, so the stats, levels, and coach see them.
Events from the car carry `details.client = "android-auto"`.

The phone app only signs in (the bopomofo.app sign-in page in a WebView), asks for the microphone, and has one
setting: play the model before the learner repeats (those recordings count as helped, like Cheat on the web).

## How it works

- **Sign-in:** Clerk's Native API is off for the production instance, so the app does not use the Clerk Android SDK.
  After the WebView sign-in, the app keeps Clerk's `__client` cookie and asks the Frontend API
  (`POST clerk.bopomofo.app/v1/client/sessions/<id>/tokens`, with `Origin: https://bopomofo.app`) for a 60-second
  session token, like clerk-js in a browser. The token's `azp` is https://bopomofo.app, so the API accepts it.
- **Microphone:** the car's microphone through `CarAudioRecord` (car API level 5), or the phone's when the car
  has none. Voice detection is a port of `frontend/src/lib/listener.ts`; clips are 16 kHz WAV.
- **Audio:** the MOE symbol and syllable recordings and the exercise data are copied from `frontend/public` into
  the APK at build time; sentences and numbers use `/api/tts`.

## Build

Gradle 9.8.1 (wrapper), AGP 9.4.1, Car App Library 1.7.0, compileSdk 36, JDK 21.

    ./build-apk.sh        # writes dist/bopomofo-auto.apk

On the ARM64 VPS: the SDK is in /opt/android-sdk. Google's `aapt2` is an x86_64 binary, so it runs through
qemu-user (`apt install qemu-user binfmt-support`) with an x86_64 glibc unpacked in /opt/x86_64-sysroot
(libc6 and libgcc-s1 amd64 debs, plus `lib64 -> usr/lib64`). build-apk.sh sets `QEMU_LD_PREFIX` for it.

The release key is outside the repository: /root/.android/bopomofo-auto-release.jks, with its passwords in
/root/.android/bopomofo-auto-signing.properties (or the file named by `BOPOMOFO_SIGNING`). Keep it: Android only
installs an update signed with the same key. Without it, the build signs with the debug key.

## Install

1. Install the APK on the phone, open Bopomofo, sign in, and allow the microphone.
2. Android Auto shows apps from outside the Play Store only with unknown sources on: Android Auto settings ›
   tap Version about 10 times › ⋮ › Developer settings › Unknown sources.
3. Connect the phone to the car and pick Bopomofo in the app list.
