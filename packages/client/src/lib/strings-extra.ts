/**
 * Client-local user-facing copy NOT present in `@nocturne/shared/strings`
 * (BUILD_SPEC §13.2). The shared strings module is the source of truth and may
 * NOT be edited by the client agent; any copy the UI needs that shared does not
 * provide is defined here and noted in DECISIONS.md.
 *
 * All copy is ORIGINAL, written in the same 1920s noir register as shared
 * (§2.1.2, §2.1.4). Keep it here (not inline) so a future localization pass and
 * an eventual merge back into shared are mechanical.
 */

import {
  type WinningParty,
  type Faction,
  type Phase,
  type SeatOutcome,
  type TrialOutcome,
  type VerdictValue,
  type DeathCause,
} from '@nocturne/shared';

/** Home / auth / lobby-browser copy. */
export const HOME = {
  heroSub: 'Find your table. Read the room. Survive the night.',
  guestNameLabel: 'You will be seated as',
  newGuestName: 'New face',
  loginHeading: 'Sign in',
  registerHeading: 'Open an account',
  usernameLabel: 'Name at the door',
  passwordLabel: 'Password',
  emailLabel: 'Email (optional)',
  joinCodeLabel: 'Invite code',
  joinCodePlaceholder: 'e.g. ABC123',
  publicLobbies: 'Open tables',
  noLobbies: 'No open tables right now. Start one, or wait for a door to open.',
  refresh: 'Refresh',
  createLobbyHeading: 'Start a table',
  lobbyNameLabel: 'Table name',
  visibilityLabel: 'Who can sit down',
  visibilityPublic: 'Anyone (public)',
  visibilityPrivate: 'Invite only (private)',
  setupLabel: 'Setup',
  players: 'players',
  status: 'Status',
  authError: 'Those credentials did not check out.',
  switchToRegister: 'No account? Open one.',
  switchToLogin: 'Already have an account? Sign in.',
  orPlayAsGuest: 'or slip in as a guest',
  testModeLabel: 'Test mode',
  testModeHint:
    'God view, bot backfill, and audit JSON for validating roles. Forced private and not ranked. Requires the server test gate; rejected otherwise.',
} as const;

/** Lobby screen copy. */
export const LOBBY = {
  roster: 'At the table',
  hostBadge: 'Host',
  youBadge: 'You',
  spectatorBadge: 'Watching',
  connectedDot: 'Connected',
  disconnectedDot: 'Away',
  setupSummary: 'The setup',
  config: 'House rules',
  whispers: 'Whispers',
  deadSeeAll: 'The dead see everything',
  lastWills: 'Last wills',
  on: 'On',
  off: 'Off',
  inviteLink: 'Invite link',
  copyLink: 'Copy link',
  copied: 'Copied',
  kick: 'Remove',
  transferHost: 'Make host',
  startGame: 'Deal the cards',
  needMorePlayers: (n: number) => `Need at least ${n} at the table to deal.`,
  waitingForHost: 'Waiting for the host to deal the cards.',
  lobbyChat: 'Table talk',
  leaveLobby: 'Leave the table',
  spectatorsPresent: (n: number) => `${n} watching from the shadows`,
  joinAsSpectator: 'Watch from the shadows',
} as const;

