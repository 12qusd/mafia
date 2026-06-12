# Engine / Stack Evaluation

## Recommendation

Build it in web tech: TypeScript client (React or Svelte; add PixiJS only if/when you want canvas-rendered flair) wrapped in Electron with steamworks.js, talking WebSockets to your own Node/Postgres servers. Runner-up if you want to bet on an engine anyway: Godot 4 with GDScript + GodotSteam, keeping the server in Node.

## Reasoning

Honest answer to the framing question: no, a game engine is not necessary for this game, and for this developer it is actively the slower path. A social deduction game is a lobby, a chat scrollback, vote/role panels, timers, and tooltips — exactly the workload DOM/CSS was built for and exactly where every game engine's UI system is the weak point (Godot's RichTextLabel needs documented workarounds for large chat logs; Unity's UI Toolkit still lacks runtime tooltips/drag-drop and has scroll-view pain per 2025 status threads; MonoGame/Ebitengine/Bevy have effectively nothing). Meanwhile the dev's existing TypeScript/Node/Postgres skills transfer 1:1, including shared types between client and authoritative server — the single biggest correctness lever in a protocol-heavy deduction game. The route is commercially proven on Steam for Win+macOS (CrossCode via NW.js, shapez via Electron), steamworks.js is alive (pushed Apr 2026, prebuilt npm binaries, TS definitions), and Steam-side needs are thin anyway because game networking runs on his own servers — Steamworks is only auth tickets, achievements, rich presence, and presence-based invites. The unique strategic kicker: the same codebase ships a free browser build to seed the player base, which is existential for an online social deduction game (Town of Salem itself grew from a browser game). The two real costs are known and bounded: (1) Steam overlay does not work on macOS for Electron and is flaky on Windows — route invites through the Steam client launch flow instead; (2) Electron macOS signing/notarization yak-shaving — solved by electron-builder plus Valve's documented entitlements (disable-library-validation, allow-dyld-environment-variables). Tauri is rejected for Steam specifically: the overlay cannot hook its system webview, the only Steamworks plugin is v0.0.4, and macOS WKWebView adds rendering inconsistency — Electron is the web wrapper that works. If the dev prefers insurance for a more game-like future (animated night phases, minigames, juice), Godot 4 GDScript + GodotSteam is a strong 7/10: best-in-engine-class UI nodes, the most actively maintained Steam binding in any engine (4.19.1, May 2026, now on Codeberg), built-in macOS signing/notarization including Mac-less rcodesign, and the server still stays in Node via WebSockets. Avoid the Godot C# path (C# Steam bindings version-lag GodotSteam, forcing forks or untyped interop). Unity (5/10) is the safe-but-slow industrial choice whose strengths (3D, asset store, console ports) this project doesn't use, bought with the steepest ramp for a web-native solo dev. Key sources: codeberg.org/godotsteam/godotsteam (releases), godotsteam.com/blog, github.com/ceifa/steamworks.js + GitHub API (activity), electron/electron#42656 and ceifa/steamworks.js#50 (macOS overlay), tauri-apps/tauri#6196 (Tauri overlay), docs.godotengine.org (RichTextLabel/BBCode, exporting_for_macos + PR #64207 rcodesign), unity.com/blog/unity-is-canceling-the-runtime-fee, angry-shark-studio.com UI Toolkit vs UGUI 2025, partner.steamgames.com macOS requirements + steamcommunity Steamworks announcement (64-bit/notarization, entitlements), defold.com/extension-steam, ebitengine.org/en/documents/steam.html, strayspark.studio Bevy-2026 and thisweekinbevy (Bevy 0.18 maturity), LauraWebdev/GodotSteam_CSharpBindings + craethke fork (C# lag), wiki.facepunch.com/steamworks and kb.heathen.group/steam (Steamworks.NET vs Facepunch).

## Options evaluated

### Web tech: TypeScript + Electron (+ optional PixiJS) + steamworks.js — fit 9/10

