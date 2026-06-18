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
    narrowAuth(await postJson('/api/register', { username, password, ...(email ? { email } : {}) })),
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
    return {
      id,
      name,
      isGuest: bool(data['isGuest']),
      isAdmin: bool(data['isAdmin']),
      stats: narrowStats(data['stats']),
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
export type SaveSetupResult =
  | { ok: true; id: string }
  | { ok: false; errors: string[] };

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
  if (res.status === 403) return { ok: false, errors: ['Registered accounts only — guests cannot save setups.'] };
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

/** Logout helper (clears the server session; the cookie is httpOnly). */
export async function logout(): Promise<void> {
  try {
    await postJson('/api/logout', {});
  } catch {
    /* ignore — best effort */
  }
}

// Re-export for callers that only narrow points breakdowns from untrusted JSON.
export { PointsBreakdownSchema };

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