/** Game screen copy. */
export const GAME = {
  dayNumber: (n: number) => (n === 0 ? 'First light' : `Day ${n}`),
  nightNumber: (n: number) => `Night ${n}`,
  channelDay: 'Town',
  channelMafia: 'Mafia',
  channelTriad: 'Triad',
  channelJail: 'Cell',
  channelDead: 'Beyond',
  channelWhisper: 'Whispers',
  channelLobby: 'Table',
  chatPlaceholder: 'Say something…',
  chatPlaceholderDead: 'Whisper to the dead…',
  chatMutedSpectator: 'Onlookers cannot speak.',
  chatDeadOnly: 'You can only speak with the dead now.',
  // Living, but no voice in this channel/phase (e.g. the town asleep at night).
  chatMutedPhase: 'The town sleeps — there is nothing to say tonight.',
  // Blackmailed: a hand over your mouth keeps the day's words behind your teeth.
  chatSilenced: "You've been blackmailed — a hand over your mouth keeps you silent today.",
  whisperHint: 'Tip: /w <seat> message — or click a name to whisper.',
  whisperingTo: (label: string) => `Whispering to ${label}`,
  cancelWhisper: 'Cancel whisper',
  whisperMeta: (from: string, to: string) => `${from} whispers to ${to}`,
  seatHeading: 'The table',
  roleCard: 'Your hand',
  faction: 'Faction',
  ability: 'Ability',
  usesRemaining: (n: number) => `${n} left`,
  unlimited: 'No limit',
  passive: 'Passive',
  winCondition: 'How you win',
  mates: 'Your people',
  nightAction: 'Tonight you may…',
  chooseTarget: 'Choose a target',
  cancelAction: 'Cancel',
  noNightAction: 'You have no move to make tonight. Rest, and watch.',
  actionLocked: 'Your choice is set. You may change it until dawn.',
  targetSet: (label: string) => `Set on ${label}.`,
  // --- Per-ability night headers (gap H1): "Tonight: {verb}" ---------------
  tonightVerb: (verb: string) => `Tonight: ${verb}`,
  // --- Dead-target pickers (gaps A7/A8/A9): grave-targeting abilities -------
  deadTargetPrompt: (verb: string) => `Choose a grave to ${verb.toLowerCase()}.`,
  noDeadTargets: 'No graves to work tonight.',
  retributeTownHint: 'Only fallen Town can answer the call.',
  // --- Self-toggle abilities (gaps A3/A4/H5): no seat — an armed toggle -----
  selfToggleArm: (verb: string) => `${verb} tonight`,
  selfToggleArmed: (verb: string) => `${verb} is armed for tonight.`,
  selfToggleNote: 'Once armed, it holds until dawn — pick another move to stand down.',
  selfToggleStandDown: 'Stand down',
  // --- Jailor cell (gaps A2/C4): execute or spare the night's prisoner ------
  cellTitle: 'The cell',
  cellPrisoner: (label: string) => `You are holding ${label}.`,
  cellExecute: (label: string) => `Execute ${label}`,
  cellSpare: 'Spare them',
  cellNoPrisoner: 'No prisoner tonight — you cannot execute.',
  executionsLeft: (n: number) => `${n} ${n === 1 ? 'execution' : 'executions'} left`,
  executionsSpent: 'You have no executions left.',
  // --- Guardian Angel charge (gap H2): the shield is bound to one soul ------
  yourCharge: (label: string) => `Your charge: ${label}`,
  shieldCharge: (label: string) => `Watch over ${label}`,
  chargeShielded: (label: string) => `Watching over ${label}.`,
  // --- Executioner mark / generic bound target (gap A11 role card) ---------
  yourMark: (label: string) => `Your mark: ${label}`,
  boundTo: (label: string) => `Bound to: ${label}`,
  // --- Medium séance (gap A5): a DAY ability that opens a night séance ------
  seanceOpen: (n: number) => `Open séance tonight (${n} left)`,
  seanceOpenUnlimited: 'Open séance tonight',
  seanceOpened: 'Your séance is open. The dead will hear you tonight.',
  // Witch (witch_control) two-target picker: the puppet whose hand she seizes,
  // and the soul she points it at. Both must be living seats.
  witchPuppet: 'Whose hand to move',
  witchVictim: 'Where to point it',
  witchPuppetSet: (label: string) => `Riding ${label}.`,
  witchVictimSet: (label: string) => `Pointed at ${label}.`,
  witchVictimPending: 'Now choose where to point their hand.',
  witchNeedPuppet: 'First choose a hand to move.',
  // Transporter (transport) two-target picker: the two houses to switch. Anyone
  // calling on one finds the other. Both must be living seats other than the
  // Transporter, and the two must differ.
  transportFirst: 'Swap this house…',
  transportSecond: '…with this house',
  transportFirstSet: (label: string) => `Switching ${label}…`,
  transportSecondSet: (label: string) => `…with ${label}.`,
  transportSecondPending: 'Now choose the house to switch them with.',
  transportNeedFirst: 'First choose a house to switch.',
  jailSelect: 'Choose who to jail tonight',
  jailConfirm: 'Jail',
  jailSet: (label: string) => `${label} will be hauled to the cell tonight.`,
  reveal: 'Reveal yourself as Mayor',
  revealConfirm: 'Reveal — your word will carry the weight of three. There is no taking it back.',
  revealed: 'You have revealed. The town knows your office.',
  lastWillTitle: 'Your last will',
  lastWillPlaceholder: 'What they should find on you…',
  lastWillSaved: 'Saved',
  lastWillSaving: 'Saving…',
  deathNoteTitle: 'Your calling card',
  deathNotePlaceholder: 'A note left on the body…',
  voteFor: 'Vote',
  retractVote: 'Take it back',
  skipDay: 'Skip the day',
  votesNeeded: (n: number) => `${n} to put on trial`,
  // Compact threshold line shown over the vote area during DAY_VOTING.
  voteThreshold: (n: number) => `${n} ${n === 1 ? 'voice' : 'voices'} to put a soul on trial`,
  // Running tally of one candidate against the trial threshold, e.g. "3 / 5".
  tallyOfThreshold: (have: number, need: number) => `${have} / ${need}`,
  // Running skip tally vs the same threshold (a skip majority ends the day).
  skipThreshold: (have: number, need: number) => `${have} / ${need} to call it a day`,
  tally: (n: number) => `${n}`,
  mayorMark: 'Mayor',
  afkBadge: 'Away',
  disconnectedBadge: 'Disconnected',
  deadTag: 'Dead',
  revealedAs: (role: string) => `Revealed: ${role}`,
  spectating: 'You are watching from the shadows.',
  connecting: 'Reaching the table…',
  reconnecting: 'Lost the line — reconnecting…',
  yourTurnToSpeak: 'You stand accused. Speak.',
  trialAccused: (label: string) => `${label} stands trial`,
  trialDefense: 'The accused makes their case',
  trialJudgment: 'Render your verdict',
  verdictGuilty: 'Guilty',
  verdictInnocent: 'Innocent',
  verdictAbstain: 'Abstain',
  verdictCast: (v: string) => `You voted ${v}.`,
  verdictReveal: 'The verdict',
  deathFeedTitle: 'Come morning…',
  deathFeedDismiss: 'Continue',
  cause: 'Cause',
  lastWillFound: 'Last will',
  noLastWill: 'No last will was found.',
  cleanedBody: 'The body was cleaned',
  deathNoteFound: 'A note left behind',
  gameOver: 'The dust settles',
  winners: 'The winners',
  roleReveal: 'Everyone\'s hand',
  yourResult: 'Your result',
  seedLabel: 'Match seed',
  playAgain: 'Same crowd, again',
  backToTables: 'Back to the tables',
  report: 'Report',
  mute: 'Mute',
  unmute: 'Unmute',
} as const;

