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

import { saveToken, saveGuestName } from './storage.js';

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
