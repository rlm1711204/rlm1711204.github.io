# Kaasu for Android (APK)

This folder turns the Kaasu web app into an installable Android app (a
"Trusted Web Activity"). The APK opens the Kaasu website full-screen using
Chrome's engine, so:

- every website update reaches the app automatically (no new APK needed),
- Google sign-in and Drive backup work, because Google blocks sign-in inside
  ordinary in-app web views but allows it in Chrome.

## Download
**https://github.com/rlm1711204/rlm1711204.github.io/releases/latest/download/Kaasu.apk**

On the phone: open the link → download → tap the file → **Install**.
The first time, Android asks you to allow installs from Chrome / Files: tap
**Settings → Allow from this source**, then go back and tap **Install**.
Play Protect may say "unknown app": tap **More details → Install anyway**.

## How the APK gets built
GitHub Actions (`.github/workflows/android-apk.yml`) builds it on GitHub's
servers whenever this folder changes, and publishes it on the Releases page.

## Signing key
`kaasu-release.p12` is the app's signing key, **encrypted** with a password
that is stored only as the GitHub secret `KAASU_KEYSTORE_PASSWORD`. Keep that
password safe (e.g. in a password manager). Every APK must be signed with
the same key, or phones will refuse to install an update over the old version.

## Full screen (no address bar)
`.well-known/assetlinks.json` at the root of this site proves the app and the
website belong together, so Android opens Kaasu full screen. It must keep the
SHA-256 fingerprint of `kaasu-release.p12`.