/**
 * Public role glossary copy ("The Cast"). Every role card and its mechanics are
 * open to the whole table by design, so no one can fake-verify by asking "what
 * does your card say" — the canonical text lives in `@nocturne/shared` and is
 * shown identically here and on a player's own hand. ORIGINAL noir register.
 */
export const GLOSSARY = {
  open: 'Roles',
  openTitle: 'The cast — every role, open to the whole table',
  heading: 'The Cast',
  sub: 'Every hand in the deck, laid face-up. No card here is a secret.',
  searchPlaceholder: 'Search a name or faction…',
  noMatches: 'No role answers to that name.',
  close: 'Close',
  closeTitle: 'Close the glossary',
  count: (n: number) => `${n} roles`,
  shown: (shown: number, total: number) =>
    shown === total ? `${total} roles` : `${shown} of ${total} roles`,
  winCondition: 'How they win',
  abilities: 'What they do',
  // --- Faction section headers (grouping order set in the component) --------
  sections: {
    TOWN: 'The Town',
    MAFIA: 'The Mafia',
    TRIAD: 'The Triad',
    VAMPIRE: 'The Coven',
    CULT: 'The Cult',
    NEUTRAL_KILLING: 'Lone Killers',
    NEUTRAL_BENIGN: 'Neutrals',
  } as Record<Faction, string>,
  // --- Ability-summary phrasings (derived from the RoleDefinition) ---------
  abilityNone: 'No special move — they live and die by the vote.',
  // Night-action verbs (machine kind → noir phrasing).
  nightVerb: {
    investigate: 'works one neighbor in the dark for what they can learn',
    protect: 'stands a private watch over one soul through the night',
    roleblock: 'keeps one target too busy to make their own move',
    kill: 'goes out into the dark to put one target down',
    frame: 'dresses one target up to read guilty',
    control: 'gives the order — the kill is theirs to aim, hands clean',
    none: '',
  } as Record<string, string>,
  dayReveal: 'May step into the light by day, their word carrying the weight of three.',
  dayJail: 'Hauls one neighbor to the cell by day, to question — or to execute — by night.',
  // Use-count phrasings.
  usesUnlimited: 'as often as the nights allow',
  usesOnce: 'just once all game',
  usesN: (n: number) => `up to ${n} times all game`,
  usesSelf: (n: number) => `${n === 1 ? 'once' : `${n} times`} on themselves`,
  // Trait flags.
  traitNightImmune: 'Shrugs off ordinary violence in the dark.',
  traitRoleblockImmune: 'Cannot be kept from their work — no distraction holds them.',
  traitUnique: 'Only one ever sits at a table.',
  traitNoVisit: 'Acts without leaving the house — a lookout never sees them come or go.',
} as const;

