# Android TV App Rules (`android-tv/`)

## Tech Stack

- **Language**: Kotlin 1.9.22, JDK 17
- **UI**: Custom Fragments + Leanback (SearchSupportFragment)
- **Architecture**: MVVM + ViewModel + StateFlow + Kotlin Coroutines
- **Network**: OkHttp + kotlinx.serialization (no Retrofit — API count is small)
- **Image**: Coil (Kotlin-first)
- **Player**: ExoPlayer (Media3) with HLS
- **Build**: Gradle 8.5, AGP 8.2.0, compileSdk 34, minSdk 21

## Directory Structure

```
android-tv/app/src/main/java/com/moontv/android/
├── MainActivity.kt              # Fragment host (login or home)
├── PlayerActivity.kt            # ExoPlayer HLS playback
├── SettingsActivity.kt          # Server URL config + QR setup
├── api/
│   ├── Models.kt                # API data classes (@Serializable)
│   ├── ApiClient.kt             # OkHttp singleton (all API calls)
│   ├── CookieStore.kt           # CookieJar → SharedPreferences
│   └── SseParser.kt             # SSE stream → Kotlin Flow
├── viewmodel/                   # MVVM ViewModels (StateFlow)
├── ui/
│   ├── LoginFragment.kt         # Password login
│   ├── HomeFragment.kt          # Custom rows (RecyclerView)
│   ├── SearchFragment.kt        # SSE streaming search + pinyin
│   ├── DetailFragment.kt        # Poster+info+episodes grid
│   ├── FavoritesFragment.kt     # 5-column grid
│   ├── CardPresenter.kt         # Poster card presenter (Leanback)
│   ├── EpisodePresenter.kt      # Episode button presenter
│   └── PinyinHelper.kt          # Built-in pinyin initial matching
└── util/
    ├── Prefs.kt                 # SharedPreferences helper
    └── ImageUtils.kt            # Coil image loading
```

## Build Commands

```bash
# Environment setup (macOS with Homebrew)
export JAVA_HOME="/opt/homebrew/opt/openjdk@17"
export ANDROID_HOME="$HOME/Library/Android/sdk"

# Build debug APK
cd android-tv && ./gradlew assembleDebug
# Output: android-tv/app/build/outputs/apk/debug/app-debug.apk

# Install to TV via ADB
adb connect <TV_IP>:5555
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Build Rules

- Theme MUST be `Theme.Leanback` (not `Theme.AppCompat`) — Activities must extend `FragmentActivity`, NOT `AppCompatActivity`
- All network calls MUST run on `Dispatchers.IO` (Android throws `NetworkOnMainThreadException` on main thread)
- API data classes MUST have `@Serializable` annotation and `ignoreUnknownKeys = true` in Json config
- OkHttp `CookieJar` handles auth cookie persistence — do not use Android `CookieManager`
- `./gradlew assembleDebug` MUST pass before committing Android changes

## Release Rules

APK 构建完成后，使用 `gh` CLI 上传到 GitHub Releases：

```bash
gh release create <tag> <apk-absolute-path> --title "<标题>" --notes "<说明>"
```

示例：

```bash
gh release create v1.0.0-android-tv /Users/rio/Documents/MoonTV/android-tv/app/build/outputs/apk/debug/app-debug.apk --title "Android TV v1.0.0 (Debug)" --notes "原生 Kotlin UI"
```

- Tag 格式: `v<version>-android-tv`
- Release 命令必须写成**单行**（zsh 多行转义问题）
- APK 路径使用**绝对路径**
- `gh auth login` 需要先完成认证（仅首次）
- Debug APK: `android-tv/app/build/outputs/apk/debug/app-debug.apk`
- Release APK: `android-tv/app/build/outputs/apk/release/app-release.apk`
