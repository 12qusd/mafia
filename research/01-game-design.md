# SC2Mafia — Game Design Dossier

How the original game works, as researched from the SC2Mafia wiki and community sources.
All descriptions are paraphrased mechanics; see BUILD_SPEC.md §2.1 for the rule that all
player-facing text in our implementation must be original.

## Core loop

SC2Mafia (custom SC2 Arcade map by Dark.Revenant, ~15 players, direct ancestor of Town of Salem) alternates three cycles: DAY, LYNCH (trial), and NIGHT. SETUP: host configures the game in a pre-game setup phase (players can vote -repick to replace host, -default to force the 'Setup of the Day'); then a naming phase where players pick names (-Name) or get random ones; roles are then secretly assigned. DAY CYCLE (1-6 min, host-set): all living players talk in public chat, share findings, whisper (-pm), and after an optional no-vote 'Discussion' period (30s-3min) vote to lynch via vote buttons next to player names. Day Type options: 'Majority' (51% of votes = instant execution), 'Majority + Trial' (51% puts player on trial — the de facto standard), 'Ballot' (secret ballot, most votes executed at day end), 'Ballot + Trial'. LYNCH CYCLE: accused player gets uninterrupted defense time (Trial Defense option; trial time 30s-2min split 50/50 defense/voting; 'Trial Pauses Day' option stops the day timer so an innocent verdict lets town vote again), then everyone votes guilty/innocent; guilty = public execution (flavor variants: firing squad, electrocution, sniper, gas chamber, hanging). Lynched player's role and Last Will are revealed immediately. -skip command (50%+ of living players) skips the day. NIGHT CYCLE (30s-2min): all players submit night actions simultaneously via UI/commands; Mafia/Triad/Cult/Masons/Jailor get private night chats; Mafia votes its kill target (-target). At dawn the game reveals deaths with role + Last Will (unless janitored), plus optional Death Descriptions (weapon flavor text identifying killer type) or full Night Sequence (adds audio cues — e.g. a Mass Murderer chainsaw sound plays even if his kill failed, leaking role presence). Repeat until a faction's win condition is met. Game can start at Day, Night, or Day(No-Lynch) (the common choice; also enables Night-1 jailing). After game end all players earn points (winners more), feeding unlockables/achievements; dead players meanwhile sit in graveyard chat and can gamble points on a Russian Roulette minigame.

## Host setup system

Host picks a Variant: 'Classic' (preset: Mafioso/Consort/Citizen/Doctor/Sheriff only, no Last Wills/PMs/Trials), 'Clue' (no Last Wills, roles NOT revealed on death — Coroner becomes critical), 'Custom' (full editor: every role and option), or 'Save Slot' (reload a previously -save'd custom setup — how almost all real games are hosted; etiquette is to build the save alone offline because lobbies get impatient). The setup editor is a ROLE LIST of ~15 slots; each slot is either a SPECIFIC ROLE (e.g. Sheriff, Godfather) or a RANDOM CATEGORY slot that rolls a role from a pool: Town Government, Town Investigative, Town Protective, Town Killing, Town Power, Town Core, Town Random, Mafia Support, Mafia Deception, Mafia Killing, Mafia Random, Triad equivalents, Neutral Benign, Neutral Evil, Neutral Killing, Neutral Random, Any Random. Each category has per-role EXCLUDE toggles (e.g. 'Town Core: Exclude Citizen', 'Neutral Evil: Exclude Serial Killer'), and individual roles have 'Excluded from randoms' flags. Every role additionally has its own OPTION toggles that radically retune it, e.g.: Sheriff detects-Mafia/SK/Arsonist/Cult/MM toggles; Jailor 1/2/3/infinite executions; Vigilante shot count; Veteran alert count + ignores-invulnerability; Godfather immune-to-detection / roleblock-immune / kills-like-Mafioso; Witch 'can cause self-targets' and 'victim knows he is controlled'; Cultist conversion cooldown (1/2/3 nights) and 'immunity prevents conversion'; Survivor vest count; Mayor vote weight + 'cannot be healed'; Executioner 'becomes Jester upon failure' / 'target is always Town'; Citizen one-time bulletproof vest and 'wins 1v1 vs Mafia'. Game-level options: Day Type (4 voting modes), Night Type (Classic/Death Descriptions/Night Sequence), trial settings, day/night/discussion/trial lengths, Last Wills on/off, PMs on/off, Choose Names on/off, starting phase. The engine can EMULATE the setup (roll the randoms repeatedly) so hosts can check emergent probabilities. Constraint system: Unique roles (Godfather, Mayor, Marshall, Crier, Judge, Mason Leader, Dragon Head, Witch Doctor) max 1 alive; Mayor and Marshall mutually exclusive unless forced; 'powerless role' rules stop randoms rolling roles that would do nothing (e.g. Coroner only spawns from randoms if a Janitor/Incense Master or Clue variant is present; Framer/Forger won't roll with no Town to frame); an all-excluded Town Government slot defaults to Citizen. Players with enough points can -blacklist (up to 6) and -prefer (up to 3) roles to bias their own assignment. The most popular balance is 9 Town / 3 Mafia or Triad / 3 Neutral (1 Neutral Killing, 1 Neutral Evil, 1 Neutral Benign).