/** Profile card / account dashboard copy (goal 1). */
export const PROFILE = {
  heading: 'Your dossier',
  guestHeading: 'A face without a name',
  guestPrompt:
    'You are playing as a guest — your wins vanish at dawn. Open an account to keep your record, climb the ranks, and earn your reputation.',
  tier: 'Standing',
  totalPoints: 'Reputation',
  points: 'pts',
  gamesPlayed: 'Games',
  gamesWon: 'Wins',
  winRate: 'Win rate',
  survived: 'Survived',
  achievements: 'Commendations',
  achievementsUnlocked: (n: number, total: number) => `${n} of ${total} earned`,
  locked: 'Locked',
  signOut: 'Sign out',
  viewLeaderboard: 'See the leaderboard',
  noStats: 'No record yet — play a ranked game to start your dossier.',
} as const;

/** Leaderboard screen copy (goal 2). */
export const LEADERBOARD = {
  heading: 'The standings',
  sub: 'Who owns this town.',
  rank: 'Rank',
  player: 'Name',
  points: 'Reputation',
  games: 'Games',
  winRate: 'Win rate',
  empty: 'No names on the board yet. Be the first to make a reputation.',
  you: 'You',
  loading: 'Counting the takings…',
} as const;

/** Game-over points celebration copy (goal 3). */
export const POINTS = {
  heading: 'The payout',
  total: 'Total earned',
  newAchievements: 'New commendations',
  tierUp: (name: string) => `You made ${name}.`,
  viewReplay: 'Watch the replay',
} as const;

/** Custom setup builder copy (goal 4). */
export const BUILDER = {
  heading: 'Build a table',
  sub: 'Lay out the roles, name the house, and save it for your games.',
  nameLabel: 'Setup name',
  namePlaceholder: 'The Saint Valentine Special',
  descLabel: 'Description',
  descPlaceholder: 'A short note for the lobby picker…',
  rangeLabel: 'Seats',
  countLabel: (n: number) => `${n} seats`,
  editingCount: (n: number) => `Editing the ${n}-seat layout`,
  slot: 'Seat',
  fixedRole: 'Fixed role',
  category: 'Random pool',
  randomTown: 'Random Town',
  randomMafia: 'Random Mafia',
  randomTriad: 'Random Triad',
  townPool: 'Town pool',
  townPoolHint: 'Roles that "Random Town" slots may draw from.',
  factionSummary: 'At this table',
  save: 'Save setup',
  saving: 'Saving…',
  saved: 'Saved to your setups.',
  errors: 'The house found problems:',
  mySetups: 'Your setups',
  noSetups: 'You have not saved any setups yet.',
  delete: 'Delete',
  deleted: 'Setup removed.',
  signInPrompt: 'Sign in with a registered account to build and save custom setups.',
  addSlot: 'Add seat',
  removeSlot: 'Remove',
  pickRole: 'Pick a role',
} as const;

/** Lobby setup picker copy (goal 5). */
export const PICKER = {
  groupFeatured: 'Featured',
  groupStandard: 'Standard',
  groupChaos: 'Chaos',
  groupMine: 'My setups',
  daily: (date: string) => `Today's pick · ${date}`,
  chaosDaily: 'Daily chaos',
  custom: 'Custom',
} as const;

/** Admin controls copy (goal 8). */
export const ADMIN = {
  title: 'The House',
  subtitle: 'Admin god-powers',
  target: 'Target seat',
  noTarget: 'No seat',
  kill: 'Kill',
  stump: 'Stump',
  forcePhase: 'Force phase',
  grant: 'Grant points',
  revoke: 'Revoke points',
  tempBan: 'Temp-ban',
  pointsLabel: 'Points',
  durationLabel: 'Ban (hours)',
  reasonLabel: 'Reason (optional)',
  confirmKill: (label: string) => `Kill ${label}? This is unpreventable and reveals their role.`,
  confirmBan: (label: string) => `Temp-ban ${label}? They will be removed from the table.`,
  stumpBadge: 'Stump',
  stumpTitle: 'Non-voting stump (admin)',
  collapse: 'Collapse',
  expand: 'Expand',
} as const;

