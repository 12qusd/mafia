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

/** Cross-cutting accessibility / chrome copy (skip link, nav labels, loaders). */
export const UI_A11Y = {
  skipToContent: 'Skip to main content',
  primaryNav: 'Primary',
  loading: 'Loading…',
} as const;

/** Home / auth / lobby-browser copy. */
export const HOME = {
  heroSub: 'Find your table. Read the room. Survive the night.',
  quickPlay: 'Quick Play',
  quickPlaySub: 'Sit down now — we deal you in within seconds.',
  ranked: 'Ranked',
  rankedSub: 'Play for the standings. Win, climb, make your name.',
  rankedSignInPrompt: 'Sign in to play ranked — guests have no record to keep.',
  rankedSearching: 'Finding you a ranked table…',
  rankedSearchingSub: 'Matching you to your own kind. Bots fill the empty chairs.',
  quickPlaySearching: 'Finding you a table…',
  quickPlaySearchingSub: 'Holding a seat while the others arrive.',
  quickPlayMatched: 'Table found — dealing you in…',
  quickPlayCancel: 'Cancel',
  quickPlayPosition: (pos: number, total: number) => `You are ${pos} of ${total} at the door`,
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
  forgotPassword: 'Forgot your password?',
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
  // Concise screen-reader announcements for the assertive live region.
  announceNight: (n: number) => `Night ${n}. Night falls.`,
  announceDawn: (n: number) => `Dawn of day ${n}. A reckoning.`,
  announceDay: (n: number) => (n === 0 ? 'First light. The town wakes.' : `Day ${n}. The town talks.`),
  announceVoting: 'Voting. Name a name.',
  announceTrialDefense: 'A trial begins. The accused has the floor.',
  announceTrialJudgment: 'The town renders its verdict.',
  announceExecution: 'Execution at the gallows.',
  announceDeath: (name: string) => `${name} is dead.`,
  announceLynched: (name: string) => `${name} was found guilty and lynched.`,
  announceAcquitted: (name: string) => `${name} was found innocent and walks free.`,
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
  /** Accessible label for the live chat log region (per active channel). */
  chatLogLabel: (channel: string) => `${channel} chat log`,
  /** Accessible label for the chat channel tablist. */
  channelTabsLabel: 'Chat channels',
  whisperingTo: (label: string) => `Whispering to ${label}`,
  /** Accessible label / tooltip for a roster or chat name (keyboard whisper). */
  whisperTo: (label: string) => `Whisper to ${label}`,
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
  mayorRevealed: 'Revealed Mayor — their vote weighs three.',
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
  roleReveal: "Everyone's hand",
  yourResult: 'Your result',
  seedLabel: 'Match seed',
  playAgain: 'Same crowd, again',
  playAgainPending: 'Reconvening…',
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
  rolePreferences: 'Standing orders',
  noStats: 'No record yet — play a ranked game to start your dossier.',
  ranked: 'Ranked standing',
  rankLabel: 'Rank',
  mmrLabel: 'MMR',
  rankedGames: 'Ranked games',
  rankedUnranked: 'Unranked — play a ranked game to earn your standing.',
} as const;

/** Role-preferences screen copy (point-unlocked, goal 3). Original noir register. */
export const PREFERENCES = {
  heading: 'Standing orders',
  sub: 'Steer the deal — within reason.',
  back: 'Back',
  loading: 'Reading your file…',
  signInRequired:
    'Standing orders are for made members only. Open an account to bank a reputation and earn the privilege.',
  // The weighted-bias disclaimer — preference is NOT a guarantee.
  disclaimer:
    'These are standing orders, not guarantees. A blacklisted role is avoided where the deal allows; a preferred role is merely weighted in your favor. The house still shuffles the deck.',
  // Per-tier locked hints (built from unlocksFor's nextUnlock).
  blacklistLockedHint: (at: number) => `Bank ${at.toLocaleString()} reputation to blacklist roles.`,
  preferLockedHint: (at: number) => `Bank ${at.toLocaleString()} reputation to prefer roles.`,
  blacklistUnlocked: 'Blacklist unlocked',
  preferUnlocked: 'Preference unlocked',
  // The three-state control labels.
  stateNone: 'Neutral',
  stateBlacklist: 'Blacklist',
  statePrefer: 'Prefer',
  stateNoneTitle: 'No standing order — assigned normally.',
  stateBlacklistTitle: 'Avoid dealing me this role (best-effort).',
  statePreferTitle: 'Weight the deal toward this role (not guaranteed).',
  // Locked-control tooltips.
  blacklistLockedTitle: 'Blacklisting is not yet unlocked.',
  preferLockedTitle: 'Preferring is not yet unlocked.',
  // Toast / inline feedback.
  savedBlacklist: 'Role blacklisted.',
  savedPrefer: 'Role preferred.',
  savedCleared: 'Standing order lifted.',
  saveFailedLocked: 'That tier is not unlocked yet.',
  saveFailed: 'The house would not record that.',
  // Progress hint header.
  progressTo: (label: string, at: number) =>
    `${label} unlocks at ${at.toLocaleString()} reputation.`,
} as const;

