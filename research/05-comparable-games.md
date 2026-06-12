# Comparable Games — Post-mortems & Lessons

### Town of Salem (2014)

**Stack:** Originally Adobe Flash browser client + Steam wrapper; custom PHP/phpBB web backend (the forum software became the breach vector). Ported to Unity 2019-2020 when Flash died: Steam Unity client Oct 28, 2019; browser client re-released as Unity WebGL May 28, 2020. Funded by a $17,190 Kickstarter (Feb 2014, $15k goal); released Dec 15, 2014. Mobile (Unity) Oct 2018.

**Outcome:** Player lifecycle: huge web population (7.6M+ registered accounts by 2018) plus Steam all-time peak 3,687 CCU (Jan 2018). Dec 2018: data breach of 7.6M accounts (>95% of registered users) via phpBB forum vulnerabilities + admin password reuse; exposed usernames, emails, weakly-hashed (MD5/phpass-class) passwords — 27% cracked quickly — IPs, partial payment data. Breach went unacknowledged until Jan 2019; attackers persisted in the network for an extended period and compromised creds still authenticated months later (inadequate forced resets); likely GDPR violations. Weeks before the breach disclosure (Nov 3, 2018) the free web version moved to a paid model, officially to combat spam/bot attacks. The game is still alive 11+ years on but tiny: ~97 CCU current, ~101 30-day average (June 2026), stable in the 90s. Sustained by: cheap one-time price (~$4.99) + Coven DLC (2017) + cosmetic Town Points economy, and by being the canonical browser-accessible Mafia implementation for years. Sources: haveibeenpwned.com/breach/blankmediagames, bleepingcomputer.com 27%-cracked article, en.wikipedia.org/wiki/Town_of_Salem, steamcharts.com/app/334230.

**Lessons:**
- Forum/CMS software bolted onto a game account database is an attack surface: phpBB, shared admin passwords, and weak hashing turned a small indie into a 7.6M-account breach.
- Slow disclosure (breach Dec 13, discovered publicly via DeHashed in Jan) and not forcing password resets did lasting reputation damage that outweighed the technical fix.
- Engine-platform risk is real: betting on Flash forced a full Unity rewrite mid-life; the rewrite consumed dev capacity that could have gone to content.
- Switching a F2P web game to paid (anti-bot rationale) cut off the new-player funnel that deduction games depend on.
- A 15-player deduction game can survive a decade at ~100 CCU if matchmaking pools concentrate in a few modes and the price of keeping servers up is low.

### Town of Salem 2 (2023)

**Stack:** Unity, BlankMediaGames LLC. Early Access on Steam May 26, 2023; 1.0 Aug 25, 2023. Later on Epic Games Store (free-game-of-the-week promotion April 2024) and mobile (iOS app late 2023).

**Outcome:** Launched paid; all-time Steam peak only 3,022-3,755 CCU (May/June 2023) — i.e., the sequel never exceeded the original's 2018 peak. Sharp 26.9% drop June→July 2023. Went free-to-play Sept 15, 2023 with an energy-gate: free players get 1 'key' per 8 hours (max 5 banked), one key per match; pre-F2P buyers got a 'Super Deed' unlock. F2P did NOT recover the population — recent-review sentiment fell to ~40% positive, with complaints about ramped-up MTX including the Cauldron loot box with gacha mechanics, and 'less playercount than launch even after going free to play.' Current state: ~263-333 CCU, ~273 30-day average (June 2026). Community threads titled 'Town of Salem 2 is on its way out.' Sources: steamcharts.com/app/2140510, steamcommunity.com F2P announcement and discussions.

**Lessons:**
- A sequel splits an already-small deduction population across two games; ToS1 + ToS2 combined are under 400 CCU.
- Energy/key gating is poison for a genre that needs warm bodies in lobbies — limiting free matches directly starves matchmaking.
- Going F2P after charging early adopters generated resentment twice: buyers felt burned, free players felt nickel-and-dimed by loot boxes.
- F2P conversion cannot resurrect a game whose population already fell below the matchmaking-viability threshold; the funnel must be open from day one.

### Among Us (2018)