**Steam integration:** steamworks.js (ceifa/steamworks.js): Rust-based N-API bindings, prebuilt binaries on npm, full TypeScript definitions, Electron/NW.js/Node support. Not archived; last push Apr 2026, 613 stars, 67 open issues, effectively single-maintainer (the 'not maintained' quote in its README refers to greenworks, the legacy alternative). Covers achievements, cloud, auth tickets, matchmaking/lobbies, workshop, overlay activation. KNOWN HARD LIMIT: Steam overlay does not work on macOS for Electron apps at all (electron/electron#42656, ceifa/steamworks.js#50) and only works on Windows with --in-process-gpu plus repaint caveats — architectural multi-process browser limitation, not fixable by config. Tauri alternative is immature: only tauri-plugin-hal-steamworks v0.0.4 on crates.io, and the Steam overlay cannot hook Tauri's system webview (tauri-apps/tauri#6196); Electron/NW.js are the only frameworks the established JS Steam bindings officially support (webgamedev.com/publishing/desktop).

**Pros:**
- Maximum dev velocity for THIS dev: reuses TypeScript/Node/Postgres end-to-end; shared types/validation between client and game server (socket.io/tRPC/zod), hot reload, Chrome DevTools
- Best-in-class UI tooling for a chat-heavy game: HTML/CSS/React (or Svelte/Solid) gives rich text, emoji, virtualized scrollback (react-virtuoso), tooltips, theming, accessibility — strictly better than any game-engine UI system for this genre
- Proven shipping path: CrossCode (NW.js, 93% positive, 10k+ reviews) and shapez (Electron, Overwhelmingly Positive) shipped Win/macOS/Linux on Steam this way; gamedevjs.com and overactiongamestudio.com publish current Electron+steamworks.js pipelines
- Strategic bonus unique to this route: same codebase can ship a free browser version to seed the multiplayer player base (Town of Salem itself started as a browser game); social deduction games live or die on concurrent players
- Server stays 100% TypeScript/Node on his own Linux boxes — server-authoritative design needs no Steam networking at all (plain WebSockets), so the weakest parts of Steamworks bindings are irrelevant
- electron-builder automates macOS signing/notarization (with known entitlements: disable-library-validation + allow-dyld-environment-variables required for the Steamworks dylib per Valve docs)

**Cons:**
- Steam overlay broken on macOS, flaky on Windows — friend invites must flow through the Steam client launching the game with a connect arg rather than Shift+Tab; some players notice and complain
- Electron macOS notarization/hardened-runtime is a documented pain (electron-builder issues #3989/#4040: every nested binary must be signed, entitlements-inherit required) — solvable, well-trodden, but a real day or two of yak-shaving
- ~250 MB download and 'it's Electron' perception/memory overhead; mostly cosmetic for this genre
- steamworks.js bus factor: one maintainer, 67 open issues; mitigations exist (forks like ai-zen/steamworks.js, or raw steamworks-rs via a small native module)
- If the game later grows real-time gameplay (animations beyond CSS/PixiJS, particles, shaders), engine features must be hand-assembled from npm parts
- No engine-experience résumé value; future console ports would require a rewrite (Steam-only plan makes this moot for now)

### Godot 4 + GDScript + GodotSteam — fit 7/10

**Steam integration:** GodotSteam is the strongest open-source Steamworks binding of any engine: GDExtension 4.19.1 released 2026-05-29 already tracking Steamworks SDK 1.64 (released ~2 weeks prior), supports Windows/Linux/macOS, drop-in via Asset Library, includes auto-update checker. Active development moved from GitHub (archived 2026-05-23) to Codeberg (codeberg.org/godotsteam/godotsteam) — a hosting move, not abandonment; godotsteam.com has dedicated tutorials including Mac export. Near-complete Steamworks API coverage.

**Pros:**
- Free, MIT-licensed, no revenue caps, no company risk of Unity-style license whiplash
- Control-node UI system is the best among real game engines for menus/lists/themes; RichTextLabel has BBCode, its own scrollbar, append_text() incremental parsing and a Threaded mode for chat logs (docs.godotengine.org BBCode guide explicitly discusses multiplayer chat, including sanitizing user BBCode injection)
- macOS export is first-class: export dialog has built-in codesign + notarization integration including rcodesign, which signs/notarizes from Linux/Windows without a Mac (godotengine PR #64207)
- Server can stay TypeScript/Node: Godot's WebSocketPeer client talks to his existing stack, so only the client is 'new territory'
- GDScript is a small Python-like language — days, not months, for a strong TS dev; enormous tutorial ecosystem; lightweight editor, fast iteration
- Future-proof: if the game grows animations/minigames/juice, the engine absorbs it; Linux export trivially covers Steam Deck

**Cons:**
- Whole-engine learning curve (scenes, nodes, signals, themes) before first pixel of real product — weeks of ramp-up a web stack wouldn't need
- Chat UI is achievable but clunkier than DOM: RichTextLabel stutters on thousands-of-lines logs without the documented workarounds; no CSS, no virtualized-list library, theming system is its own skill
- GDScript is dynamically typed and tooling (refactors, LSP) is weaker than TypeScript's; code can't be shared with the Node server — game rules logic gets duplicated or moved fully server-side
- No browser-demo synergy with a native-feeling codebase (Godot web export exists but is heavy and C#/web export still unsupported)
- Asset-store ecosystem smaller than Unity's, though largely irrelevant for a UI-first game

### Godot 4 + C# (.NET) + GodotSteam C# bindings — fit 6/10

**Steam integration:** Same excellent GodotSteam core, but the C# layer lags: LauraWebdev/GodotSteam_CSharpBindings targets GodotSteam 4.6.1 / Godot 4.4+ and hasn't tracked GodotSteam 4.11+ — a community fork (craethke/GodotSteam_CSharpBindings) carries updated bindings. Workaround: call the GDExtension directly from C# via Godot's cross-language Call() per godotsteam.com/tutorials/c-sharp (works but loses typed API). steam-multiplayer-peer-csharp exists for Steam transport but is irrelevant given his own servers.

**Pros:**
- C# is statically typed and closer to TypeScript ergonomics than GDScript; Rider/VS tooling is excellent
- All Godot UI/export strengths from the GDScript option apply
- Larger transferable-skill payoff (C# also unlocks Unity/MonoGame later)

**Cons:**
- Steam bindings are the weakest link: official-ish C# bindings version-lag the rapidly-updated GodotSteam, forcing a fork or untyped Call() interop — ongoing friction for the project's most Steam-critical dependency
- C# is still a new language for this dev (async model, .NET project system) on top of the engine learning curve
- Godot's C# path has historically trailed GDScript in docs/tutorials and platform support (no web export), so community answers often need translation from GDScript
- No code sharing with the Node server, same as GDScript

### Unity 6 + Steamworks.NET (or Facepunch.Steamworks) — fit 5/10

**Steam integration:** Most mature Steam ecosystem of any engine. Steamworks.NET: faithful 1:1 wrapper of Valve's C++ API, decades of community guidance apply directly, broad third-party tooling (Heathen's Toolkit at kb.heathen.group/steam). Facepunch.Steamworks: idiomatic C# re-interpretation, shorter code, but diverges from Valve docs and tooling, maintenance historically spottier. Known macOS notarization recipes exist (Steamworks.NET issue #305, yemi.me Unity-Steam-macOS guide). Either binding fully covers auth/achievements/rich presence.

**Pros:**
- Deepest asset store and largest community; an answer exists for everything
- Steamworks.NET is the de-facto industry standard binding; lowest Steam-integration risk of all options
- Town of Salem 2 itself is a Unity game — direct genre precedent
- Runtime Fee cancelled (Sep 2024); Unity Personal free to $200k revenue/funding, splash screen optional in Unity 6 — licensing risk for a solo dev is currently low (unity.com/blog/unity-is-canceling-the-runtime-fee)

**Cons:**
- UI is the project's core and Unity's UI story is split: UI Toolkit is the recommended modern path for chat/data-heavy UIs but still has documented runtime gaps in 2025 — scroll-view behavior pain, no built-in runtime tooltips or drag-drop (Angry Shark Studio 2025 guide, Unity UI Toolkit status threads); uGUI is mature but verbose and dated, with TextMeshPro confined to uGUI
- Heaviest learning curve here: large opaque editor, C# (new language), prefab/serialization model, slow domain reloads — worst dev-velocity match for a web-native solo dev
- Closed source; company strategy risk (post-runtime-fee trust damage, 5% Pro price rise Jan 2026) even though Personal terms are fine today
- Engine is overkill: 3D-capable runtime, longer build times, larger baseline complexity for a game that is lobby + chat + timers
- No code sharing with Node server; no browser-demo synergy comparable to web stack

### Others (brief): Bevy, MonoGame, Defold, Ebitengine — fit 3/10

**Steam integration:** Bevy: steamworks-rs / bevy_steamworks exist and Rust bindings are solid, but engine UI is the blocker. Defold: official, actively maintained extension-steam with hand-written Lua bindings (defold.com/extension-steam), macOS dev requires copying Steam dylibs to /usr/local/lib for editor runs. MonoGame: uses Steamworks.NET directly — binding fine, everything else manual. Ebitengine: official Steam shipping guide (ebitengine.org/en/documents/steam.html) but go-steamworks 'has not yet implemented most of the API'; macOS requires manual .app assembly, notarization, and ditto-zip quirks; known Steam-launch hang and overlay issues (ebiten #3181, #3338).

**Pros:**
- Defold is the most credible of the four: tiny runtime, official Steam extension, good 2D, free with no revenue share
- Bevy 0.18 (Mar 2026) shows real momentum — first editor preview, bevy_feathers widgets — for anyone already in Rust
- MonoGame and Ebitengine offer total code-level control with no engine lock-in

**Cons:**
- Bevy: Rust learning curve is the steepest possible jump from TypeScript; bevy_ui remains low-level for a rich chat UI (community consensus still patches it with egui/sickle_ui) — wrong tool for a UI-first game in 2026
- MonoGame: no UI system at all — chat, scrollbars, tooltips, text layout all hand-rolled or via third-party libs; macOS packaging fully manual; worst-case velocity
- Defold: gui system is built for HUDs, not thousand-line rich-text chat scrollback; Lua + smaller community; ecosystem thin for this genre
- Ebitengine: minimal immediate-mode drawing, Go UI ecosystem nearly empty, go-steamworks API coverage explicitly incomplete, fiddly macOS/Steam quirks
