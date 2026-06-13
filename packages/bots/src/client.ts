/**
 * Headless protocol bot client (BUILD_SPEC §12.2).
 *
 * A {@link BotClient} is a REAL WebSocket client: it connects to the real server
 * over a loopback socket, sends `hello`, and thereafter speaks the shared zod
 * protocol exactly like a human. It maintains ONLY the view a real client would
 * have — it has no engine access and infers nothing it was not told. Every inbound
 * frame is recorded (for the §12.3 leak auditor) and folded into a small view
 * model the policy layer reads.
 *
 * Information-security note: this class is deliberately "dumb". It keeps own role,
 * mates (mafia only, from `your_role`), the public seat/alive set, current phase,
 * vote tallies, the active trial, and per-channel chat it actually received. It
 * NEVER receives or stores another seat's secret, because the server never sends
 * one — which is exactly what the leak auditor proves over the captured frames.
 */

import WebSocket from 'ws';
import {
  PROTOCOL_VERSION,
  parseServerMessage,
  serializeClientMessage,
  type ServerMessage,
  type ClientMessage,
  type SeatId,
} from './protocol.js';

export interface CapturedFrame {
  /** Monotonic order across all bots in a game (assigned by the sim). */
  seq: number;
  /** Wall-clock receive time. */
  ts: number;
  msg: ServerMessage;
}

export interface BotView {
  /** Our seat id once the game starts (null in lobby / as spectator). */
  seat: SeatId | null;
  role: string | null;
  faction: string | null;
  /** Mafia roster (mafia only). */
  mates: SeatId[];
  /** Ability descriptors from your_role. */
  abilities: { id: string; timing: 'day' | 'night' | 'passive'; usesRemaining: number | null }[];
  phase: string | null;
  dayNumber: number;
  endsAt: number | null;
  /** Seat ids known to exist (from game_started / public seats). */
  seats: SeatId[];
  /** Living seat ids (death_announce / game_over flips these). */
  alive: Set<SeatId>;
  /** Whether WE are alive. */
  selfAlive: boolean;
  /** Whether the mayor power has been used by us. */
  mayorRevealed: boolean;
  /** Current open-vote tallies (seat → weight). */
  tallies: Map<SeatId, number>;
  /** Active trial accused, or null. */
  trialAccused: SeatId | null;
  /** Whether the game has ended. */
  over: boolean;
  /** Game-over winners (once over). */
  winners: string[];
  /** Recent entitled chat lines (rolling, last ~30) for the LLM policy. */
  recentChat: { channel: string; from: SeatId | 'Jailor'; text: string }[];
  /** Own private results received (kind-tagged), for the LLM policy. */
  privateResults: { kind: string; target?: SeatId; result?: string; resultClass?: string; visitors?: SeatId[] }[];
}

export interface BotClientOptions {
  url: string;
  /** Display name for logs. */
  name: string;
  /** Resume token, if reconnecting (§8). */
  token?: string;
  /** Called for every inbound (parsed) frame, in receive order. */
  onFrame?: (msg: ServerMessage) => void;
  /** Called when the socket opens and hello is acknowledged (welcome). */
  onWelcome?: (welcome: Extract<ServerMessage, { type: 'welcome' }>) => void;
}

export class BotClient {
  readonly name: string;
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly token: string | undefined;
  /** Every frame this client received, in order (leak-detector capture, §12.3). */
  readonly capture: ServerMessage[] = [];
  readonly view: BotView = freshView();
  /** Resolved identity id (guest or user) from welcome. */
  identityId: string | null = null;
  /** Whether welcome has been processed. */
  helloAcked = false;
  /** Current lobby id (from lobby_state), if any. */
  lobbyId: string | null = null;
  isHost = false;
  /** Lobby member ids (pre-game). */
  lobbyMembers: { id: string; isHost: boolean; isSpectator: boolean }[] = [];
  /** Optional policy hook, called for every inbound frame (set post-connect). */
  policyDrive: ((msg: ServerMessage) => void) | null = null;
  private readonly onFrame: ((msg: ServerMessage) => void) | undefined;
  private readonly onWelcome:
    | ((w: Extract<ServerMessage, { type: 'welcome' }>) => void)
    | undefined;
  private readonly waiters: { type: string; resolve: (m: ServerMessage) => void }[] = [];
  private closed = false;

