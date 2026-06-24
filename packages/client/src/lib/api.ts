/**
 * HTTP API client (BUILD_SPEC §4.2, §7, §13.1).
 *
 * POST /api auth (register/login/guest), GET /api/lobbies (public lobby
 * browser), via the dev proxy to :8080 (§13.1). Responses are defensively
 * narrowed by hand (the client depends on `@nocturne/shared` only plus
 * react/vite deps — no direct zod import here, DECISIONS.md). The WS
 * protocol remains the source of truth for game state; these endpoints only
 * bootstrap identity and the lobby list.
 *
 * NOTE (DECISIONS.md): the precise auth/lobby-list HTTP shapes are not
 * pinned in the spec; the client assumes a minimal JSON contract and degrades
 * gracefully (empty list, surfaced error) if the server differs.
 */

import {
  UserStatsSummarySchema,
  PointsBreakdownSchema,
  GameSetupSchema,
  type UserStatsSummary,
  type GameSetup,
} from '@nocturne/shared';
import { saveToken, saveGuestName } from './storage.js';
import type { MeState } from '../store/types.js';

export interface AuthResponse {
  token?: string;
  userId?: string;
  guestId?: string;
  name?: string;
}

export interface LobbyListItem {
  id: string;
  name: string;
  players: number;
  capacity: number;
  setupId: string;
  status: string;
  /** True for a gated test lobby (TEST badge). Normally absent — test lobbies
   * are forced private and excluded from the public browser — but surfaced if
   * the server ever lists one. */
  testMode?: boolean;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function narrowAuth(data: unknown): AuthResponse {
  if (!isObj(data)) return {};
  const out: AuthResponse = {};
  const token = str(data['token']);
  const userId = str(data['userId']);
  const guestId = str(data['guestId']);
  const name = str(data['name']);
  if (token !== undefined) out.token = token;
  if (userId !== undefined) out.userId = userId;
  if (guestId !== undefined) out.guestId = guestId;
  if (name !== undefined) out.name = name;
  return out;
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** GET helper: returns parsed JSON, throwing on a non-2xx status. */
async function getJson(path: string): Promise<unknown> {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

function bool(v: unknown): boolean {
  return v === true;
}

function applyAuth(parsed: AuthResponse): AuthResponse {
  if (parsed.token) saveToken(parsed.token);
  if (parsed.name) saveGuestName(parsed.name);
  return parsed;
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  return applyAuth(narrowAuth(await postJson('/api/login', { username, password })));
}

export async function register(
  username: string,
  password: string,
  email?: string,
): Promise<AuthResponse> {
  return applyAuth(
    narrowAuth(
      await postJson('/api/register', { username, password, ...(email ? { email } : {}) }),
    ),
  );
}

export async function guest(name?: string): Promise<AuthResponse> {
  return applyAuth(narrowAuth(await postJson('/api/guest', name ? { name } : {})));
}

/**
 * TEST MODE: fetch the full-match audit JSON and trigger a browser download
 * (host/admin only, test rooms only). `GET /api/test/match/:roomId/audit`.
 *
 * NOTE (DECISIONS-client.md): `game_started` carries no `roomId`, but the server
 * reuses the lobby id as the room id (`const roomId = lobby.id`), so the lobby
 * id IS the audit `:roomId`. We pass it through here. Throws on any failure so
 * the caller can surface a toast.
 */
export async function downloadAudit(roomId: string): Promise<void> {
  const res = await fetch(`/api/test/match/${encodeURIComponent(roomId)}/audit`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(String(res.status));
  const text = await res.text();
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nocturne-audit-${roomId}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Account / profile / progression (goals 1, 2, 3, 4, 8)
// ---------------------------------------------------------------------------

/** Narrow a `UserStatsSummary` defensively (zod-validated; null on mismatch). */
function narrowStats(data: unknown): UserStatsSummary | null {
  const parsed = UserStatsSummarySchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * `GET /api/me` — the signed-in account/guest plus inline progression stats for
 * registered users. Returns null when not authenticated (401) or on any error,
 * so callers can treat "signed out" and "offline" identically.
 */
export async function fetchMe(): Promise<MeState | null> {
  try {
    const data = await getJson('/api/me');
    if (!isObj(data)) return null;
    const id = str(data['id']);
    const name = str(data['name']);
    if (id === undefined || name === undefined) return null;
    const emailVerifiedRaw = data['emailVerified'];
    return {
      id,
      name,
      isGuest: bool(data['isGuest']),
      isAdmin: bool(data['isAdmin']),
      stats: narrowStats(data['stats']),
      emailVerified: typeof emailVerifiedRaw === 'boolean' ? emailVerifiedRaw : null,
      hasEmail: bool(data['hasEmail']),
    };
  } catch {
    return null;
  }
}

/** `GET /api/stats/:userId` — a public profile summary, or null on any failure. */
export async function fetchStats(userId: string): Promise<UserStatsSummary | null> {
  try {
    return narrowStats(await getJson(`/api/stats/${encodeURIComponent(userId)}`));
  } catch {
    return null;
  }
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  totalPoints: number;
  gamesPlayed: number;
  gamesWon: number;
}

/** `GET /api/leaderboard` — ranked entries (server-ordered). [] on failure. */
export async function fetchLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
  try {
    const data = await getJson(`/api/leaderboard?limit=${encodeURIComponent(String(limit))}`);
    const list = isObj(data) ? data['entries'] : undefined;
    if (!Array.isArray(list)) return [];
    return list.filter(isObj).map((e) => ({
      userId: str(e['userId']) ?? '',
      username: str(e['username']) ?? '',
      totalPoints: num(e['totalPoints']),
      gamesPlayed: num(e['gamesPlayed']),
      gamesWon: num(e['gamesWon']),
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Ranked play (MMR leaderboard + per-user rank)
// ---------------------------------------------------------------------------

/** One row of the ranked (MMR) leaderboard. */
export interface RankedLeaderboardEntry {
  /** Absolute 1-based board position (across pages). */
  position: number;
  userId: string;
  username: string;
  mmr: number;
  rd: number;
  /** Rank key (RANK_TIERS.key), derived server-side from mmr. */
  rank: string;
  /** Rank display name (RANK_TIERS.name). */
  rankName: string;
  gamesPlayed: number;
  gamesWon: number;
  /** Set when the player has not yet completed their placement games. */
  placements?: { played: number; total: number };
}

/** A page of the ranked leaderboard plus paging metadata. */
export interface RankedLeaderboardPage {
  entries: RankedLeaderboardEntry[];
  seasonId: string | null;
  page: number;
  limit: number;
  total: number;
}

function narrowRankedEntry(e: Record<string, unknown>, fallbackPos: number): RankedLeaderboardEntry {
  const p = isObj(e['placements']) ? e['placements'] : null;
  return {
    position: typeof e['position'] === 'number' ? num(e['position']) : fallbackPos,
    userId: str(e['userId']) ?? '',
    username: str(e['username']) ?? '',
    mmr: num(e['mmr']),
    rd: num(e['rd']),
    rank: str(e['rank']) ?? 'stray',
    rankName: str(e['rankName']) ?? '',
    gamesPlayed: num(e['games']),
    gamesWon: num(e['wins']),
    ...(p ? { placements: { played: num(p['played']), total: num(p['total']) } } : {}),
  };
}

/**
 * `GET /api/leaderboard/ranked` — a PAGE of MMR rankings for a season (defaults
 * to the current). Each entry carries the derived rank so the client renders the
 * ladder badge; unplaced players carry a `placements` marker. Returns an empty
 * page on any failure (no season, no persistence, network error).
 */
export async function fetchRankedLeaderboard(
  opts: { page?: number; limit?: number; seasonId?: string } = {},
): Promise<RankedLeaderboardPage> {
  const empty: RankedLeaderboardPage = { entries: [], seasonId: null, page: 0, limit: 0, total: 0 };
  try {
    const limit = opts.limit ?? 50;
    const page = opts.page ?? 0;
    const qs = new URLSearchParams({ limit: String(limit), page: String(page) });
    if (opts.seasonId) qs.set('seasonId', opts.seasonId);
    const data = await getJson(`/api/leaderboard/ranked?${qs.toString()}`);
    if (!isObj(data)) return empty;
    const list = data['entries'];
    if (!Array.isArray(list)) return empty;
    const respPage = num(data['page']);
    const respLimit = num(data['limit']);
    return {
      entries: list
        .filter(isObj)
        .map((e, i) => narrowRankedEntry(e, respPage * respLimit + i + 1)),
      seasonId: str(data['seasonId']) ?? null,
      page: respPage,
      limit: respLimit,
      total: num(data['total']),
    };
  } catch {
    return empty;
  }
}

/** One season in the archive (for the leaderboard's season filter). */
export interface SeasonInfo {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  isCurrent: boolean;
}

/** `GET /api/seasons` — the season archive, newest first. [] on any failure. */
export async function fetchSeasons(): Promise<SeasonInfo[]> {
  try {
    const data = await getJson('/api/seasons');
    const list = isObj(data) ? data['seasons'] : undefined;
    if (!Array.isArray(list)) return [];
    return list.filter(isObj).map((s) => ({
      id: str(s['id']) ?? '',
      name: str(s['name']) ?? '',
      startedAt: num(s['startedAt']),
      endedAt: numOrNull(s['endedAt']),
      isCurrent: s['isCurrent'] === true,
    }));
  } catch {
    return [];
  }
}

/** The signed-in account's own ranked position + standing (current season). */
export interface MyRank {
  position: number;
  mmr: number;
  rank: string;
  rankName: string;
  games: number;
  wins: number;
  placements?: { played: number; total: number };
}

/** `GET /api/me/ranked/rank` — the caller's rank position, or null if unplaced. */
export async function fetchMyRank(): Promise<MyRank | null> {
  try {
    const data = await getJson('/api/me/ranked/rank');
    const r = isObj(data) ? data['rank'] : null;
    if (!isObj(r)) return null;
    const p = isObj(r['placements']) ? r['placements'] : null;
    return {
      position: num(r['position']),
      mmr: num(r['mmr']),
      rank: str(r['rank']) ?? 'stray',
      rankName: str(r['rankName']) ?? '',
      games: num(r['games']),
      wins: num(r['wins']),
      ...(p ? { placements: { played: num(p['played']), total: num(p['total']) } } : {}),
    };
  } catch {
    return null;
  }
}

/** One row of the caller's recent ranked match history. */
export interface RankedHistoryEntry {
  matchId: string;
  mmrBefore: number;
  mmrAfter: number;
  delta: number;
}

/** `GET /api/me/ranked/history` — the caller's recent ranked results. [] on failure. */
export async function fetchMyRankedHistory(limit = 20): Promise<RankedHistoryEntry[]> {
  try {
    const data = await getJson(`/api/me/ranked/history?limit=${encodeURIComponent(String(limit))}`);
    const list = isObj(data) ? data['history'] : undefined;
    if (!Array.isArray(list)) return [];
    return list.filter(isObj).map((h) => ({
      matchId: str(h['matchId']) ?? '',
      mmrBefore: num(h['mmrBefore']),
      mmrAfter: num(h['mmrAfter']),
      delta: num(h['delta']),
    }));
  } catch {
    return [];
  }
}

export interface AchievementCatalogEntry {
  key: string;
  name: string;
  description: string;
  points: number;
}

/** `GET /api/achievements` — the achievement catalog. [] on failure. */
export async function fetchAchievements(): Promise<AchievementCatalogEntry[]> {
  try {
    const data = await getJson('/api/achievements');
    const list = isObj(data) ? data['achievements'] : undefined;
    if (!Array.isArray(list)) return [];
    return list.filter(isObj).map((a) => ({
      key: str(a['key']) ?? '',
      name: str(a['name']) ?? '',
      description: str(a['description']) ?? '',
      points: num(a['points']),
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Setups: shipped catalog, daily/chaos, custom builder (goals 4, 5)
// ---------------------------------------------------------------------------

export interface SetupSummary {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  chaos: boolean;
}

function narrowSetupSummary(v: unknown): SetupSummary | null {
  if (!isObj(v)) return null;
  const id = str(v['id']);
  const name = str(v['name']);
  if (id === undefined || name === undefined) return null;
  return {
    id,
    name,
    description: str(v['description']) ?? '',
    minPlayers: num(v['minPlayers']),
    maxPlayers: num(v['maxPlayers']),
    chaos: bool(v['chaos']),
  };
}

/** `GET /api/setups` — the shipped setup catalog. [] on failure. */
export async function fetchSetups(): Promise<SetupSummary[]> {
  try {
    const data = await getJson('/api/setups');
    const list = isObj(data) ? data['setups'] : undefined;
    if (!Array.isArray(list)) return [];
    return list.map(narrowSetupSummary).filter((s): s is SetupSummary => s !== null);
  } catch {
    return [];
  }
}

export interface DailySetups {
  date: string;
  featured: GameSetup | null;
  chaos: { id: string; seed: string; setup: GameSetup } | null;
}

/** `GET /api/setups/daily` — today's featured + chaos setups. Null fields on failure. */
export async function fetchDailySetups(): Promise<DailySetups> {
  try {
    const data = await getJson('/api/setups/daily');
    if (!isObj(data)) return { date: '', featured: null, chaos: null };
    const featuredParsed = GameSetupSchema.safeParse(data['featured']);
    let chaos: DailySetups['chaos'] = null;
    const chaosRaw = data['chaos'];
    if (isObj(chaosRaw)) {
      const setupParsed = GameSetupSchema.safeParse(chaosRaw['setup']);
      const id = str(chaosRaw['id']);
      const seed = str(chaosRaw['seed']);
      if (setupParsed.success && id !== undefined && seed !== undefined) {
        chaos = { id, seed, setup: setupParsed.data };
      }
    }
    return {
      date: str(data['date']) ?? '',
      featured: featuredParsed.success ? featuredParsed.data : null,
      chaos,
    };
  } catch {
    return { date: '', featured: null, chaos: null };
  }
}

export interface CustomSetupRecord {
  id: string;
  name: string;
  setup: GameSetup;
  createdAt: string;
}

/** `GET /api/setups/custom` — the caller's saved setups. [] on failure. */
export async function fetchCustomSetups(): Promise<CustomSetupRecord[]> {
  try {
    const data = await getJson('/api/setups/custom');
    const list = isObj(data) ? data['setups'] : undefined;
    if (!Array.isArray(list)) return [];
    const out: CustomSetupRecord[] = [];
    for (const r of list) {
      if (!isObj(r)) continue;
      const id = str(r['id']);
      const name = str(r['name']);
      const parsed = GameSetupSchema.safeParse(r['setup']);
      if (id !== undefined && name !== undefined && parsed.success) {
        out.push({ id, name, setup: parsed.data, createdAt: str(r['createdAt']) ?? '' });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** The result of attempting to save a custom setup (goal 4). */
export type SaveSetupResult = { ok: true; id: string } | { ok: false; errors: string[] };

/**
 * `POST /api/setups/custom` — save a custom setup. On a 400 `invalid_setup`,
 * returns the server's validation error list so the UI can show them inline.
 */
export async function saveCustomSetup(name: string, setup: GameSetup): Promise<SaveSetupResult> {
  const res = await fetch('/api/setups/custom', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name, setup }),
  });
  if (res.ok) {
    const data: unknown = await res.json().catch(() => ({}));
    const id = isObj(data) ? str(data['id']) : undefined;
    return { ok: true, id: id ?? '' };
  }
  // Surface inline validation errors when present.
  const data: unknown = await res.json().catch(() => ({}));
  if (isObj(data) && Array.isArray(data['errors'])) {
    return { ok: false, errors: data['errors'].filter((e): e is string => typeof e === 'string') };
  }
  if (res.status === 401) return { ok: false, errors: ['You must be signed in to save a setup.'] };
  if (res.status === 403)
    return { ok: false, errors: ['Registered accounts only — guests cannot save setups.'] };
  return { ok: false, errors: [`The house refused the setup (${res.status}).`] };
}

/** `DELETE /api/setups/custom/:id` — remove a saved setup. true on success. */
export async function deleteCustomSetup(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/setups/custom/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Replay (goal 7)
// ---------------------------------------------------------------------------

/** A single recorded match event (folded through the engine in the viewer). */
export interface ReplayEvent {
  seq: number;
  phase: string;
  event: unknown;
}

/** A single recorded chat line in a replay transcript. */
export interface ReplayChat {
  seq: number;
  channel: string;
  senderSeat: number | null;
  body: string;
}

export interface ReplayPlayer {
  userOrGuestId: string;
  seat: number;
  role: string;
  faction: string;
  outcome: string;
  survived: boolean;
  deathDay: number | null;
}

export interface MatchReplay {
  schemaVersion: number;
  game: string;
  serverBuild: string;
  integrity: { fingerprint: string; verified: boolean };
  match: {
    id: string;
    setupId: string;
    config: unknown;
    seed: string;
    startedAt: string;
    endedAt: string;
    outcome: string;
    serverBuild: string;
    fingerprint: string;
    players: ReplayPlayer[];
    events: ReplayEvent[];
    chat: ReplayChat[];
  };
}

function narrowReplayPlayer(v: unknown): ReplayPlayer | null {
  if (!isObj(v)) return null;
  return {
    userOrGuestId: str(v['userOrGuestId']) ?? '',
    seat: num(v['seat']),
    role: str(v['role']) ?? 'CITIZEN',
    faction: str(v['faction']) ?? 'TOWN',
    outcome: str(v['outcome']) ?? 'draw',
    survived: bool(v['survived']),
    deathDay: typeof v['deathDay'] === 'number' ? (v['deathDay'] as number) : null,
  };
}

/**
 * `GET /api/matches/:matchId/replay` — the full, fingerprinted replay. Returns
 * null on any failure (not a participant, no such match, server error).
 */
export async function fetchReplay(matchId: string): Promise<MatchReplay | null> {
  try {
    const data = await getJson(`/api/matches/${encodeURIComponent(matchId)}/replay`);
    if (!isObj(data)) return null;
    const m = data['match'];
    if (!isObj(m)) return null;
    const integrity = isObj(data['integrity']) ? data['integrity'] : {};
    const players = Array.isArray(m['players'])
      ? m['players'].map(narrowReplayPlayer).filter((p): p is ReplayPlayer => p !== null)
      : [];
    const events = Array.isArray(m['events'])
      ? m['events']
          .filter(isObj)
          .map((e) => ({ seq: num(e['seq']), phase: str(e['phase']) ?? '', event: e['event'] }))
      : [];
    const chat = Array.isArray(m['chat'])
      ? m['chat'].filter(isObj).map((c) => ({
          seq: num(c['seq']),
          channel: str(c['channel']) ?? 'day',
          senderSeat: typeof c['senderSeat'] === 'number' ? (c['senderSeat'] as number) : null,
          body: str(c['body']) ?? '',
        }))
      : [];
    return {
      schemaVersion: num(data['schemaVersion']),
      game: str(data['game']) ?? '',
      serverBuild: str(data['serverBuild']) ?? '',
      integrity: {
        fingerprint: str(integrity['fingerprint']) ?? '',
        verified: bool(integrity['verified']),
      },
      match: {
        id: str(m['id']) ?? matchId,
        setupId: str(m['setupId']) ?? '',
        config: m['config'],
        seed: str(m['seed']) ?? '',
        startedAt: str(m['startedAt']) ?? '',
        endedAt: str(m['endedAt']) ?? '',
        outcome: str(m['outcome']) ?? '',
        serverBuild: str(m['serverBuild']) ?? '',
        fingerprint: str(m['fingerprint']) ?? '',
        players,
        events,
        chat,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Trigger a browser download of the raw replay JSON (the endpoint sets a
 * content-disposition attachment header). Throws on failure for a toast.
 */
export async function downloadReplay(matchId: string): Promise<void> {
  const res = await fetch(`/api/matches/${encodeURIComponent(matchId)}/replay`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(String(res.status));
  const text = await res.text();
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nocturne-replay-${matchId}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Role preferences (point-unlocked, goal 3)
// ---------------------------------------------------------------------------

/** A single stored role preference. */
export interface RolePreferenceItem {
  role: string;
  preference: 'blacklist' | 'prefer';
}

/** What the caller's lifetime points have unlocked (mirrors shared `UnlockState`). */
export interface PreferenceUnlocks {
  canBlacklistRoles: boolean;
  canPreferRoles: boolean;
  nextUnlock: { label: string; at: number } | null;
}

export interface PreferencesResponse {
  unlocks: PreferenceUnlocks;
  preferences: RolePreferenceItem[];
}

const LOCKED_UNLOCKS: PreferenceUnlocks = {
  canBlacklistRoles: false,
  canPreferRoles: false,
  nextUnlock: null,
};

function narrowUnlocks(v: unknown): PreferenceUnlocks {
  if (!isObj(v)) return LOCKED_UNLOCKS;
  let nextUnlock: PreferenceUnlocks['nextUnlock'] = null;
  const nu = v['nextUnlock'];
  if (isObj(nu)) {
    const label = str(nu['label']);
    if (label !== undefined) nextUnlock = { label, at: num(nu['at']) };
  }
  return {
    canBlacklistRoles: bool(v['canBlacklistRoles']),
    canPreferRoles: bool(v['canPreferRoles']),
    nextUnlock,
  };
}

/**
 * `GET /api/me/preferences` — the caller's role preferences plus their unlock
 * state. Returns locked unlocks + [] on any failure (signed out / offline).
 */
export async function fetchPreferences(): Promise<PreferencesResponse> {
  try {
    const data = await getJson('/api/me/preferences');
    if (!isObj(data)) return { unlocks: LOCKED_UNLOCKS, preferences: [] };
    const list = Array.isArray(data['preferences']) ? data['preferences'] : [];
    const preferences: RolePreferenceItem[] = [];
    for (const r of list) {
      if (!isObj(r)) continue;
      const role = str(r['role']);
      const pref = str(r['preference']);
      if (role !== undefined && (pref === 'blacklist' || pref === 'prefer')) {
        preferences.push({ role, preference: pref });
      }
    }
    return { unlocks: narrowUnlocks(data['unlocks']), preferences };
  } catch {
    return { unlocks: LOCKED_UNLOCKS, preferences: [] };
  }
}

/** The result of attempting to set a role preference. */
export type SetPreferenceResult =
  | { ok: true }
  | { ok: false; status: number; locked?: 'blacklist' | 'prefer' };

/**
 * `POST /api/preferences` — set (`'blacklist'|'prefer'`) or clear (`null`) a
 * role's preference. The server enforces the unlock gate (403 `locked`); callers
 * surface that as a "not yet unlocked" message.
 */
export async function setPreference(
  role: string,
  preference: 'blacklist' | 'prefer' | null,
): Promise<SetPreferenceResult> {
  try {
    const res = await fetch('/api/preferences', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ role, preference }),
    });
    if (res.ok) return { ok: true };
    const data: unknown = await res.json().catch(() => ({}));
    const locked = isObj(data) ? str(data['unlock']) : undefined;
    return {
      ok: false,
      status: res.status,
      ...(locked === 'blacklist' || locked === 'prefer' ? { locked } : {}),
    };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Logout helper (clears the server session; the cookie is httpOnly). */
export async function logout(): Promise<void> {
  try {
    await postJson('/api/logout', {});
  } catch {
    /* ignore — best effort */
  }
}

// ---------------------------------------------------------------------------
// Account lifecycle: password reset + email verification (retention wave)
// ---------------------------------------------------------------------------

/**
 * `POST /api/password/forgot` — request a reset link for a username OR email.
 * Always resolves (the server returns 200 regardless to avoid account
 * enumeration); resolves false only on a transport error so the caller can
 * still show the neutral "if that account exists…" copy.
 */
export async function forgotPassword(identifier: string): Promise<boolean> {
  try {
    await postJson('/api/password/forgot', { identifier });
    return true;
  } catch {
    return false;
  }
}

/**
 * `POST /api/password/reset` — set a new password from a reset token. Returns
 * true on success, false if the token was invalid/expired or on any error.
 */
export async function resetPassword(token: string, password: string): Promise<boolean> {
  try {
    const data = await postJson('/api/password/reset', { token, password });
    return isObj(data) && data['ok'] === true;
  } catch {
    return false;
  }
}

/**
 * `POST /api/email/verify` — confirm an email from a verification token.
 * Returns true on success, false on an invalid/expired token or any error.
 */
export async function verifyEmail(token: string): Promise<boolean> {
  try {
    const data = await postJson('/api/email/verify', { token });
    return isObj(data) && data['ok'] === true;
  } catch {
    return false;
  }
}

/**
 * `POST /api/email/resend` — re-issue a verification link for the signed-in
 * account's email (when unverified). Best-effort; true unless the call errored.
 */
export async function resendVerification(): Promise<boolean> {
  try {
    await postJson('/api/email/resend', {});
    return true;
  } catch {
    return false;
  }
}

// Re-export for callers that only narrow points breakdowns from untrusted JSON.
export { PointsBreakdownSchema };

// ---------------------------------------------------------------------------
// Social: profiles, friends, direct messages, public rooms, presence
// ---------------------------------------------------------------------------

/** A public profile composite (`GET /api/users/:username/profile`). */
export interface PublicProfile {
  id: string;
  username: string;
  memberSince: number | null;
  tagline: string | null;
  bio: string | null;
  accent: string | null;
  lastSeen: number | null;
  stats: {
    totalPoints: number;
    gamesPlayed: number;
    gamesWon: number;
    gamesSurvived: number;
    tier: string;
  } | null;
  ranked: {
    mmr: number;
    rank: string;
    rankName: string;
    games: number;
    wins: number;
  } | null;
  achievements: string[];
  /** Computed only for an authed non-guest viewing someone else; else null. */
  friendship: 'none' | 'pending_out' | 'pending_in' | 'friends' | 'self' | null;
  /** Whether the viewer has blocked this user (null for guests/anon/self). */
  blocked: boolean | null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** `GET /api/users/:username/profile` — public profile, or null on any failure. */
export async function fetchPublicProfile(username: string): Promise<PublicProfile | null> {
  try {
    const d = await getJson(`/api/users/${encodeURIComponent(username)}/profile`);
    if (!isObj(d)) return null;
    const id = str(d['id']);
    const name = str(d['username']);
    if (id === undefined || name === undefined) return null;
    const s = isObj(d['stats']) ? d['stats'] : null;
    const r = isObj(d['ranked']) ? d['ranked'] : null;
    const fr = str(d['friendship']);
    const friendship =
      fr === 'none' || fr === 'pending_out' || fr === 'pending_in' || fr === 'friends' || fr === 'self'
        ? fr
        : null;
    return {
      id,
      username: name,
      memberSince: numOrNull(d['memberSince']),
      tagline: str(d['tagline']) ?? null,
      bio: str(d['bio']) ?? null,
      accent: str(d['accent']) ?? null,
      lastSeen: numOrNull(d['lastSeen']),
      stats: s
        ? {
            totalPoints: num(s['totalPoints']),
            gamesPlayed: num(s['gamesPlayed']),
            gamesWon: num(s['gamesWon']),
            gamesSurvived: num(s['gamesSurvived']),
            tier: str(s['tier']) ?? 'stray',
          }
        : null,
      ranked: r
        ? {
            mmr: num(r['mmr']),
            rank: str(r['rank']) ?? 'stray',
            rankName: str(r['rankName']) ?? '',
            games: num(r['games']),
            wins: num(r['wins']),
          }
        : null,
      achievements: Array.isArray(d['achievements'])
        ? d['achievements'].filter((a): a is string => typeof a === 'string')
        : [],
      friendship,
      blocked: typeof d['blocked'] === 'boolean' ? d['blocked'] : null,
    };
  } catch {
    return null;
  }
}

/** `POST /api/me/profile` — edit own profile. true on success. */
export async function saveProfile(fields: {
  tagline?: string;
  bio?: string;
  accent?: string;
}): Promise<boolean> {
  try {
    const res = await fetch('/api/me/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(fields),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface FriendItem {
  userId: string;
  username: string;
  lastSeen: number | null;
}
export interface FriendRequestItem {
  id: string;
  userId: string;
  username: string;
  createdAt: number;
}
export interface DmThreadItem {
  threadId: string;
  otherUserId: string;
  otherUsername: string;
  lastAt: number;
  preview: string;
  /** Unread messages from the other party since the caller last read (social v1). */
  unread: number;
}
export interface SocialState {
  friends: FriendItem[];
  requests: { incoming: FriendRequestItem[]; outgoing: FriendRequestItem[] };
  threads: DmThreadItem[];
  /** Total unread DMs across all threads (topbar Messages badge). */
  unreadTotal: number;
}

function narrowFriend(v: unknown): FriendItem | null {
  if (!isObj(v)) return null;
  const userId = str(v['userId']);
  if (userId === undefined) return null;
  return { userId, username: str(v['username']) ?? userId, lastSeen: numOrNull(v['lastSeen']) };
}
function narrowRequest(v: unknown): FriendRequestItem | null {
  if (!isObj(v)) return null;
  const id = str(v['id']);
  const userId = str(v['userId']);
  if (id === undefined || userId === undefined) return null;
  return { id, userId, username: str(v['username']) ?? userId, createdAt: num(v['createdAt']) };
}
function narrowThread(v: unknown): DmThreadItem | null {
  if (!isObj(v)) return null;
  const threadId = str(v['threadId']);
  const otherUserId = str(v['otherUserId']);
  if (threadId === undefined || otherUserId === undefined) return null;
  return {
    threadId,
    otherUserId,
    otherUsername: str(v['otherUsername']) ?? otherUserId,
    lastAt: num(v['lastAt']),
    preview: str(v['preview']) ?? '',
    unread: num(v['unread']),
  };
}

const EMPTY_SOCIAL: SocialState = {
  friends: [],
  requests: { incoming: [], outgoing: [] },
  threads: [],
  unreadTotal: 0,
};

/** `GET /api/me/social` — the caller's friends, requests, and DM threads. */
export async function fetchSocial(): Promise<SocialState> {
  try {
    const d = await getJson('/api/me/social');
    if (!isObj(d)) return EMPTY_SOCIAL;
    const friends = Array.isArray(d['friends'])
      ? d['friends'].map(narrowFriend).filter((x): x is FriendItem => x !== null)
      : [];
    const reqs = isObj(d['requests']) ? d['requests'] : {};
    const incoming = Array.isArray(reqs['incoming'])
      ? reqs['incoming'].map(narrowRequest).filter((x): x is FriendRequestItem => x !== null)
      : [];
    const outgoing = Array.isArray(reqs['outgoing'])
      ? reqs['outgoing'].map(narrowRequest).filter((x): x is FriendRequestItem => x !== null)
      : [];
    const threads = Array.isArray(d['threads'])
      ? d['threads'].map(narrowThread).filter((x): x is DmThreadItem => x !== null)
      : [];
    return { friends, requests: { incoming, outgoing }, threads, unreadTotal: num(d['unreadTotal']) };
  } catch {
    return EMPTY_SOCIAL;
  }
}

/** The result of a friend request (`POST /api/friends/request`). */
export type FriendRequestResult =
  | { ok: true; result: 'created' | 'exists' | 'accepted' }
  | { ok: false; status: number };

/** `POST /api/friends/request` { username }. */
export async function requestFriend(username: string): Promise<FriendRequestResult> {
  try {
    const res = await fetch('/api/friends/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username }),
    });
    if (res.ok) {
      const d: unknown = await res.json().catch(() => ({}));
      const r = isObj(d) ? str(d['result']) : undefined;
      return {
        ok: true,
        result: r === 'exists' || r === 'accepted' ? r : 'created',
      };
    }
    return { ok: false, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** `POST /api/friends/respond` { id, accept }. true on success. */
export async function respondFriend(id: string, accept: boolean): Promise<boolean> {
  try {
    const res = await fetch('/api/friends/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id, accept }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** `DELETE /api/friends/:otherUserId`. true on success. */
export async function removeFriend(otherUserId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/friends/${encodeURIComponent(otherUserId)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** A user-search hit (social v1). */
export interface UserHit {
  id: string;
  username: string;
}

function narrowUserHit(v: unknown): UserHit | null {
  if (!isObj(v)) return null;
  const id = str(v['id']);
  const username = str(v['username']);
  if (id === undefined || username === undefined) return null;
  return { id, username };
}

/** `GET /api/users/search?q=` — username search (min 2 chars). [] on failure/short query. */
export async function searchUsers(q: string): Promise<UserHit[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) return [];
  try {
    const d = await getJson(`/api/users/search?q=${encodeURIComponent(trimmed)}`);
    const list = isObj(d) ? d['users'] : undefined;
    if (!Array.isArray(list)) return [];
    return list.map(narrowUserHit).filter((u): u is UserHit => u !== null);
  } catch {
    return [];
  }
}

/** `POST /api/blocks` { username|userId, on }. true on success (social v1). */
export async function setBlock(
  target: { username?: string; userId?: string },
  on: boolean,
): Promise<boolean> {
  try {
    const res = await fetch('/api/blocks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ ...target, on }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** `GET /api/me/blocks` — the caller's blocked users. [] on failure (social v1). */
export async function fetchBlocks(): Promise<UserHit[]> {
  try {
    const d = await getJson('/api/me/blocks');
    const list = isObj(d) ? d['users'] : undefined;
    if (!Array.isArray(list)) return [];
    return list.map(narrowUserHit).filter((u): u is UserHit => u !== null);
  } catch {
    return [];
  }
}

/** `POST /api/dms/:otherUserId/read` — mark a thread read (clears unread). */
export async function markDmRead(otherUserId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/dms/${encodeURIComponent(otherUserId)}/read`, {
      method: 'POST',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** `DELETE /api/dms/messages/:id` — soft-delete one of your DMs (social v1). */
export async function deleteDm(messageId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/dms/messages/${encodeURIComponent(messageId)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** `DELETE /api/rooms/messages/:id` — soft-delete one of your room messages. */
export async function deleteRoomMessage(messageId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/rooms/messages/${encodeURIComponent(messageId)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** A public chat room (the shoutbox or a channel). */
export interface ChatRoom {
  slug: string;
  name: string;
  topic: string;
  kind: 'shoutbox' | 'channel';
  sort: number;
  /** Distinct posters in the last ~10 min — an "alive" signal, not true presence. */
  activeCount: number;
}

/** A single posted room message. */
export interface RoomMessage {
  id: string;
  userId: string;
  username: string;
  body: string;
  createdAt: number;
  /** Soft-delete tombstone: the client renders "[removed]" (social v1). */
  deleted: boolean;
}

function narrowRoom(v: unknown): ChatRoom | null {
  if (!isObj(v)) return null;
  const slug = str(v['slug']);
  const name = str(v['name']);
  if (slug === undefined || name === undefined) return null;
  const kind = str(v['kind']) === 'shoutbox' ? 'shoutbox' : 'channel';
  return {
    slug,
    name,
    topic: str(v['topic']) ?? '',
    kind,
    sort: num(v['sort']),
    activeCount: num(v['activeCount']),
  };
}
function narrowRoomMessage(v: unknown): RoomMessage | null {
  if (!isObj(v)) return null;
  const id = str(v['id']);
  if (id === undefined) return null;
  return {
    id,
    userId: str(v['userId']) ?? '',
    username: str(v['username']) ?? '',
    body: str(v['body']) ?? '',
    createdAt: num(v['createdAt']),
    deleted: bool(v['deleted']),
  };
}

/** `GET /api/rooms` — public room list. [] on failure. */
export async function fetchRooms(): Promise<ChatRoom[]> {
  try {
    const d = await getJson('/api/rooms');
    const list = isObj(d) ? d['rooms'] : undefined;
    if (!Array.isArray(list)) return [];
    return list.map(narrowRoom).filter((r): r is ChatRoom => r !== null);
  } catch {
    return [];
  }
}

/** `GET /api/rooms/:slug/messages` — newest `limit` ascending; delta past `sinceId`. */
export async function fetchRoomMessages(
  slug: string,
  opts: { sinceId?: string; limit?: number } = {},
): Promise<RoomMessage[]> {
  try {
    const params = new URLSearchParams();
    if (opts.sinceId) params.set('sinceId', opts.sinceId);
    if (opts.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    const d = await getJson(`/api/rooms/${encodeURIComponent(slug)}/messages${qs ? `?${qs}` : ''}`);
    const list = isObj(d) ? d['messages'] : undefined;
    if (!Array.isArray(list)) return [];
    return list.map(narrowRoomMessage).filter((m): m is RoomMessage => m !== null);
  } catch {
    return [];
  }
}

/** The result of posting to a room. */
export type PostResult<T> = { ok: true; message: T } | { ok: false; status: number };

/** `POST /api/rooms/:slug/messages` { body }. */
export async function postRoomMessage(
  slug: string,
  body: string,
): Promise<PostResult<RoomMessage>> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(slug)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ body }),
    });
    if (res.ok) {
      const d: unknown = await res.json().catch(() => ({}));
      const m = isObj(d) ? narrowRoomMessage(d['message']) : null;
      if (m) return { ok: true, message: m };
      return { ok: false, status: res.status };
    }
    return { ok: false, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** A single direct message. */
export interface DmMessage {
  id: string;
  senderId: string;
  body: string;
  createdAt: number;
  /** Soft-delete tombstone: the client renders "[removed]" (social v1). */
  deleted: boolean;
}

function narrowDm(v: unknown): DmMessage | null {
  if (!isObj(v)) return null;
  const id = str(v['id']);
  if (id === undefined) return null;
  return {
    id,
    senderId: str(v['senderId']) ?? '',
    body: str(v['body']) ?? '',
    createdAt: num(v['createdAt']),
    deleted: bool(v['deleted']),
  };
}

/** `GET /api/dms/:otherUserId` — ensures the thread; returns its id + messages. */
export async function fetchDms(
  otherUserId: string,
  opts: { sinceId?: string; limit?: number } = {},
): Promise<{ threadId: string; messages: DmMessage[] } | null> {
  try {
    const params = new URLSearchParams();
    if (opts.sinceId) params.set('sinceId', opts.sinceId);
    if (opts.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    const d = await getJson(`/api/dms/${encodeURIComponent(otherUserId)}${qs ? `?${qs}` : ''}`);
    if (!isObj(d)) return null;
    const threadId = str(d['threadId']);
    if (threadId === undefined) return null;
    const messages = Array.isArray(d['messages'])
      ? d['messages'].map(narrowDm).filter((m): m is DmMessage => m !== null)
      : [];
    return { threadId, messages };
  } catch {
    return null;
  }
}

/** `POST /api/dms/:otherUserId` { body }. */
export async function postDm(otherUserId: string, body: string): Promise<PostResult<DmMessage>> {
  try {
    const res = await fetch(`/api/dms/${encodeURIComponent(otherUserId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ body }),
    });
    if (res.ok) {
      const d: unknown = await res.json().catch(() => ({}));
      const m = isObj(d) ? narrowDm(d['message']) : null;
      if (m) return { ok: true, message: m };
      return { ok: false, status: res.status };
    }
    return { ok: false, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

// ---------------------------------------------------------------------------
// Notifications center (QoL wave): the topbar bell feed + report-from-profile.
// Account-only; all server-derived names are sanitized at the render layer.
// ---------------------------------------------------------------------------

/** A notification kind (mirrors shared `NotificationType`). */
export type NotificationKind =
  | 'friend_request'
  | 'friend_accepted'
  | 'mention'
  | 'rank_up'
  | 'achievement';

/** One notification from the bell feed. `payload` is small, render-safe JSON. */
export interface NotificationItem {
  id: string;
  type: NotificationKind;
  payload: Record<string, unknown>;
  createdAt: number;
  readAt: number | null;
}

const NOTIFICATION_KINDS: ReadonlySet<string> = new Set([
  'friend_request',
  'friend_accepted',
  'mention',
  'rank_up',
  'achievement',
]);

function narrowNotification(v: unknown): NotificationItem | null {
  if (!isObj(v)) return null;
  const id = str(v['id']);
  const type = str(v['type']);
  if (id === undefined || type === undefined || !NOTIFICATION_KINDS.has(type)) return null;
  const payload = isObj(v['payload']) ? (v['payload'] as Record<string, unknown>) : {};
  return {
    id,
    type: type as NotificationKind,
    payload,
    createdAt: num(v['createdAt']),
    readAt: numOrNull(v['readAt']),
  };
}

/** The bell feed plus the unread count. */
export interface NotificationsState {
  notifications: NotificationItem[];
  unread: number;
}

const EMPTY_NOTIFICATIONS: NotificationsState = { notifications: [], unread: 0 };

/** `GET /api/me/notifications?limit=` — recent notifications + unread count. */
export async function fetchNotifications(limit = 30): Promise<NotificationsState> {
  try {
    const d = await getJson(`/api/me/notifications?limit=${encodeURIComponent(String(limit))}`);
    if (!isObj(d)) return EMPTY_NOTIFICATIONS;
    const list = Array.isArray(d['notifications'])
      ? d['notifications'].map(narrowNotification).filter((n): n is NotificationItem => n !== null)
      : [];
    return { notifications: list, unread: num(d['unread']) };
  } catch {
    return EMPTY_NOTIFICATIONS;
  }
}

/**
 * `POST /api/me/notifications/read` { ids? } — mark the given ids read, or ALL
 * when omitted. Returns the new unread count (-1 on failure so callers can
 * distinguish an error from a genuine 0).
 */
export async function markNotificationsRead(ids?: string[]): Promise<number> {
  try {
    const d = await postJson('/api/me/notifications/read', ids ? { ids } : {});
    return isObj(d) && typeof d['unread'] === 'number' ? (d['unread'] as number) : 0;
  } catch {
    return -1;
  }
}

/** The result of reporting a user from their profile (QoL wave). */
export type ReportUserResult = { ok: true } | { ok: false; status: number };

/** `POST /api/users/:username/report` { category, comment? }. */
export async function reportUser(
  username: string,
  category: string,
  comment?: string,
): Promise<ReportUserResult> {
  try {
    const res = await fetch(`/api/users/${encodeURIComponent(username)}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ category, ...(comment ? { comment } : {}) }),
    });
    if (res.ok) return { ok: true };
    return { ok: false, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** `POST /api/presence/ping` — best-effort heartbeat (ignored on failure). */
export async function pingPresence(): Promise<void> {
  try {
    await fetch('/api/presence/ping', { method: 'POST', credentials: 'include' });
  } catch {
    /* best effort */
  }
}

// ---------------------------------------------------------------------------
// Forums: categories → boards → threads (topics) → posts (Forums feature)
// ---------------------------------------------------------------------------

/** The "Last post" summary on a board (forum-index column). */
export interface ForumLastPost {
  threadId: string;
  threadTitle: string;
  at: number;
  username: string;
}

/** A board as listed on the forum index (with aggregate stats + last post). */
export interface ForumIndexBoard {
  slug: string;
  name: string;
  description: string;
  sort: number;
  threadCount: number;
  postCount: number;
  lastPost: ForumLastPost | null;
}

/** A category (header bar) with its ordered boards. */
export interface ForumIndexCategory {
  category: { slug: string; name: string; sort: number };
  boards: ForumIndexBoard[];
}

/** A board header (name + description). */
export interface ForumBoard {
  slug: string;
  name: string;
  description: string;
}

/** A thread row as listed within a board. */
export interface ForumThreadRow {
  id: string;
  title: string;
  authorId: string;
  authorName: string;
  locked: boolean;
  pinned: boolean;
  views: number;
  postCount: number;
  createdAt: number;
  lastPostAt: number;
  lastPosterName: string | null;
}

/** A single thread's header (board context joined). */
export interface ForumThread {
  id: string;
  boardId: string;
  boardSlug: string;
  boardName: string;
  title: string;
  authorId: string;
  authorName: string;
  locked: boolean;
  pinned: boolean;
  views: number;
  postCount: number;
  createdAt: number;
}

/** A single post within a thread. */
export interface ForumPost {
  id: string;
  authorId: string;
  authorName: string;
  authorJoined: number | null;
  body: string;
  createdAt: number;
  editedAt: number | null;
  /** Soft-delete tombstone: the client renders "[removed]" (social v1). */
  deleted: boolean;
}

function narrowLastPost(v: unknown): ForumLastPost | null {
  if (!isObj(v)) return null;
  const threadId = str(v['threadId']);
  if (threadId === undefined) return null;
  return {
    threadId,
    threadTitle: str(v['threadTitle']) ?? '',
    at: num(v['at']),
    username: str(v['username']) ?? '',
  };
}

function narrowIndexBoard(v: unknown): ForumIndexBoard | null {
  if (!isObj(v)) return null;
  const slug = str(v['slug']);
  const name = str(v['name']);
  if (slug === undefined || name === undefined) return null;
  return {
    slug,
    name,
    description: str(v['description']) ?? '',
    sort: num(v['sort']),
    threadCount: num(v['threadCount']),
    postCount: num(v['postCount']),
    lastPost: narrowLastPost(v['lastPost']),
  };
}

function narrowThreadRow(v: unknown): ForumThreadRow | null {
  if (!isObj(v)) return null;
  const id = str(v['id']);
  if (id === undefined) return null;
  return {
    id,
    title: str(v['title']) ?? '',
    authorId: str(v['authorId']) ?? '',
    authorName: str(v['authorName']) ?? '',
    locked: bool(v['locked']),
    pinned: bool(v['pinned']),
    views: num(v['views']),
    postCount: num(v['postCount']),
    createdAt: num(v['createdAt']),
    lastPostAt: num(v['lastPostAt']),
    lastPosterName: str(v['lastPosterName']) ?? null,
  };
}

function narrowForumThread(v: unknown): ForumThread | null {
  if (!isObj(v)) return null;
  const id = str(v['id']);
  if (id === undefined) return null;
  return {
    id,
    boardId: str(v['boardId']) ?? '',
    boardSlug: str(v['boardSlug']) ?? '',
    boardName: str(v['boardName']) ?? '',
    title: str(v['title']) ?? '',
    authorId: str(v['authorId']) ?? '',
    authorName: str(v['authorName']) ?? '',
    locked: bool(v['locked']),
    pinned: bool(v['pinned']),
    views: num(v['views']),
    postCount: num(v['postCount']),
    createdAt: num(v['createdAt']),
  };
}

function narrowPost(v: unknown): ForumPost | null {
  if (!isObj(v)) return null;
  const id = str(v['id']);
  if (id === undefined) return null;
  return {
    id,
    authorId: str(v['authorId']) ?? '',
    authorName: str(v['authorName']) ?? '',
    authorJoined: numOrNull(v['authorJoined']),
    body: str(v['body']) ?? '',
    createdAt: num(v['createdAt']),
    editedAt: numOrNull(v['editedAt']),
    deleted: bool(v['deleted']),
  };
}

/** `GET /api/forum` — the public forum index. [] on failure. */
export async function fetchForumIndex(): Promise<ForumIndexCategory[]> {
  try {
    const d = await getJson('/api/forum');
    const list = isObj(d) ? d['index'] : undefined;
    if (!Array.isArray(list)) return [];
    const out: ForumIndexCategory[] = [];
    for (const c of list) {
      if (!isObj(c) || !isObj(c['category'])) continue;
      const cat = c['category'];
      const slug = str(cat['slug']);
      const name = str(cat['name']);
      if (slug === undefined || name === undefined) continue;
      const boards = Array.isArray(c['boards'])
        ? c['boards'].map(narrowIndexBoard).filter((b): b is ForumIndexBoard => b !== null)
        : [];
      out.push({ category: { slug, name, sort: num(cat['sort']) }, boards });
    }
    return out;
  } catch {
    return [];
  }
}

export interface BoardPage {
  board: ForumBoard;
  threads: ForumThreadRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** `GET /api/forum/boards/:slug?page=` — a board + its threads. Null on failure. */
export async function fetchBoard(slug: string, page = 1): Promise<BoardPage | null> {
  try {
    const d = await getJson(
      `/api/forum/boards/${encodeURIComponent(slug)}?page=${encodeURIComponent(String(page))}`,
    );
    if (!isObj(d) || !isObj(d['board'])) return null;
    const b = d['board'];
    const bSlug = str(b['slug']);
    if (bSlug === undefined) return null;
    const threads = Array.isArray(d['threads'])
      ? d['threads'].map(narrowThreadRow).filter((t): t is ForumThreadRow => t !== null)
      : [];
    return {
      board: { slug: bSlug, name: str(b['name']) ?? '', description: str(b['description']) ?? '' },
      threads,
      total: num(d['total']),
      page: num(d['page']) || 1,
      pageSize: num(d['pageSize']) || 30,
    };
  } catch {
    return null;
  }
}

export interface ThreadPage {
  thread: ForumThread;
  posts: ForumPost[];
  total: number;
  page: number;
  pageSize: number;
}

/** `GET /api/forum/threads/:id?page=` — a thread + its posts. Null on failure. */
export async function fetchThread(id: string, page = 1): Promise<ThreadPage | null> {
  try {
    const d = await getJson(
      `/api/forum/threads/${encodeURIComponent(id)}?page=${encodeURIComponent(String(page))}`,
    );
    if (!isObj(d)) return null;
    const thread = narrowForumThread(d['thread']);
    if (!thread) return null;
    const posts = Array.isArray(d['posts'])
      ? d['posts'].map(narrowPost).filter((p): p is ForumPost => p !== null)
      : [];
    return {
      thread,
      posts,
      total: num(d['total']),
      page: num(d['page']) || 1,
      pageSize: num(d['pageSize']) || 20,
    };
  } catch {
    return null;
  }
}

/** The result of creating a thread. */
export type CreateThreadResult =
  | { ok: true; threadId: string; postId: string }
  | { ok: false; status: number };

/** `POST /api/forum/boards/:slug/threads` { title, body }. */
export async function createThread(
  slug: string,
  title: string,
  body: string,
): Promise<CreateThreadResult> {
  try {
    const res = await fetch(`/api/forum/boards/${encodeURIComponent(slug)}/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ title, body }),
    });
    if (res.ok) {
      const d: unknown = await res.json().catch(() => ({}));
      const threadId = isObj(d) ? str(d['threadId']) : undefined;
      return { ok: true, threadId: threadId ?? '', postId: (isObj(d) && str(d['postId'])) || '' };
    }
    return { ok: false, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** The result of creating a post / reply. */
export type CreatePostResult = { ok: true; postId: string } | { ok: false; status: number };

/** `POST /api/forum/threads/:id/posts` { body }. */
export async function createPost(threadId: string, body: string): Promise<CreatePostResult> {
  try {
    const res = await fetch(`/api/forum/threads/${encodeURIComponent(threadId)}/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ body }),
    });
    if (res.ok) {
      const d: unknown = await res.json().catch(() => ({}));
      return { ok: true, postId: (isObj(d) && str(d['postId'])) || '' };
    }
    return { ok: false, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** `POST /api/forum/posts/:id/edit` { body }. true on success. */
export async function editPost(postId: string, body: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/forum/posts/${encodeURIComponent(postId)}/edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ body }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** `DELETE /api/forum/posts/:id` — soft-delete a post (author-or-admin). true on success. */
export async function deleteForumPost(postId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/forum/posts/${encodeURIComponent(postId)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** `POST /api/forum/threads/:id/moderate` { locked?, pinned? } (admin-only). true on success. */
export async function moderateThread(
  threadId: string,
  flags: { locked?: boolean; pinned?: boolean },
): Promise<boolean> {
  try {
    const res = await fetch(`/api/forum/threads/${encodeURIComponent(threadId)}/moderate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(flags),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** One forum search hit (a title or post-body match) — QoL forum search. */
export interface ForumSearchHit {
  threadId: string;
  threadTitle: string;
  boardSlug: string;
  boardName: string;
  snippet: string;
  matchedIn: 'title' | 'post';
  createdAt: number;
}

function narrowSearchHit(v: unknown): ForumSearchHit | null {
  if (!isObj(v)) return null;
  const threadId = str(v['threadId']);
  if (threadId === undefined) return null;
  const matchedIn = v['matchedIn'] === 'title' ? 'title' : 'post';
  return {
    threadId,
    threadTitle: str(v['threadTitle']) ?? '',
    boardSlug: str(v['boardSlug']) ?? '',
    boardName: str(v['boardName']) ?? '',
    snippet: str(v['snippet']) ?? '',
    matchedIn,
    createdAt: num(v['createdAt']),
  };
}

/** `GET /api/forum/search?q=&limit=` — title + body search (min 2 chars). [] on failure/short. */
export async function searchForum(q: string, limit = 20): Promise<ForumSearchHit[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) return [];
  try {
    const d = await getJson(
      `/api/forum/search?q=${encodeURIComponent(trimmed)}&limit=${encodeURIComponent(String(limit))}`,
    );
    const list = isObj(d) ? d['results'] : undefined;
    if (!Array.isArray(list)) return [];
    return list.map(narrowSearchHit).filter((h): h is ForumSearchHit => h !== null);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Retention front-end: social proof (online count + recent games) + shareable
// public match summary (no auth; FINISHED matches only — the server guarantees
// it never exposes an in-progress game's roles/seats).
// ---------------------------------------------------------------------------

/** `GET /api/stats/online` — live socket count. 0 on any failure. */
export async function fetchOnline(): Promise<number> {
  try {
    const d = await getJson('/api/stats/online');
    return isObj(d) ? num(d['online']) : 0;
  } catch {
    return 0;
  }
}

/** One row of the public "recent games" strip. */
export interface RecentGame {
  id: string;
  setupId: string;
  outcome: string | null;
  endedAt: number;
  mode: string | null;
  players: number;
}

function narrowRecentGame(v: unknown): RecentGame | null {
  if (!isObj(v)) return null;
  const id = str(v['id']);
  if (id === undefined) return null;
  return {
    id,
    setupId: str(v['setupId']) ?? '',
    outcome: str(v['outcome']) ?? null,
    endedAt: num(v['endedAt']),
    mode: str(v['mode']) ?? null,
    players: num(v['players']),
  };
}

/** `GET /api/games/recent?limit=` — recent finished games. [] on failure/empty. */
export async function fetchRecentGames(limit = 8): Promise<RecentGame[]> {
  try {
    const d = await getJson(`/api/games/recent?limit=${encodeURIComponent(String(limit))}`);
    const list = isObj(d) ? d['games'] : undefined;
    if (!Array.isArray(list)) return [];
    return list.map(narrowRecentGame).filter((g): g is RecentGame => g !== null);
  } catch {
    return [];
  }
}

/** A seat in the public (no-auth) match summary. */
export interface PublicReplaySeat {
  seat: number;
  role: string;
  faction: string;
  outcome: string;
  survived: boolean;
  deathDay: number | null;
  name: string | null;
}

/** The public, no-auth, FINISHED-only match summary (the shareable replay card). */
export interface PublicReplay {
  id: string;
  setupId: string;
  outcome: string | null;
  startedAt: number;
  endedAt: number;
  mode: string | null;
  seats: PublicReplaySeat[];
}

function narrowPublicSeat(v: unknown): PublicReplaySeat | null {
  if (!isObj(v)) return null;
  return {
    seat: num(v['seat']),
    role: str(v['role']) ?? 'CITIZEN',
    faction: str(v['faction']) ?? 'TOWN',
    outcome: str(v['outcome']) ?? 'draw',
    survived: bool(v['survived']),
    deathDay: numOrNull(v['deathDay']),
    name: str(v['name']) ?? null,
  };
}

/**
 * `GET /api/games/:matchId/summary` — the public, no-auth match summary. Returns
 * null on any failure (unknown id, an in-progress game, network error). Only
 * finished matches are ever returned by the server.
 */
export async function fetchPublicReplay(matchId: string): Promise<PublicReplay | null> {
  try {
    const d = await getJson(`/api/games/${encodeURIComponent(matchId)}/summary`);
    if (!isObj(d)) return null;
    const id = str(d['id']);
    if (id === undefined) return null;
    const seats = Array.isArray(d['seats'])
      ? d['seats'].map(narrowPublicSeat).filter((s): s is PublicReplaySeat => s !== null)
      : [];
    return {
      id,
      setupId: str(d['setupId']) ?? '',
      outcome: str(d['outcome']) ?? null,
      startedAt: num(d['startedAt']),
      endedAt: num(d['endedAt']),
      mode: str(d['mode']) ?? null,
      seats,
    };
  } catch {
    return null;
  }
}

/** Fetch the public lobby list; returns [] on any failure (resilient browser). */
export async function fetchLobbies(): Promise<LobbyListItem[]> {
  try {
    const res = await fetch('/api/lobbies', { credentials: 'include' });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    const list = isObj(data) ? data['lobbies'] : undefined;
    if (!Array.isArray(list)) return [];
    return list
      .filter(isObj)
      .map((l) => ({
        id: str(l['id']) ?? '',
        name: str(l['name']) ?? '',
        players: num(l['players']),
        capacity: num(l['capacity']),
        setupId: str(l['setupId']) ?? '',
        status: str(l['status']) ?? '',
        ...(l['testMode'] === true ? { testMode: true } : {}),
      }))
      .filter((l) => l.id);
  } catch {
    return [];
  }
}