## Role catalog

### Town (uninformed majority; green) (~20 roles)

- **Citizen** — Vanilla; option for a one-night bulletproof vest and an option to win 1v1 ties vs Mafia/Triad
- **Sheriff** — Checks one player/night for alignment: 'member of the Mafia', 'Serial Killer', 'Arsonist', 'Cultist', 'Mass Murderer', or 'not suspicious' (per host detect toggles); fooled by Godfather detection immunity and Framer frames
- **Investigator** — Checks one player/night for their criminal record (crime list maps to role sets, e.g. 'Murder, Trespassing'); host option to instead reveal exact role
- **Detective** — Tracks one player/night, sees who they visited (sees FINAL post-swap visit)
- **Lookout** — Watches one player/night, sees everyone who visited them
- **Coroner** — Autopsies a dead body: learns exact role and night-by-night visit history; counter to Janitor and core of Clue variant
- **Spy** — Reads Mafia/Triad/Cult/Mason night chats anonymously (no speaker names); options to also see the Mafia kill target
- **Doctor** — Heals one player/night, negating one kill; options: knows if target attacked, prevents/detects Cult conversion; becomes Witch Doctor if converted (option)
- **Bodyguard** — Guards one player; if guarded player is attacked, attacker and Bodyguard BOTH die in a duel, target survives; at a Mass Murderer spree saves everyone and kills the MM
- **Escort** — Roleblocks one player/night, cancelling their action; some roles roleblock-immune; SK option 'kills roleblockers'
- **Bus Driver** — Swaps two players; every targeted action on one hits the other instead; can kill via redirection; chaotic dual-use protective/power role
- **Vigilante** — Night kill with host-limited shots (1-4 or unlimited); can't shoot N1; mislynches town when wrong ('Town Serial Killer')
- **Veteran** — Goes 'on alert' (limited count): automatically kills every visitor that night, optionally ignoring night immunity; roleblock-immune
- **Jailor** — During a day with no lynch, selects (-jail) a target to jail that night: target is roleblocked (ignores roleblock immunity), protected (not from Arsonist), talks with Jailor in anonymous jail chat, and may be EXECUTED (pierces all night immunity, can't be healed); host-limited executions (1/2/3/infinite)
- **Mayor** — Unique; reveals self with -vote for permanent extra votes (e.g. counts as 4); option: can no longer be healed after reveal
- **Marshall** — Unique; reveals self to trigger a group-lynch day: multiple lynches, no trials; mutually exclusive with Mayor
- **Crier** — Unique; speaks anonymously to the whole town at night (only night-talking Town role); can disrupt/expose a Judge
- **Mason / Mason Leader** — Masons share a night chat and know each other; Mason Leader (unique) recruits one Citizen per night (limited recruits), bludgeons any Cultist he targets, immune to Cult conversion; Mason can become Leader if Leader dies (option)

### Mafia (informed minority; red) (~11 roles)

- **Godfather** — Unique faction leader; final say on the night kill (-notarget possible), options for night immunity, detection immunity (reads 'not suspicious'), roleblock immunity, and killing personally when no Mafioso lives
- **Mafioso** — Basic killer; Mafiosos vote/suggest kill targets, one random Mafioso carries out the chosen kill
- **Consigliere** — Mafia Investigator: checks crimes or exact role per settings
- **Consort** — Mafia Escort: roleblocks one player/night
- **Janitor** — Sanitizes a target: if they die that night their role and Last Will are hidden from the town
- **Framer** — Frames a player: Sheriff sees them as Mafia (or a living neutral killer), Investigator gets planted crimes
- **Disguiser** — Kills a player and steals their identity/name; own Last Will left on old body (option-dependent); the dead victim appears as the Disguiser
- **Blackmailer** — Silences a player for the next day: they cannot talk (or whisper/reveal as Mayor; a blackmailed jailed target cannot answer the Jailor)
- **Beguiler** — Hides behind a target at night: anything targeting the Beguiler is redirected to that target
- **Agent** — Combined Detective+Lookout on one target (sees who they visited and who visited them)
- **Kidnapper** — Mafia Jailor: jails+roleblocks after a no-lynch day, anonymous chat, may execute (jail also protects target from the Mafia kill)

### Triad (second scum faction; blue; mirror of Mafia) (~11 roles)

- **Dragon Head** — = Godfather
- **Enforcer** — = Mafioso
- **Administrator** — = Consigliere
- **Liaison** — = Consort
- **Incense Master** — = Janitor
- **Forger** — = Framer
- **Informant** — = Disguiser
- **Silencer** — = Blackmailer
- **Deceiver** — = Beguiler
- **Vanguard** — = Agent
- **Interrogator** — = Kidnapper; only real faction difference: Triad wins ties over Mafia. Mafia and Triad can coexist in one setup as hostile rival factions with separate night chats; a Spy can't tell their kills apart

### Neutral Benign (own goals, can win with anyone) (~4 roles)

- **Survivor** — Win = just survive to game end (wins alongside any faction); gets N bulletproof vests (usually 4) usable for night immunity
- **Jester** — Win = get LYNCHED (night death doesn't count); can 'annoy' a player at night (they're told a Jester visited); on lynch, option makes one random guilty voter commit grief suicide the next night
- **Executioner** — Win = see his game-assigned target lynched (option: target always Town); option: becomes a Jester if target dies at night; option: night invulnerable
- **Amnesiac** — Converts to (remembers) the role of any DEAD player in the graveyard, inheriting that role's win condition; options restrict becoming Town/Mafia/killing; immune to Witch control and roleblock

### Neutral Evil (win = survive and see Town lose; all win with the Cult) (~7 roles)

- **Witch** — Controls one player/night, forcing their night action onto a target of the Witch's choice (can force self-targets per option); victim-knows-controlled option; can't control Amnesiacs/the dead-targeting; counts as a kill route via Veterans/killers; wins with Mafia/Triad/NK/Cult/other Witches
- **Auditor** — Converts one player/night: Town→Citizen, Mafia→Mafioso, Triad→Enforcer, non-immune Neutrals→Scumbag; cannot audit night-immune roles; targets are notified they were audited
- **Judge** — Unique; may 'call court' during the day: discussion stops, forced anonymous ballot, Judge speaks as 'Court' (everyone else 'Jury') and gets bonus votes — can single-handedly lynch late-game; also speaks anonymously at night (appears as a Crier)
- **Scumbag** — Vanilla survive-and-see-Town-lose role created only by an Auditor converting a Neutral; not host-selectable
- **Cultist** — CULT sub-faction: shared night chat, democratically votes one conversion per cooldown (1/2/3 nights); cannot convert Mafia/Triad; night immunity blocks conversion (option); Cult capped at 1/3 of original game size minus Mafia, regains a conversion per two dead Cultists; converted players keep their old appearance but join Cult chat; Mason Leader kills Cultists he visits
- **Witch Doctor** — Unique Cult support: 'heals' a player — if that player is attacked, they survive AND are converted to the Cult (limited saves); Cult win = everyone else dead or converted; Doctor/Witch converted by Cult become the Witch Doctor if none exists (options)
- **Elector (removed)** — Scrapped role: stole one player's vote and gave it to another at night

### Neutral Killing (subset of Neutral Evil; win = be last left standing; night-immune by default) (~5 roles)

- **Serial Killer** — Kills one player/night; options: night invulnerable, kills roleblockers (Escort/Jailor who releases him dies), wins-ties-over-Arsonist
- **Arsonist** — Each night either DOUSES a target in gasoline or IGNITES all doused players at once (mass kill, option ignores healing immunity); can undouse self by idling; doused players may or may not be notified (option)
- **Mass Murderer** — Stages a killing spree at a target's house: kills the target (if home, i.e. took no action) and every visitor; 1-2 night cooldown after killing 2+; Bodyguard at the scene saves everyone and kills the MM; can target self to camp his own house
- **Electromaniac** — Charges up to two players/night; if any two charged players contact each other both die; visiting a charged player kills them instantly; pierces ALL protection and immunity
- **Poisoner** — (Later addition) Poisons a player who dies some days later unless a Doctor visits them; repeat visits accelerate death; different NK roles cannot win together, but duplicates of the same NK role can

## Chat mechanics

- DAY CHAT: one public channel for all living players; the central deduction space. Dead players see everything but cannot speak to the living.
- WHISPERS / PMs (-pm color/number msg, -r to reply): private content, but PUBLIC metadata — everyone is notified 'X is whispering to Y'. Host toggle; older versions let the Spy read PMs. Critical for role-claiming to a revealed Mayor/Marshall.
- MAFIA NIGHT CHAT: all Mafia members talk privately each night and coordinate the kill via -target votes (Godfather has final say, -notarget possible). TRIAD has an identical separate chat; the two factions cannot hear each other.
- CULT NIGHT CHAT: all Cultists + Witch Doctor talk at night and vote democratically on the conversion target (ties broken randomly). A Disguiser who steals a Cultist's identity does NOT get into Cult chat.
- MASON NIGHT CHAT: Masons and Mason Leader talk privately at night (Town-aligned mirror of the Cult).
- JAILOR CHAT: Jailor (or Kidnapper/Interrogator) converses one-on-one with his jailed prisoner; the Jailor's identity is anonymized as 'Jailor'. Quirk: two Jailors jailing the same target share one chat without knowing each other's identity. Blackmailed prisoners cannot reply.
- SPY: reads Mafia/Triad/Cult/Mason night chats with speaker names hidden; option to see kill/conversion targets.
- CRIER: broadcasts anonymously to the entire town at night ('the Crier says...'). JUDGE: also speaks anonymously at night (indistinguishable from a Crier) and during his 'court' day all non-Judge chat is anonymized as 'Jury'.
- BLACKMAILER/SILENCER: target is mute the entire next day — cannot talk, and a blackmailed Mayor cannot reveal.
- DEAD CHAT (graveyard): dead players chat freely among themselves, see all hidden info, and can play the Russian Roulette points minigame (-roulette/-join/-bet/-pull/-pass). No medium-style channel back to the living (that was Town of Salem's later addition).
- LAST WILLS (-lw / -last will): up to 2 lines, editable any time while alive via a popup editor, revealed publicly on death (next dawn if night-killed, immediately if lynched). Anyone can re-read a dead player's will with -lw <number>. Convention: investigators log night results in shorthand ('N1: #7 (NS), N2: #5 (Mafia)'). Janitor/Incense Master cleaning hides role AND will; Clue variant disables wills entirely; host can disable wills.
- DEATH NOTES (-dn msg): only non-Town killing roles (incl. Witch) may write one; it is displayed next to each victim they kill — used for taunts and disinformation.
- MISC: -mute <player> client-side mute; -skip (50% of living skips day); -suicide (after day 3, kills self at night, used to dodge or to validate a Last Will posthumously).

## Win conditions

- TOWN: lynch/kill every Mafia, Triad, Cultist, Neutral Killing and hostile Neutral Evil player. Town members all win together.
- MAFIA: kill everyone who opposes them; effectively wins at parity — tiebreaker rules give Mafia the win when Mafia numbers >= Town numbers. Optional rule lets a lone Citizen beat the last Mafioso 1v1.
- TRIAD: identical to Mafia, but wins ties OVER the Mafia (1v1 order: Triad > Mafia). When both factions are in a setup they must also eliminate each other.
- CULT (Cultist + Witch Doctor): wins when every player is dead or converted — cannot win with Mafia/Triad or Neutral Killers, CAN win with other Neutral Benign/Evil roles.
- NEUTRAL KILLING (SK/Arsonist/MM/Electromaniac/Poisoner): be the last faction standing; can win with Neutral Evil (except Cult) and Neutral Benign; different NK roles can never win together but duplicates of the same role can (2 SKs can co-win).
- NEUTRAL EVIL non-killing (Witch/Judge/Auditor/Scumbag): 'survive and see the Town lose' — they ride along with whichever evil faction wins, and all of them also win with the Cult; they can also achieve rare solo wins.
- NEUTRAL BENIGN: Survivor = simply alive at game end, stacks with any winner; Jester = gets lynched (instant personal win, + a guilty voter suicides); Executioner = his assigned target gets lynched while Exe lives (becomes Jester on failure, per option); Amnesiac = inherits the win condition of whatever graveyard role he remembers (or survives without converting).
- DRAW/STALEMATE HANDLING: 'Three Days of Peace' — if nobody dies for 3 consecutive nights, day voting switches to anonymous ballot; persistent vote ties trigger re-votes until time expires, then a tiebreaker formula ends the game (Town wins if it outnumbers Mafia; Mafia wins at >= Town; Neutrals win if they outnumber Town; largest faction beats mixed Neutrals).
- ONE-VERSUS-ONE AUTO-RESOLUTION: when the game reaches 1v1 at the start of a day it auto-concludes by priority: Arsonist > Serial Killer (option can flip SK over Arsonist) > Mass Murderer > Triad > Mafia (option: lone Citizen beats Mafia/Triad) > Cult > Witch/Judge/Auditor (win alongside the above) > Town > Executioner > Amnesiac > Survivor > Jester.

## Technically tricky mechanics

- GLOBAL NIGHT RESOLUTION ORDER (published by the developer Dark Revenant, June 2011): 1) Jailor/Kidnapper detains target; 2) night chats open (Mafia/Mason/Cult/Jailor); 3) bulletproof vests applied; 4) TARGET MANIPULATION LOOP — Witch controls, then Bus Driver swaps, then roleblockers (Escort/Consort), and this Witch→BusDriver→Roleblocker cycle REPEATS a random number of times to settle 'complicated webs of events and paradoxes' (e.g. escort blocks escort blocking witch); 5) Framer frames, Arsonist douses/undouses, misc non-killing actions; 6) ALL KILLS RESOLVE SIMULTANEOUSLY but are reported in fixed order — Jailor execution, Vigilante, Mafioso/Godfather, Serial Killer, Arsonist ignition, Mass Murderer, Jester grief-suicide, Disguiser, leaver suicides — with Bodyguard duels, Bus Driver collision kills, and Witch-forced kills interleaved; being killed in an earlier step does NOT cancel your own queued kill (dead men's knives still land); 7) Janitor cleans; 8) investigations resolve (Sheriff, Investigator, Consigliere) — i.e. info roles see POST-kill state; 9) Disguiser assumes identity if his kill succeeded; 10) Mason Leader recruit; 11) Cult conversion last.
- SIMULTANEOUS SUBMISSION: all players lock in actions during the timed night; nothing resolves until the night ends, then the deterministic pipeline above runs. Conflicting actions are settled purely by that priority order, not submission time.
- REDIRECTION STACK: Bus Driver swaps redirect every targeted action including kills and heals (forcing Mafia to kill their own is a core play); Beguiler/Deceiver hide-behind redirects everything aimed at THEM onto their host; Witch redirects the victim's OWN action. Detective reports show the FINAL visit after all swaps. Witch-on-Witch is defined: a Witch's 'action target' is the person she controls, so controlling a Witch re-aims who that second Witch controls, not her victim's target.
- ROLEBLOCK EDGE CASES: jail roleblocks even roleblock-immune roles (Veteran, Amnesiac, Godfather w/ immunity); Serial Killer option kills roleblockers (an Escort who blocks him, or a Jailor who jails-and-releases him, dies); Jailor's own execution can be roleblocked by an Escort/Consort; Jailor is hardcoded immune to Witch control (acknowledged bug).
- PROTECTION/IMMUNITY LADDER: night immunity (Godfather, NK roles, vests) blocks normal kills; piercing effects: Jailor execute (ignores immunity AND healing), Veteran alert (option: ignores invulnerability), Electromaniac (pierces everything), Arsonist option burns through Doctor heals. Bodyguard intercept kills the attacker and himself, saving the target; at a Mass Murderer spree the Bodyguard saves all visitors and kills the MM. Doctor heal beats one kill; multiple simultaneous attacks overwhelm a single heal.
- VISIT SEMANTICS: actions = 'visits'; Lookout/Detective/Agent/Vanguard observe visits; Veteran kills visitors; Mass Murderer kills everyone 'at the house' (a target who took an action is 'not home' and survives); non-visiting roles can still be FORCED to visit by a Witch (a witched Citizen will show up in Lookout reports and die to a Veteran); jailed targets never visit and are 'always home'; Jailor visits his captive only when executing (creates a documented MM corner case).
- CONVERSION SYSTEMS (hardest to implement): Cult — democratic vote, cooldown 1-3 nights, cannot convert Mafia/Triad, night-immunity/vests block conversion (option), 1/3-of-original-players cap with refund of one conversion per two dead Cultists, Mason Leader insta-kills Cultists he targets and Masons are unconvertible, Doctor/Witch convert into the unique Witch Doctor, Witch Doctor 'heal-converts' attacked targets and may push past the cap, Doctor heal beats Witch Doctor heal on the same target; Auditor — converts Town→Citizen / Mafia→Mafioso / Triad→Enforcer / Neutral→Scumbag, blocked by night immunity; Amnesiac — converts himself to any graveyard role; Mason Leader — recruits Citizens only; Executioner→Jester on failed objective. Resolution order puts both recruit/convert steps dead last.
- FACTION KILL DELEGATION: Mafiosos vote/suggest targets, a random living Mafioso performs the kill, Godfather overrides; with no Mafioso the Godfather kills personally only if the host option allows; non-killing Mafia can -target to direct an AFK killer; a leaver's role 'suicides' but their queued kill still resolves.
- UNIQUE-ROLE & SPAWN CONSTRAINTS: only one Godfather/Mayor/Marshall/Crier/Judge/Mason-Leader/Witch-Doctor/Dragon-Head alive at a time; Mayor and Marshall are mutually exclusive via a shared uniqueness category; random slots must not roll 'powerless' roles (Coroner needs a Janitor/Clue context; Framer needs Town to frame; Mason Leader only spawns alongside Citizens/Cultists); an impossible random slot defaults to Citizen.
- INFORMATION-MASKING INTERACTIONS: Janitor hides role+will of victims; Disguiser swaps identities (graveyard shows the wrong person); Framer corrupts Sheriff/Investigator reads; Godfather detection immunity reads 'not suspicious'; Death Descriptions / Night Sequence leak killer-type via flavor text and sounds (MM sound plays even on a failed spree); Coroner exists specifically to undo masking.
- STALEMATE DETECTION: the engine itself enforces endgame — Three-Days-of-Peace ballot mode + numeric tiebreaker formula, and the 1v1 auto-resolution priority table — so the implementation needs faction-counting logic evaluated at the start of every day.

## Recommended MVP role set

- Citizen — vanilla baseline; gives the role list flexible filler and teaches the 'power of the vote' core (add the 1-use vest option for spice).
- Sheriff — the Town's alignment-check engine; the single most load-bearing info role and the anchor for Last-Will meta.
- Investigator — second, fuzzier info channel (crime records) so claims can cross-check without making detection trivial.
- Lookout — visit-based information; creates the visits/watch web that makes night actions legible and catches killers.
- Doctor — the canonical protective; heal-vs-kill is the most fundamental night interaction to get right first.
- Escort — Town roleblocker; introduces action-cancellation and the roleblock layer of the resolution order.
- Jailor — SC2Mafia's signature role: day-selected jail, anonymous prisoner chat, immunity-piercing execution; generates the game's best moments and exercises chat + roleblock + kill systems at once.
- Vigilante — Town kill with limited shots; high-drama misfires and the simplest 'Town can also kill' lever.
- Mayor — one unique reveal role; the -vote reveal moment plus vote-weight mechanic is cheap to build and hugely fun.
- Godfather — Mafia leader: night immunity + detection immunity + final kill say; teaches immunity and faction kill delegation.
- Mafioso — kill executor and succession body for the Mafia (vote-the-target mechanic).
- Consort — Mafia mirror of the Escort; WIFOM between Escort/Consort claims is classic and reuses the roleblock code.
- Framer — one deception role so Sheriff results aren't gospel; minimal code (a flag on investigation results) for huge meta payoff.
- Serial Killer — one Neutral Killing third threat; night-immune solo killer forces three-way tension and exercises last-man-standing win logic.
- Jester — the beloved chaos role; trivial to implement (win-on-lynch + guilty-voter suicide) and instantly makes lynching decisions psychologically interesting.
- (Optional 16th/swaps: Executioner or Survivor for a second benign neutral — both are near-free to implement; defer Witch, Bus Driver, Cult, Triad, Veteran, Mass Murderer, Disguiser to post-MVP since they drive most of the resolution-order complexity.)
- Recommended MVP slot template (15p): Sheriff, Investigator, Lookout, Doctor, Escort, Jailor, Vigilante, Mayor, Citizen | Godfather, Mafioso, Consort or Framer | Serial Killer, Jester, Survivor/Executioner — matching the canonical 9 Town / 3 Mafia / 3 Neutral balance.

## Full scope notes

Full SC2Mafia scope is roughly 60 roles: 20 Town (6 Government, 5-6 Investigative, 4 Protective, 4 Killing/Power overlapping, plus Spy and oddities like Stump (punishment role) and seasonal Caroler), 11 Mafia, 11 Triad (pure mirror of Mafia with renamed roles whose only mechanical difference is winning ties — cheap to add once Mafia exists, supports Mafia-vs-Triad three-way games with separate chats), ~15 Neutrals (4 Benign, 6+ non-killing Evil incl. the Cult conversion sub-faction and the Auditor-spawned Scumbag, 4-5 Killing incl. later additions Electromaniac and Poisoner, plus the scrapped Elector). Beyond roles, full scope includes: the four-variant host system (Classic/Clue/Custom/Save Slot) with save persistence and setup emulation/probability rolling; ~17 random-category slot types with per-role exclusion matrices; dozens of per-role option toggles that change role identity (this option system is the real configuration surface — every role page lists 3-8 toggles); 4 day/voting types and 3 night-reveal types with trial timer plumbing; Last Wills/Death Notes/PMs; unique-role and powerless-role spawn constraint solving; the full deterministic night-resolution pipeline with the repeated Witch/BusDriver/Roleblock cycle; stalemate machinery (Three Days of Peace, tiebreaker formula, 1v1 priority table); blackmail/silence states; conversion bookkeeping (Cult caps, Witch Doctor uniqueness, Auditor downgrades, Amnesiac remembering, Mason recruiting); meta-progression (points, achievements per-role win list via -alist, unlockable models/appendages, colored names, role blacklist/prefer weighting); lobby tooling (host repick voting, -default setup-of-the-day, kick-vote lists); and the graveyard Russian Roulette betting minigame. Historical note for synthesis: SC2Mafia (by Dark.Revenant) is the direct ancestor of Town of Salem — BlankMediaGames lifted the trial/defense/judgment loop, last wills, death notes, whispers, role-category randoms, and many role designs (Jailor, Veteran, Executioner, Jester, SK, Arsonist) nearly verbatim, so ToS docs are a usable secondary reference, but SC2Mafia is notably more permissive (free-text everything, host-configurable everything) and includes systems ToS dropped (Triad, Auditor/Judge/Marshall/Crier, Bus Driver chaos, court, multi-jailor chat). Primary sources: sc2mafia.fandom.com wiki pages — Game Guide, Hosting Guide, Mechanics (developer-confirmed night order), Commands, Last Will, Setups, all role/category pages (fetched via MediaWiki API; raw text cached under /tmp/sc2mafia/); supplemented by sc2mafia.com forum threads on Triad tie-wins and witch/jailor edge-case rulings.