  constructor(opts: BotClientOptions) {
    this.url = opts.url;
    this.name = opts.name;
    this.token = opts.token;
    this.onFrame = opts.onFrame;
    this.onWelcome = opts.onWelcome;
  }

  /** Open the socket and send hello; resolves once welcome is received. */
  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.on('open', () => {
        this.rawSend({
          v: PROTOCOL_VERSION,
          type: 'hello',
          protocolVersion: PROTOCOL_VERSION,
          ...(this.token ? { token: this.token } : {}),
        });
      });
      ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        if (isBinary) return; // bots never expect binary
        this.onMessage(String(data));
        if (!this.helloAcked && this.view) {
          // resolve once welcome processed (handled in onMessage via flag)
        }
      });
      ws.on('error', (err) => {
        if (!this.helloAcked) reject(err);
      });
      ws.on('close', () => {
        this.closed = true;
      });
      // Resolve when welcome lands.
      this.once('welcome').then(() => resolve()).catch(reject);
    });
  }

  private onMessage(raw: string): void {
    const msg = parseServerMessage(raw);
    if (!msg) return; // ignore unparseable/unknown frames gracefully (§12.2)
    this.capture.push(msg);
    this.applyToView(msg);
    this.onFrame?.(msg);
    // Policy reacts AFTER the view is updated, so it reasons on current state.
    try {
      this.policyDrive?.(msg);
    } catch {
      // a policy bug must never desync the client read loop (§12.2)
    }
    if (msg.type === 'welcome') {
      this.helloAcked = true;
      this.identityId = msg.userId ?? msg.guestId ?? null;
      this.onWelcome?.(msg);
    }
    // Wake any waiters keyed on this type.
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i]!;
      if (w.type === msg.type) {
        this.waiters.splice(i, 1);
        w.resolve(msg);
      }
    }
  }

  /** Fold a frame into the small view model a real client would build. */
  private applyToView(msg: ServerMessage): void {
    const v = this.view;
    switch (msg.type) {
      case 'welcome': {
        if (msg.resume) {
          const r = msg.resume;
          v.seat = r.seat;
          v.role = r.ownRole;
          v.faction = r.ownFaction;
          if (r.mates) v.mates = [...r.mates];
          v.abilities = r.abilities.map((a) => ({
            id: a.id,
            timing: a.timing,
            usesRemaining: a.usesRemaining,
          }));
          v.phase = r.phase;
          v.dayNumber = r.dayNumber;
          v.endsAt = r.endsAt;
          v.seats = r.seats.map((s) => s.seat);
          v.alive = new Set(r.seats.filter((s) => s.alive).map((s) => s.seat));
          v.selfAlive = v.alive.has(r.seat);
        }
        break;
      }
      case 'lobby_state': {
        this.lobbyId = msg.lobby.id;
        // The public lobby DTO intentionally omits the invite code (§5); join is
        // by lobbyId for bots. dev:solo prints the lobbyId for the human.
        this.isHost = msg.lobby.hostUserOrGuestId === this.identityId;
        this.lobbyMembers = msg.lobby.members.map((m) => ({
          id: m.userOrGuestId,
          isHost: m.isHost,
          isSpectator: m.isSpectator,
        }));
        break;
      }
      case 'game_started': {
        v.seats = msg.seats.map((s) => s.seat);
        v.alive = new Set(msg.seats.filter((s) => s.alive).map((s) => s.seat));
        v.selfAlive = true;
        break;
      }
      case 'your_role': {
        v.role = msg.role;
        v.faction = msg.faction;
        v.mates = msg.mates ? [...msg.mates] : [];
        v.abilities = msg.abilities.map((a) => ({
          id: a.id,
          timing: a.timing,
          usesRemaining: a.usesRemaining,
        }));
        break;
      }
      case 'phase_change': {
        v.phase = msg.phase;
        v.dayNumber = msg.dayNumber;
        v.endsAt = msg.endsAt;
        // New phase clears the trial unless a trial phase is starting.
        if (msg.phase !== 'TRIAL_DEFENSE' && msg.phase !== 'TRIAL_JUDGMENT') {
          v.trialAccused = null;
        }
        if (msg.phase === 'DAY_VOTING') v.tallies = new Map();
        break;
      }
      case 'vote_update': {
        v.tallies = new Map(msg.tallies.map((t) => [t.seat, t.weight]));
        break;
      }
      case 'chat_message': {
        v.recentChat.push({ channel: msg.channel, from: msg.from, text: msg.text });
        if (v.recentChat.length > 30) v.recentChat.shift();
        break;
      }
      case 'private_result': {
        const pr = msg as unknown as {
          kind: string;
          target?: SeatId;
          result?: string;
          resultClass?: string;
          visitors?: SeatId[];
        };
        v.privateResults.push({
          kind: pr.kind,
          ...(pr.target !== undefined ? { target: pr.target } : {}),
          ...(pr.result !== undefined ? { result: pr.result } : {}),
          ...(pr.resultClass !== undefined ? { resultClass: pr.resultClass } : {}),
          ...(pr.visitors !== undefined ? { visitors: pr.visitors } : {}),
        });
        if (v.privateResults.length > 40) v.privateResults.shift();
        break;
      }
      case 'trial_start': {
        v.trialAccused = msg.accusedSeat;
        break;
      }
      case 'death_announce': {
        v.alive.delete(msg.seat);
        if (v.seat !== null && msg.seat === v.seat) v.selfAlive = false;
        break;
      }
      case 'day_ability_ack': {
        if (msg.ability === 'reveal') v.mayorRevealed = true;
        break;
      }
      case 'game_over': {
        v.over = true;
        v.winners = [...msg.winners];
        v.alive = new Set(
          msg.allRoles.filter((r) => r.outcome !== 'loss' || false).map((r) => r.seat),
        );
        break;
      }
      default:
        break;
    }
    // The server tells us our role (your_role) but not our seat NUMBER — that is
    // not in any frame addressed to us by design. The sim assigns seats by join
    // order and injects ours via setSeat(); thereafter selfAlive tracks it.
  }

  /** The sim injects the bot's own seat once known (from start ordering). */
  setSeat(seat: SeatId): void {
    this.view.seat = seat;
    this.view.selfAlive = this.view.alive.size === 0 ? true : this.view.alive.has(seat);
  }

  /** Send a (validated) client message. */
  send(msg: ClientMessage): void {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(serializeClientMessage(msg));
    } catch {
      // a closed socket mid-send is fine; the game never pauses (§8)
    }
  }

  /** Send a raw object WITHOUT shared validation (fuzz/abuse tests only). */
  rawSendUnchecked(data: string | Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(data);
    } catch {
      /* ignore */
    }
  }

  private rawSend(obj: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }

  /** Resolve when the next frame of `type` arrives. */
  once(type: string): Promise<ServerMessage> {
    // If we already have one captured and it's a one-shot like welcome, still
    // wait for the next — callers use this for liveness, not history.
    return new Promise((resolve) => {
      this.waiters.push({ type, resolve });
    });
  }

  /** Wait until the game is over, or timeout (ms). Resolves true if over. */
  async waitForGameOver(timeoutMs: number): Promise<boolean> {
    if (this.view.over) return true;
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(this.view.over), timeoutMs);
      if (t.unref) t.unref();
      const check = () => {
        if (this.view.over) {
          clearTimeout(t);
          resolve(true);
        }
      };
      this.waiters.push({ type: 'game_over', resolve: () => check() });
    });
  }

  close(): void {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

function freshView(): BotView {
  return {
    seat: null,
    role: null,
    faction: null,
    mates: [],
    abilities: [],
    phase: null,
    dayNumber: 0,
    endsAt: null,
    seats: [],
    alive: new Set(),
    selfAlive: true,
    mayorRevealed: false,
    tallies: new Map(),
    trialAccused: null,
    over: false,
    winners: [],
    recentChat: [],
    privateResults: [],
  };
}