/** Leaderboard screen copy (goal 2 + ranked play). */
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
  tabCasual: 'Reputation',
  tabRanked: 'Ranked (MMR)',
  mmr: 'MMR',
  standing: 'Standing',
  rankedEmpty: 'No ranked play yet this season. Be the first to climb.',
  season: 'Season',
  prev: 'Previous',
  next: 'Next',
  yourRank: 'Your rank',
  yourRankUnplaced: 'Unranked — finish your placements to land on the board.',
  rankedHistory: 'Ranked history',
  rankedHistoryEmpty: 'No ranked games yet.',
} as const;

/** Community hub copy (Social feature) — the "old-web" social district. */
export const COMMUNITY = {
  heading: 'The Community',
  masthead: 'Word travels fast in this town.',
  est: 'Est. 1928',
  visitorsLabel: 'Souls through the door',
  shoutboxHeading: 'The Wire',
  shoutboxTopic: 'Word on the street — keep it short.',
  shoutboxPlaceholder: 'Say your piece (280)…',
  shoutboxPost: 'Put it on the wire',
  shoutboxEmpty: 'The wire is quiet. Break the silence.',
  channelsHeading: 'The Rooms',
  channelPlaceholder: 'Speak up (1000)…',
  channelPost: 'Post',
  channelEmpty: 'Nobody has spoken here yet. Pull up a chair.',
  whosAroundHeading: "Who's around",
  whosAroundEmpty: 'Nobody you know is around. Make some friends.',
  online: 'Around',
  offline: 'Gone dark',
  signInToPost: 'Sign in with an account to join the talk — guests can only listen.',
  silenced: 'You have been silenced. No posting for now.',
  slowDown: 'Easy — one at a time.',
  postFailed: 'That did not go through.',
  refreshing: 'Listening…',
  // Per-room activity + search + delete (social v1).
  chatting: (n: number) => `${n} chatting`,
  removed: '[removed]',
  deleteMsg: 'Remove this message',
  findPeople: 'Find people',
  searchPlaceholder: 'Search names…',
  searchEmpty: 'No one by that name.',
} as const;

/** Public profile screen copy (Social feature). */
export const PUBLIC_PROFILE = {
  notFound: 'No such face in this town.',
  loading: 'Pulling the file…',
  memberSince: (when: string) => `Made men since ${when}`,
  memberSinceUnknown: 'A familiar face',
  taglinePlaceholder: 'A line for your card (80)…',
  bioPlaceholder: 'Tell them who you are (500)…',
  accentLabel: 'Flair',
  accentNone: 'None',
  editHeading: 'Your card',
  edit: 'Edit your card',
  save: 'Save',
  saving: 'Filing…',
  saved: 'Card filed.',
  saveFailed: 'The house would not record that.',
  cancel: 'Cancel',
  stats: 'The record',
  totalPoints: 'Reputation',
  gamesPlayed: 'Games',
  gamesWon: 'Wins',
  survived: 'Survived',
  achievements: 'Commendations',
  noAchievements: 'No commendations yet.',
  addFriend: 'Add friend',
  requested: 'Requested',
  respond: 'Respond',
  friends: 'Friends',
  message: 'Message',
  signInToFriend: 'Sign in to add friends and send word.',
  // Blocking (social v1).
  block: 'Block',
  unblock: 'Unblock',
  blocked: 'Blocked',
  blockToast: 'Blocked. You will not see their words.',
  unblockToast: 'Unblocked.',
} as const;

