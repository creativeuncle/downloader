# VidSnatch iOS (SwiftUI, iOS 26 Liquid Glass)

Native SwiftUI app, built with the new iOS 26 Liquid Glass design system
(`.glassEffect()`, `GlassEffectContainer`, `.buttonStyle(.glassProminent)`,
and the automatic Liquid Glass tab bar from the new `Tab(...)` API).

## Open in Xcode

```bash
open ios/VidSnatch.xcodeproj
```

Requires Xcode 26+ (iOS 26 SDK) to build and run.

## What's here (step 1)

- **Home tab** — title, glass-styled URL input, glass "Download" button (not
  wired to the backend yet — UI only, as requested)
- **Bottom tab bar** — Home, History, Profile, Settings (History/Profile/
  Settings are placeholder screens for now)

## Structure

```
VidSnatch/
  VidSnatchApp.swift      — app entry point
  RootTabView.swift        — 4-tab TabView
  Views/
    HomeView.swift         — input + download button
    HistoryView.swift      — placeholder
    ProfileView.swift      — placeholder
    SettingsView.swift     — placeholder
  Assets.xcassets          — app icon / accent color placeholders
```

Bundle ID matches the Android app: `com.vidsnatch.app`.
