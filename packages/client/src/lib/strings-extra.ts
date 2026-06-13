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
  channelJail: 'Cell',
  channelDead: 'Beyond',
  channelWhisper: 'Whispers',
  channelLobby: 'Table',
  chatPlaceholder: 'Say something…',
  chatPlaceholderDead: 'Whisper to the dead…',
  chatMutedSpectator: 'Onlookers cannot speak.',
  chatDeadOnly: 'You can only speak with the dead now.',
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
  kill: '5 · Kill',
  investigate: '6 · Investigate',
  death: '7 · Death',
  promotion: '8 · Promotion',
  win: '9 · Win check',
};

/** Death-cause labels for the god view (plain, not the in-fiction death lines). */
export const DEATH_CAUSE_LABEL: Record<DeathCause, string> = {
  mafia: 'Mafia',
  serial_killer: 'Serial Killer',
  vigilante: 'Vigilante',
  jailor_execute: 'Jailor execution',
  jester_grief: 'Jester grief',
  lynch: 'Lynch',
  leave: 'Left',
};

/** Faction display names (machine key → noir label). */
export const FACTION_LABEL: Record<Faction, string> = {
  TOWN: 'Town',
  MAFIA: 'Mafia',
  NEUTRAL_KILLING: 'Lone Killer',
  NEUTRAL_BENIGN: 'Neutral',
};

/** Winning-party display lines. */
export const WINNER_LABEL: Record<WinningParty, string> = {
  TOWN: 'The Town holds the streets',
  MAFIA: 'The Mafia owns the town',
  SERIAL_KILLER: 'The Lone Killer stands alone at the end',
  JESTER: 'The Jester got the last laugh',
  EXECUTIONER: 'The Executioner got their man',
  SURVIVOR: 'The Survivor lived to see the dawn',
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