/** Friends + direct-messages screen copy (Social feature). */
export const FRIENDS = {
  heading: 'Your people',
  sub: 'Made men, marks, and the messages between.',
  signInRequired:
    'Friends and direct lines are for account holders. Open an account to keep your circle.',
  friendsHeading: 'Made men',
  friendsEmpty: 'No friends yet. Find someone on the boards and send word.',
  incomingHeading: 'Wants in',
  incomingEmpty: 'No one is asking.',
  outgoingHeading: 'Awaiting word',
  outgoingEmpty: 'No pending requests.',
  accept: 'Accept',
  decline: 'Decline',
  pending: 'Pending',
  remove: 'Cut loose',
  message: 'Message',
  online: 'Around',
  offline: 'Gone dark',
  threadsHeading: 'Conversations',
  threadsEmpty: 'No conversations yet. Open one from a friend or a profile.',
  dmPlaceholder: 'Send word (1000)…',
  dmSend: 'Send',
  dmEmpty: 'No words yet. Start the conversation.',
  dmPickThread: 'Pick a conversation, or start one from a profile.',
  silenced: 'You have been silenced. No messages for now.',
  sendFailed: 'That did not go through.',
  addByNameLabel: 'Add by name',
  addByNamePlaceholder: 'Name at the door…',
  add: 'Add',
  addSelf: 'You cannot befriend yourself.',
  addNotFound: 'No such name at the door.',
  addSent: 'Word sent.',
  addAccepted: 'You are now friends.',
  addExists: 'Already on the books.',
  // Search (social v1).
  searchPlaceholder: 'Search names…',
  searchEmpty: 'No one by that name.',
  searchHint: 'Type at least two letters.',
  // Unread badges (social v1).
  unread: 'unread',
  messages: 'Messages',
  // Deletion (social v1).
  deleteDm: 'Remove this message',
  removed: '[removed]',
  // Blocking (social v1).
  blockedHeading: 'Blocked',
  blockedEmpty: 'You have not blocked anyone.',
  unblock: 'Unblock',
} as const;

/** Forums copy (Forums feature) — a phpBB-style message board, noir register. */
export const FORUM = {
  heading: 'The Boards',
  sub: 'Word gets around. Pull up a chair and say your piece.',
  est: 'Est. 1928',
  // Index columns.
  colBoard: 'Board',
  colTopics: 'Topics',
  colPosts: 'Posts',
  colLastPost: 'Last post',
  colTopic: 'Topic',
  colReplies: 'Replies',
  colViews: 'Views',
  boardEmpty: 'No topics here yet. Be the first to start one.',
  noLastPost: 'No posts yet',
  by: 'by',
  // Board screen.
  newTopic: 'New Topic',
  newTopicHeading: 'Start a topic',
  titleLabel: 'Topic title',
  titlePlaceholder: 'A line that says it all (120)…',
  bodyLabel: 'Your message',
  bodyPlaceholder: 'Say your piece (8000)…',
  post: 'Post',
  posting: 'Posting…',
  cancel: 'Cancel',
  pinned: 'Pinned',
  locked: 'Locked',
  signInToPost: 'Sign in with an account to start topics and reply — guests can only read.',
  startedBy: (name: string) => `started by ${name}`,
  // Thread screen.
  breadcrumbForum: 'Forum',
  reply: 'Reply',
  replyHeading: 'Post a reply',
  replyPlaceholder: 'Write a reply (8000)…',
  threadLocked: 'This topic is locked. No new replies.',
  memberSince: (when: string) => `Member since ${when}`,
  memberSinceUnknown: 'A familiar face',
  postsCount: (n: number) => `${n} ${n === 1 ? 'post' : 'posts'}`,
  edited: 'edited',
  edit: 'Edit',
  save: 'Save',
  saving: 'Saving…',
  editPlaceholder: 'Edit your post…',
  // Pagination.
  prev: '‹ Prev',
  next: 'Next ›',
  pageOf: (page: number, total: number) => `Page ${page} of ${total}`,
  // Moderation (admin).
  modPin: 'Pin',
  modUnpin: 'Unpin',
  modLock: 'Lock',
  modUnlock: 'Unlock',
  // Toasts.
  silenced: 'You have been silenced. No posting for now.',
  slowDown: 'Easy — one at a time.',
  postFailed: 'That did not go through.',
  lockedFailed: 'This topic is locked.',
  saved: 'Post updated.',
  loading: 'Reading the boards…',
  notFound: 'No such board or topic in this town.',
  // Deletion (social v1).
  delete: 'Delete',
  deleted: 'Post removed.',
  removed: '[removed]',
  confirmDelete: 'Remove this post?',
} as const;