/** Replay viewer copy (goal 7). */
export const REPLAY = {
  heading: 'The record',
  verified: 'Verified',
  unverified: 'Unverified',
  fingerprint: 'Fingerprint',
  roster: 'Final roster',
  timeline: 'Timeline',
  transcript: 'Transcript',
  download: 'Download JSON',
  back: 'Back to tables',
  loading: 'Pulling the file from the vault…',
  notFound: 'No such record, or you were not at that table.',
  step: (i: number, n: number) => `Step ${i} of ${n}`,
  living: 'Living',
  dead: 'Dead',
  noChat: 'No words were spoken on the record.',
  reconstructError: 'This record could not be fully reconstructed.',
} as const;

/** Settings screen copy. */
export const SETTINGS = {
  heading: 'Settings',
  profanityFilter: 'Hide rough language',
  profanityFilterHint: 'Mask flagged words in chat (display only).',
  colorblind: 'Colorblind-safe palette',
  colorblindHint: 'Faction is always shown with an icon and label, never color alone.',
  textScale: 'Text size',
  textScaleSmall: 'Small',
  textScaleNormal: 'Normal',
  textScaleLarge: 'Large',
  muteList: 'Muted players',
  muteListEmpty: 'You have not muted anyone.',
  unmute: 'Unmute',
  back: 'Back',
  sound: 'Sound cues',
  animations: 'Cinematic animations',
  animationsHint:
    'A noir backdrop and choreographed death scenes behind the game. Always respects your system reduced-motion setting.',
  animationsFull: 'Full',
  animationsReduced: 'Reduced',
  animationsOff: 'Off',
} as const;

/**
 * TEST-MODE "Director" god-view + controls copy (client-local; the god view is
 * a dev/QA tool, so the register is plainer than the in-fiction game copy).
 */
export const DIRECTOR = {
  title: 'Director',
  subtitle: 'God view · test mode',
  testBadge: 'TEST',
  collapse: 'Collapse',
  expand: 'Expand',
  // Tabs / sections.
  board: 'Live board',
  intents: 'Night intents',
  votes: 'Votes',
  traces: 'Resolution traces',
  events: 'Event log',
  controls: 'Controls',
  // Board columns / markers.
  seat: 'Seat',
  role: 'Role',
  faction: 'Faction',
  status: 'Status',
  alive: 'Alive',
  dead: 'Dead',
  uses: 'Uses',
  unlimited: '∞',
  nightImmune: 'Night-immune',
  mayorRevealed: 'Mayor (revealed)',
  exeTarget: (label: string) => `Exe → ${label}`,
  leaving: 'Leaving',
  afk: 'AFK',
  disconnected: 'Disconnected',
  mafiaRoster: 'Mafia',
  jailTarget: (label: string) => `Jailed: ${label}`,
  noIntents: 'No night intents submitted.',
  pendingJesterGrief: 'Pending jester grief',
  // Votes.
  tally: 'Tally',
  trialAccused: (label: string) => `On trial: ${label}`,
  verdicts: 'Verdicts',
  noVotes: 'No votes cast.',
  skip: 'skip',
  // Traces.
  night: (n: number) => `Night ${n}`,
  deaths: 'Deaths',
  noDeaths: 'No deaths.',
  noTraces: 'No night has resolved yet.',
  step: 'step',
  // Events.
  eventFilterPlaceholder: 'Filter events (type, phase, seat #)…',
  noEvents: 'No events yet.',
  // Controls.
  endPhase: 'End phase',
  endPhaseHint: 'Hotkey: Shift+E',
  resendState: 'Resend state',
  downloadAudit: 'Download audit JSON',
  auditFailed: 'Audit download failed.',
  addBots: 'Add bots',
  removeBot: 'Remove',
  removeAll: 'Remove all bots',
  count: 'Count',
  policy: 'Policy',
  policyScripted: 'Scripted',
  policyLlm: 'LLM',
  preGameOnly: 'Bot add/remove is available before the game starts.',
} as const;