**Stack:** Unity (C#), Innersloth (3-5 person team at launch). Custom lightweight networking ('Hazel' UDP library); architecture was lobby-host-authoritative (one player's client runs game logic) with Innersloth relay/matchmaking servers — effectively peer-hosted logic. Free on iOS/Android, $4.99 on Steam (June 2018 PC). After the 2020 explosion Innersloth partnered with Unity: Multiplay hybrid dedicated-server hosting (30+ bare-metal providers + 4 clouds, 99.95% SLA), Unity Analytics, Vivox. Connected 500M+ lifetime players on this infra.

**Outcome:** Near-dead at launch (double-digit CCU through 2018-2019; Innersloth kept updating anyway). Mid-2020: Twitch/YouTube streamers ignited it; featured on Steam Aug 2020; >1M DAU, doubling in 9 days, eventually 8-digit DAU; ~500M MAU at the Nov 2020 peak; Steam all-time peak 438,524 CCU (Sept 2020). Revenue: $24.5M in Oct 2020 alone; ~$86M in first three years; $100M+ lifetime — from a $5 PC price plus mobile cosmetics/ads. Cheating crisis Oct 2020: 'Eris Loris' spam attack hit ~1.5M games / ~5M players (pro-Trump + YouTube-sub spam) by exploiting the trust-the-host/client architecture; emergency server update pushed; accelerated server-authority work. Free mobile + no accounts made ban evasion trivial, so: Quick Chat for accountless guests, full account system March 31, 2021 (free chat requires account; bans extend to alts), cross-device accounts Nov 2021, plus in-game reporting categories. Long tail: ~20M MAU and 2.5-2.9M DAU in 2025; Steam ~7.2k 30-day average CCU, ~10k current, monthly peaks ~20k (early 2026) — cyclical spikes with updates/sales. Among Us 3D launched 2025 as a separate SKU. Sources: unity.com/resources/innersloth-among-us, multiplayunity.medium.com case study, kotaku.com & engadget.com Eris Loris coverage, among-us.fandom.com/wiki/Account, steamcharts.com/app/945360, blog.udonis.co player-count report.

**Lessons:**
- Peer-hosted/host-authoritative networking is fine for 50 CCU and catastrophic at 1M DAU: no server validation meant one person with a dozen volunteers could spam 1.5M lobbies.
- Account systems can be retrofitted (took ~6 months) but moderation debt compounds; guest-mode-with-Quick-Chat was the pragmatic bridge for child safety + ban evasion.
- Streamability (simple visuals, 10-player lobbies, betrayal moments) is the single biggest acquisition channel this genre has; the game changed nothing in 2020 — streamers found it.
- Keep shipping while dead: Among Us survived two years of obscurity because the team was tiny and costs were near zero.
- $5 one-time on PC + free-with-cosmetics mobile monetized 500M players without poisoning goodwill; they cancelled Among Us 2 and reinvested in the original.
- Buying scaling (Unity Multiplay) instead of building it let a 5-person team survive a 10,000x load spike.

### Throne of Lies: Medieval Politics (2017)

**Stack:** Unity 3D, Imperium42 (husband-and-wife founders Dylan & Elsa Hunt, Las Vegas/Taiwan). Kickstarter Jan-Feb 2017: $21,795 from 393 backers ($20k goal). Launched Steam Sept 2017 at $9.99; upgraded to Unity 2018 mid-life (introduced gamebreaking bugs); F2P relaunch Dec 23, 2020.

**Outcome:** ~500k activations lifetime; all-time peak just 1,381-1,382 CCU (May 2019). Single active developer on an indie budget; activity concentrated into one daily window (~7pm EST) as population shrank. F2P relaunch in Dec 2020 — riding the Among Us wave — failed to flourish. Community cited heavy-handed community management as a retention factor. Current: 30-day average ~1.2 CCU, peaks of ~13 (June 2026) — functionally dead, servers still up. Sources: steamcharts.com/app/595280, kickstarter.com Imperium42 campaign, gamespress.com F2P announcement, steamcommunity.com app/595280 discussions.

**Lessons:**
- $10 paid entry + niche theme + small marketing = never reached critical mass; the all-time peak (~1.4k) was already marginal for 10-16-player lobbies.
- When CCU drops, surviving communities self-organize into scheduled play windows — a death-spiral symptom worth instrumenting for.
- F2P conversion done after the population collapsed recovers nothing (same lesson as ToS2).
- Moderation style is a retention variable: in small communities, perceived unfair community management churns the regulars who keep lobbies alive.
- 3D production values added cost but not retention vs. 2D competitors.

### Feign (2021)

**Stack:** Unity (PC + Android/iOS), Turkish studio Teneke Kafalar, later published with Kwalee. Built-in lobby voice chat. Steam Early Access Oct 23, 2021 at ~€4.99 (~$5); $1.99 on Android. 12-player Innocents/Impostors/Neutrals format with werewolf-style night roles.

**Outcome:** Modest but unusually durable mid-tail: all-time peak 2,688 CCU (Dec 2021), and still ~97-150 CCU with spikes to ~434 in June 2026 — i.e., four-plus years later it retains a higher share of its peak than most genre peers. Periodic resurgences (Nov 2025 +77% month) track Turkish streamer waves; very strong regional (Turkey) identity and 14-language localization. ~4,810 Steam reviews, 91% positive. Sources: steamcharts.com/app/1436990, store.steampowered.com/app/1436990, tenekekafalar.com/feign.html, steamspy.com/app/1436990.

**Lessons:**
- Owning one regional/language community (Turkey) gives a small deduction game a defensible lobby population that global also-rans lack.
- Built-in voice chat keeps casual groups inside the game instead of fragmenting into Discord-only private lobbies.
- Cheap one-time price (~$5) with high review score sustains a slow steady funnel; recurring streamer spikes re-seed the population.
- A 12-player game idling at ~100 CCU concentrated in one region/timezone still fills lobbies; the same 100 CCU spread globally would not.

### Goose Goose Duck (2021)

**Stack:** Unity, Gaggle Studios (NY). Free-to-play from launch (Oct 2021). Built-in voice chat including proximity voice — its key differentiator vs Among Us. Easy Anti-Cheat added to combat ESP/speedhack cheats. Monetization: cosmetics + 'Flight Pass' battle pass; ~$21.5M revenue in 2024. Separate China mobile version launched Jan 2026 (crashed on day one under load).

**Outcome:** The genre's second viral event: BTS member Kim Taehyung (V) streamed it Nov 2022 → explosion in China → Steam servers crashed twice under the surge → all-time peak 701,898-703,000 Steam CCU (Jan 12, 2023), beating Among Us's Steam record; ~800k CCU including mobile. Chinese streaming platforms restricted GGD streams after players used politically sensitive handles (Jan 2023). Post-peak decline was steep but landed on a real plateau: ~40k peak Jan 2024, ~37k Oct 2024, ~8.3k current / ~3.9k 30-day average with 13k monthly peaks (June 2026) — still the second-most-populated game in the genre. Sustained by constant cosmetic events, the battle pass, voice-first casual play, and the China mobile launch. Sources: gamedeveloper.com 800k article, dualshockers.com record article, newsletter.gamediscover.co/p/how-goose-goose-duck-hit-700k-ccu, steamcharts.com/app/1568590, technode.com China-launch article, rfa.org stream-restriction article.

**Lessons:**
- F2P + built-in proximity voice out-executed the incumbent: zero price friction plus not needing Discord captured the casual wave Among Us created.
- Celebrity/streamer ignition (one BTS stream) can 100x a population overnight — and infrastructure must absorb it or the moment is wasted (servers crashed twice; they apologized and scaled).
- China concentration is high-beta: it created the record peak, brought platform-censorship interference, and its retreat caused most of the crash; they re-bet on it with a localized mobile launch.
- F2P deduction games attract industrial-scale cheating (public ESP/radar tools); EAC became necessary — a cost paid only because the game was big enough to matter.
- Live-ops cadence (events, Flight Pass, cosmetics) is what separated its ~$21.5M/yr plateau from peers that fell to double-digit CCU.

### Project Winter (2019)

**Stack:** Unity, Other Ocean Interactive (established work-for-hire studio). Paid title (~$19.99) + cosmetic DLC packs (e.g., Blackout DLC); released May 23, 2019 after Early Access; Xbox Game Pass (2021) with crossplay; Switch port. 8-player survival + social deception hybrid with integrated voice chat (proximity + radio). Partnered with Modulate to trial ToxMod ML voice moderation after acknowledging rising toxicity.

**Outcome:** Steady mid-size population for years (peaks ~2,865 CCU as late as Aug 30, 2024; Game Pass drove console/crossplay population). Notable as an early adopter of automated voice moderation — devs publicly posted 'Addressing Community Toxicity' and deployed ToxMod trials because voice-first deception games concentrate abuse. Despite a 2025 roadmap and a 'Cabin Fever / Project Winter 2.0' relaunch attempt (Sept 2025, brief spike to ~686 avg), population collapsed: ~11-14 CCU, -48% month-over-month (June 2026) — below matchmaking viability for an 8-player game. Sources: steambase.io/games/project-winter/steam-charts, store.steampowered.com/news/app/774861 (toxicity post, 2025 roadmap), en.wikipedia.org/wiki/Project_Winter, trueachievements.com Game Pass coverage.

**Lessons:**
- Survival-mechanics + deduction hybrid raises match length and skill floor, shrinking the casual funnel the genre needs.
- Voice-required deception gameplay concentrates toxicity; Other Ocean's ToxMod partnership shows the moderation burden is heavy enough that studios outsource it to ML.
- Game Pass inclusion buys population temporarily but it evaporates when the catalog rotates.
- A '2.0' relaunch update (Sept 2025) produced only a one-month spike — content drops cannot fix a structurally depleted matchmaking pool.
- $20 price point is hostile to the 'bring 7 friends' acquisition loop this genre runs on.

### Blood on the Clocktower — official digital (botc.app)

**Stack:** Browser-based web app (Windows/Mac/Linux, all major browsers), official app developed under The Pandemonium Institute; release repo on GitHub (ThePandemoniumInstitute/botc-release). Integrated audio/video: microphone required, camera optional. No matchmaking algorithm — games are human-run: a Storyteller (referee with full grimoire access and private-chat visibility) hosts public or private (link/code) games; spectator seats; private whisper chats with neighbor animations; hand-raising for nominations.

**Outcome:** Long Patreon-gated beta ('under construction' for years, community 'arriving early'); now free to play with optional Patreon membership unlocking avatar cosmetics and supporting development; Patreon also gates the official Discord/early access. The digital app deliberately complements a premium physical product (~$130+ board game) rather than replacing it. Coexists with a free open-source unofficial tool, clocktower.online (bra1n/townsquare on GitHub) — a virtual grimoire/town square used with Discord/Zoom voice — which the publisher tolerates. Population is not Steam-trackable but the game's online community (Patreon, Discord, public game listings across languages/difficulties) is active and growing; the BGG consensus treats it as the best-in-class social deduction design. Key structural difference: every game needs a trained human Storyteller, which caps scale but near-eliminates the dead-lobby and moderation problems — the Storyteller is the moderator. Sources: botc.app, release.botc.app, beardytas.com/botc-app-instructions, patreon.com/cw/botconline, github.com/bra1n/townsquare, bloodontheclocktower.com.

**Lessons:**
- Human-hosted games (Storyteller model) trade scalability for quality: no matchmaking death spiral because games are scheduled social events, and moderation is built into the role.
- Free digital app as marketing for a premium physical game + Patreon-for-cosmetics is a viable model that avoids MTX resentment entirely.
- Web-native (browser + WebRTC-style AV) removes install friction for a 10-20 player game where one reluctant friend not installing kills the night.
- Tolerating a free open-source community tool (clocktower.online) grew the online scene during the years the official app wasn't ready.
- Patreon-gated beta built a paying community before launch and funded multi-year development without a publisher.

### EpicMafia (2008) → UltiMafia

**Stack:** EpicMafia: custom web app (live chat-based mafia), created Jan 2008, run by 'lucidrains'; volunteer moderators; free. Successor UltiMafia (fork launched June 12, 2023): open-source MERN stack — React frontend, Node.js/Express with websockets, MongoDB + Redis — github.com/UltiMafia/Ultimafia, volunteer-run, free, community-driven with deep role/setup customization.

**Outcome:** EpicMafia ran 13 years as the definitive browser mafia site and the proving ground for competitive setups (Town of Salem borrowed heavily from this lineage). It died socially, not technically: in March 2021 moderators were outed for predatory/pedophilic behavior; a moderator ('Charley') self-deleted after deleting banned users' posts, completing a collapse of governance; owner lucidrains shut the site permanently on March 20, 2021, refusing buyout offers. Community recreations followed; UltiMafia is the active successor as of 2025, sustained by open-source contributors and volunteer moderation. Sources: epicmafia.fandom.com/wiki/The_Death_of_EpicMafia, github.com/UltiMafia/Ultimafia, ultimafia.com.

**Lessons:**
- Anonymous-volunteer moderation with absentee ownership is an existential risk: EpicMafia was killed by moderator misconduct and governance collapse, not by technology or population loss.
- Long-lived deduction communities accumulate child-safety liability — text chat + minors + anonymous adults requires real trust-and-safety, even for a hobby site.
- A devoted community will rebuild the platform (UltiMafia, open-source) if the code/concept is replicable — the durable asset is the ruleset and community, not the site.
- MERN + websockets is entirely sufficient tech for text-based real-time mafia; the hard part is governance.
- Refusing to sell and hard-killing the site destroyed 13 years of community capital overnight — succession planning matters for community platforms.

### werewolf.chat (lykos IRC) / Mafia.gg / werewolv.es — small web implementations

**Stack:** werewolf.chat: MediaWiki documentation hub for 'lykos', an open-source Werewolf IRC bot (Python, GitHub); games run in #werewolf on irc.libera.chat and other IRC networks — pure text, zero hosting cost beyond the bot. Mafia.gg: free browser SPA (JS client-rendered; page serves no static content to crawlers) offering real-time lobbies, chat, role customization, spectating, host controls for private groups. werewolv.es: free browser Werewolf with live community games, long-form and 'turbo' formats. Also Discord-bot mafia and forum mafia (e.g., Mafia Universe community) as adjacent zero-infrastructure formats.

**Outcome:** These survive indefinitely at tiny scale because their costs round to zero and their communities self-host the social layer. lykos's wiki shows only moderate activity (last notable edit 2023) but the IRC games continue across multiple networks; leaderboards and quote databases indicate an entrenched micro-community. Mafia.gg persists as a private-group tool — players bring their own group, so it has no matchmaking-pool problem. None monetize meaningfully; none died of population collapse because they never depended on strangers-matchmaking. Sources: werewolf.chat (lykos wiki), mafia.gg, werewolv.es, forums.online-go.com forum-werewolf threads.

**Lessons:**
- Bring-your-own-group tools are immune to the population death spiral — the existential risk of matchmade deduction games simply doesn't apply.
- Text-only/IRC/Discord-bot implementations prove the genre's floor cost is ~zero; a web deduction game competes against free forever.
- Hostable private-lobby tooling (role customization, host controls, spectating) is the feature set that retains organized communities.
- These platforms cap out small: no onboarding funnel for strangers means no growth, the mirror image of the matchmade games' problem.

## Monetization patterns

What worked: (1) Cheap one-time purchase on PC + free mobile with cosmetics — Among Us's $4.99 + cosmetics/ads/Stars currency generated $86M in three years and $100M+ lifetime with near-zero goodwill damage; the low price preserved the 'convince 9 friends to buy it' loop. (2) F2P from day one + cosmetics + battle pass + built-in voice — Goose Goose Duck rode zero price friction to a 703k CCU record and still cleared ~$21.5M in 2024 on cosmetics and its Flight Pass, funding the live-ops cadence that keeps it the #2 survivor. (3) Free digital client as a funnel for a premium physical product + Patreon patronage for cosmetics/early access — Blood on the Clocktower's botc.app is free, monetizing fandom rather than gameplay, with human Storytellers eliminating per-match server-moderation costs. (4) Modest price + strong regional community — Feign's ~$5 sustains a small studio off one loyal market. What poisoned the well: ToS2's late F2P pivot with an energy/key system (1 free match-key per 8 hours) plus gacha loot boxes ('Cauldron') — energy gates directly starve the lobby population the genre lives on, and converting paid early adopters to F2P-with-MTX burned both audiences (40% positive recent reviews). Charging $10-20 upfront for an unknown deduction game (Throne of Lies at $9.99, Project Winter at $19.99) suppressed the initial population below critical mass; both games' later F2P/relaunch attempts failed because conversion after the pool collapses recovers nothing. ToS1's switch of its free web client to paid (Nov 2018, anti-bot rationale) closed its funnel. Pattern: monetization must never gate match participation or group acquisition; cosmetics, patronage, and a sub-$5 entry are the only models with surviving examples.

## Pitfalls (cross-cutting)

- Population death spiral: deduction needs 7-16 players per lobby, so matchmade games have a hard CCU floor (~a few hundred globally, less if concentrated in one timezone). Below it, queues lengthen, casuals leave, and collapse is self-reinforcing — Throne of Lies (1.4k peak → 1 CCU), Project Winter (2.9k → 11), ToS2 (~3k → ~270). Symptoms appear early as 'the game is only alive at 7pm EST' scheduling.
- Sequels and spin-offs cannibalize the same fixed pool: ToS1+ToS2 combined hold under 400 CCU; Innersloth cancelled Among Us 2 and reinvested in the original — the correct call.
- Cheating amplified by friends-in-voice-chat and client trust: Among Us's host-authoritative/peer-hosted architecture let the Eris Loris attack spam ~1.5M lobbies in three days; F2P titles (GGD) attract commercial ESP/radar/speedhack tools requiring Easy Anti-Cheat; private-info leakage via out-of-band Discord voice is unsolvable technically and must be absorbed by design (built-in voice, proximity chat, private-lobby culture).
- Free accounts = trivial ban evasion: Among Us needed Quick Chat for guests, then a full account system (Mar 2021) with alt-account bans; ToS1 made its web version paid specifically against bot/spam floods. Plan identity/abuse infrastructure before going F2P.
- Account security and web-stack debt: ToS1's 7.6M-account breach came from phpBB forum software, admin password reuse, weak hashing, slow disclosure, and no forced resets — the company nearly defined GDPR-era negligence for indies. Any auxiliary web surface (forums, wikis) shares blast radius with the game DB.
- Toxicity/moderation burden scales worse in voice-first deception games: Project Winter publicly partnered with Modulate ToxMod (ML voice moderation); werewolf communities burn out volunteer mods. EpicMafia is the terminal case — the site died in 2021 from moderator predatory misconduct and governance collapse, not load or money. Text+minors+anonymous adults = real trust-and-safety obligations.
- Virality is also a stress event: GGD's Steam servers crashed twice during its BTS/China surge and its China mobile launch crashed on day one; capacity must be elastic (Among Us bought Unity Multiplay rather than building).
- Geo-concentration risk: GGD's record peak was mostly China and so was its crash; Chinese platforms restricted its streams over politically sensitive player handles.
- Engine/platform mortality: Flash EOL forced ToS1's full Unity rewrite; Throne of Lies's Unity 2018 upgrade shipped gamebreaking bugs. Mid-life engine migrations consume the content budget that retention requires.
- Energy gates, loot boxes, or any pay-per-match friction directly attack lobby liquidity — ToS2's key system is the canonical self-inflicted wound.

## Success factors (cross-cutting)

- Streamability is the genre's acquisition engine: Among Us 2020 (Twitch) and Goose Goose Duck 2022-23 (one BTS member's stream) were both ignited by streamers, not marketing. Design for spectacle: readable 2D art, betrayal reveals, short rounds, clippable moments. Feign's periodic Turkish-streamer waves repeatedly re-seed its population.
- Built-in voice (especially proximity voice) is now table stakes: GGD's voice-first design out-executed Among Us; Feign and Project Winter shipped it; BotC requires a mic. It keeps casual groups in-game instead of losing them to Discord and lowers the friend-group assembly cost.
- Survive the quiet years cheaply: Among Us's 3-5-person team kept shipping for two dead years before the explosion; ToS1 persists 11 years at ~100 CCU because costs are tiny. Low burn is a strategy.
- Buy infrastructure, don't build: Unity Multiplay (30+ bare-metal + 4 cloud providers, 99.95% SLA) absorbed Among Us's 10,000x spike for a team of five; GGD scaled after crashing; the lesson is elastic capacity ready before the viral moment.
- Live-ops cadence sustains the plateau: GGD's events/cosmetics/Flight Pass keep it at thousands of CCU and ~$21.5M/yr while content-starved peers fell to double digits.
- Bring-your-own-group and human-hosted models are death-spiral-proof: BotC's Storyteller-run scheduled games, Mafia.gg/Discord-bot private lobbies, and IRC lykos games never depend on stranger matchmaking — they cap small but never die. A hybrid (matchmaking + first-class private/community hosting tools) hedges the population risk.
- Community ownership extends life beyond the company: open-source UltiMafia (MERN) resurrected EpicMafia's community; clocktower.online (open-source grimoire) carried BotC online before the official app. Moddability/hostability converts players into infrastructure.
- Regional/language community depth beats shallow global reach for small titles: Feign's Turkey-centric population fills lobbies at CCU levels that would be fatal if globally dispersed; localization (14 languages) is cheap insurance.
- Zero or near-zero entry price keeps the group-acquisition loop alive: every surviving title is free or under $5; every $10+ title in the genre is dead.
- Account systems, reporting, and (for voice games) ML moderation tooling are retention features, not compliance overhead — toxicity churns exactly the casual majority the lobbies need; Among Us's accounts/Quick Chat and Project Winter's ToxMod trial mark the genre's minimum bar.