/** Game-over points celebration copy (goal 3 + ranked play). */
export const POINTS = {
  heading: 'The payout',
  total: 'Total earned',
  newAchievements: 'New commendations',
  tierUp: (name: string) => `You made ${name}.`,
  viewReplay: 'Watch the replay',
  rankedHeading: 'Ranked',
  rankedDelta: (delta: number) => `${delta >= 0 ? '+' : ''}${Math.round(delta)} MMR`,
  rankedTo: (name: string, mmr: number) => `${name} · ${Math.round(mmr)} MMR`,
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

/**
 * Account-lifecycle copy (retention wave): password reset, email verification.
 * 1920s-noir voice — no account-enumeration tells in the forgot/reset flow.
 */
export const ACCOUNT = {
  // Forgot-password screen.
  forgotHeading: 'Lost your key',
  forgotSub: 'Give us the name or the address on the account. If it checks out, a way back in is on its way.',
  forgotIdentifierLabel: 'Name at the door or email',
  forgotSubmit: 'Send the link',
  forgotSent:
    'If that account exists, a reset link is already on its way. Check your mail — and your spam, the courier is not always reliable.',
  forgotError: 'Something jammed on our end. Try again in a moment.',

  // Reset-password screen.
  resetHeading: 'Set a new password',
  resetSub: 'Pick something only you would know. Setting it logs out every other device.',
  resetPasswordLabel: 'New password',
  resetConfirmLabel: 'Confirm password',
  resetSubmit: 'Set password',
  resetSuccess: 'Done. Your new password is in the books.',
  resetSignInLink: 'Back to sign in',
  resetMismatch: 'Those two do not match.',
  resetTooShort: 'A password needs at least 8 characters.',
  resetInvalid: 'That link is no good — used already, or long expired. Ask for a fresh one.',
  resetNoToken: 'This link is missing its key. Request a new reset from the sign-in screen.',
  resetBusy: 'Setting…',

  // Verify-email screen.
  verifyHeadingWorking: 'Confirming your address…',
  verifyHeadingDone: 'Address confirmed',
  verifyHeadingFailed: 'Could not confirm',
  verifyWorking: 'One moment while we check the paperwork.',
  verifyDone: 'Your email is verified. The family takes your word now.',
  verifyFailed: 'That link is no good — used already, or long expired. Sign in and ask for a new one.',
  verifyNoToken: 'This link is missing its key.',
  verifyHomeLink: 'To the floor',

  // "Verify your email" banner (signed-in, unverified).
  bannerText: 'Your email is not yet confirmed. Confirm it to keep your account — and your standing.',
  bannerResend: 'Resend link',
  bannerResent: 'Sent. Check your mail for the confirmation link.',
  bannerResendError: 'Could not send right now. Try again shortly.',
  bannerDismiss: 'Dismiss',
} as const;

/** First-game onboarding banner (Home) — shown to guests + zero-game accounts. */
export const ONBOARD = {
  pitch: 'New in town? Learn the play in two minutes, then take your first seat.',
  howTo: 'How to Play',
  firstGame: 'Play your first game',
  dismiss: 'Dismiss',
  dismissTitle: 'Hide this welcome',
} as const;

/** Home social-proof strip ("souls around" + "fresh off the table"). */
export const SOCIAL_PROOF = {
  souls: (n: number) => `${n} ${n === 1 ? 'soul' : 'souls'} around`,
  freshHeading: 'Fresh off the table',
  // A finished-game line: "<faction> took it · <setup> · <relative>".
  result: (faction: string) => `${faction} took it`,
  draw: 'A draw',
  players: (n: number) => `${n}p`,
} as const;

/** Share-link button (GameOver + replay). */
export const SHARE = {
  button: 'Share',
  title: 'Copy a link to this game',
  copied: 'Link copied',
  failed: 'Could not copy the link.',
} as const;

/** "How to Play" guide copy (noir voice). Links out to the Glossary for roles. */
export const HOWTO = {
  topbarLink: 'How to Play',
  heading: 'How to Play',
  sub: 'A short guide to the long night. Read it once; the table will teach you the rest.',
  premiseHeading: 'The premise',
  premise:
    'A town in the dry years, full of secrets. By day the citizens talk, accuse, and vote. By night the killers move. You are dealt a role and a side — most know only their own. Win your faction’s war before the others win theirs.',
  factionsHeading: 'The sides',
  factions: [
    {
      name: 'The Town',
      blurb:
        'The honest majority — and the blind one. You do not know who your friends are. Find the wolves by their words and votes, and hang them before they thin you out.',
    },
    {
      name: 'The Mafia & the Triad',
      blurb:
        'Two informed killing crews. You know your own and you kill in the dark, one a night. Pose as townsfolk by day; outlast the room until you hold the floor.',
    },
    {
      name: 'The Coven (Vampires)',
      blurb:
        'They do not just kill — they convert. Each night the bite can turn a citizen into one of them. Left alone, they spread until they own the table.',
    },
    {
      name: 'The Cult',
      blurb:
        'Recruiters, like the Coven, but their own kind of menace. They swell their numbers by night and win by parity — when no one is left to stop them.',
    },
    {
      name: 'The Neutrals',
      blurb:
        'Lone hands with their own ends. A Serial Killer wants to be the last one breathing; others, like the Jester, win by twisting the vote itself. Trust none of them.',
    },
  ],
  loopHeading: 'The round',
  loopSteps: [
    'Day — the floor opens. Everyone talks: claim a role, read the room, point a finger.',
    'Trial — name a suspect and the table votes whether to put them up.',
    'Execution — if the vote carries, they hang, and their role is revealed.',
    'Night — the killers strike, the protectors guard, the watchers learn. Dawn shows who fell.',
  ],
  votingHeading: 'Voting & trials',
  voting:
    'A majority puts a suspect on trial. They make their case; the table votes guilty or innocent. Guilty hangs them. Spend your votes well — every wrong rope helps the other side.',
  winHeading: 'Winning',
  win:
    'Town wins when every threat is dead. A killing faction wins when it controls the room and no rival can stop it. Neutrals win on their own private terms. The night ends when only one will remains.',
  progressHeading: 'Standing & the long game',
  progress:
    'Play earns you points and a tier; ranked play tracks a separate rating. Points unlock role preferences and small perks. None of it changes the rules at the table — it is the record you build across many nights.',
  castHeading: 'The cast',
  castBlurb:
    'Every role is laid face-up in the glossary — no card here is a secret. Read a role before you claim it.',
  castLink: 'Open the glossary (“The Cast”)',
  cta: 'Take a seat',
  back: 'Back to tables',
} as const;

/**
 * Notifications center (QoL wave) — the topbar bell feed. Noir register; the
 * human text builders take already-sanitized names.
 */
export const NOTIFICATIONS = {
  open: 'The wire',
  title: 'Word from the street',
  empty: 'No word yet. The wire is quiet.',
  markAllRead: 'Mark all read',
  unreadLabel: (n: number) => `${n} unread`,
  // Per-type human lines (names are sanitized before being passed in).
  friendRequest: (who: string) => `${who} wants in with you.`,
  friendAccepted: (who: string) => `${who} took your hand.`,
  mention: (who: string) => `${who} put your name in the room.`,
  rankUp: (rank: string) => `You climbed to ${rank}.`,
  achievement: (name: string) => `Commendation earned — ${name}.`,
  // Rank-up celebration (game-over / post-match toast).
  ascendTitle: 'You ascend',
  ascend: (rank: string) => `You rise to ${rank}.`,
} as const;

/** Report-from-profile form copy (QoL wave). */
export const REPORT = {
  open: 'Report',
  heading: 'File a word with the house',
  categoryLabel: 'What for',
  commentLabel: 'Anything to add (optional)',
  commentPlaceholder: 'Keep it brief (500)…',
  submit: 'File it',
  submitting: 'Filing…',
  cancel: 'Cancel',
  success: 'Filed. The house will look into it.',
  failed: 'That word did not reach the house.',
  // Category display labels (keys mirror the shared REPORT_CATEGORIES enum).
  categories: {
    harassment: 'Harassment',
    hate: 'Hate speech',
    spam: 'Spam',
    gamethrowing: 'Throwing the game',
    cheating: 'Cheating',
  } as Record<string, string>,
} as const;

/** A seat's display label, e.g. "7 · Capone". */
export function seatLabel(seat: number, name: string): string {
  return `${seat + 1} · ${name}`;
}

/** Short seat tag, e.g. "#7". */
export function seatTag(seat: number): string {
  return `#${seat + 1}`;
}