/** Resolution-trace §6.8 step labels (audit viewer grouping). */
export const TRACE_STEP_LABEL: Record<string, string> = {
  jail: '1 · Jail',
  roleblock: '2 · Roleblock',
  sk_redirect: '2 · SK redirect',
  protect: '3 · Protect',
  frame: '4 · Frame',
  forge: '4 · Forge',
  clean: '4 · Clean',
  blackmail: '4 · Blackmail',
  disguise: '4 · Disguise',
  douse: '4 · Douse',
  hypnotize: '4 · Hypnotize',
  kill: '5 · Kill',
  guard: '5 · Bodyguard',
  alert: '5 · Veteran alert',
  ignite: '5 · Arsonist ignite',
  crusade: '5 · Crusader strike',
  ambush: '5 · Ambush',
  rampage: '5 · Werewolf rampage',
  massacre: '5 · Mass Murderer',
  shield: '3 · Guardian Angel',
  juggernaut: '5 · Juggernaut',
  divine: '6 · Psychic vision',
  witch: '0 · Witch control',
  duel: '2 · Pirate duel',
  infect: '8 · Plague spread',
  retribute: '8 · Retribution',
  pestilence: '5 · Pestilence',
  vampire_check: '6 · Vampire Hunter check',
  convert: '8 · Vampire conversion',
  recruit: '8 · Cult recruitment',
  investigate: '6 · Investigate',
  death: '7 · Death',
  promotion: '8 · Promotion',
  win: '9 · Win check',
};

/** Death-cause labels for the god view (plain, not the in-fiction death lines). */
export const DEATH_CAUSE_LABEL: Record<DeathCause, string> = {
  mafia: 'Mafia',
  triad: 'Triad',
  serial_killer: 'Serial Killer',
  vigilante: 'Vigilante',
  jailor_execute: 'Jailor execution',
  jester_grief: 'Jester grief',
  lynch: 'Lynch',
  leave: 'Left',
  admin: 'Admin',
  bodyguard: 'Bodyguard',
  veteran: 'Veteran',
  arsonist: 'Arsonist',
  crusader: 'Crusader',
  ambush: 'Ambusher',
  werewolf: 'Werewolf',
  massacre: 'Mass Murderer',
  juggernaut: 'Juggernaut',
  pestilence: 'Pestilence',
  staked: 'Vampire Hunter (stake)',
};

/** Faction display names (machine key → noir label). */
export const FACTION_LABEL: Record<Faction, string> = {
  TOWN: 'Town',
  MAFIA: 'Mafia',
  TRIAD: 'Triad',
  VAMPIRE: 'Vampire',
  CULT: 'Cult',
  NEUTRAL_KILLING: 'Lone Killer',
  NEUTRAL_BENIGN: 'Neutral',
};

/** Winning-party display lines. */
export const WINNER_LABEL: Record<WinningParty, string> = {
  TOWN: 'The Town holds the streets',
  MAFIA: 'The Mafia owns the town',
  TRIAD: 'The Triad rules the streets',
  VAMPIRE: 'The coven drinks the town dry',
  CULT: 'The Cult gathers the town into the fold',
  SERIAL_KILLER: 'The Lone Killer stands alone at the end',
  JESTER: 'The Jester got the last laugh',
  EXECUTIONER: 'The Executioner got their man',
  SURVIVOR: 'The Survivor lived to see the dawn',
  GUARDIAN_ANGEL: 'The Guardian Angel kept their charge alive',
  WITCH: 'The Witch outlasted the town',
  PIRATE: 'The Pirate took the plunder and the glory',
  DRAW: 'The night ends in a stalemate',
};

/** Per-seat personal result lines. */
export const OUTCOME_LABEL: Record<SeatOutcome, string> = {
  win: 'You won',
  loss: 'You lost',
  draw: 'A draw',
  left: 'You walked out',
};

/** Trial outcome label. */
export const TRIAL_OUTCOME_LABEL: Record<TrialOutcome, string> = {
  guilty: 'Guilty',
  innocent: 'Innocent',
};

/** Verdict value label. */
export const VERDICT_LABEL: Record<VerdictValue, string> = {
  guilty: 'Guilty',
  innocent: 'Innocent',
  abstain: 'Abstained',
};

/** Is a phase a "night-flavored" phase (for scene tinting + labels)? */
export const NIGHT_PHASES: ReadonlySet<Phase> = new Set<Phase>(['NIGHT']);
export const DAY_PHASES: ReadonlySet<Phase> = new Set<Phase>([
  'DAY_0',
  'DAWN',
  'DAY_DISCUSSION',
  'DAY_VOTING',
  'TRIAL_DEFENSE',
  'TRIAL_JUDGMENT',
  'EXECUTION',
]);

/** A seat's display label, e.g. "7 · Capone". */
export function seatLabel(seat: number, name: string): string {
  return `${seat + 1} · ${name}`;
}

/** Short seat tag, e.g. "#7". */
export function seatTag(seat: number): string {
  return `#${seat + 1}`;
}
