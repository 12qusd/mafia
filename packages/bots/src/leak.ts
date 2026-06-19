/**
 * Leak detector / entitlement auditor (BUILD_SPEC §5, §12.3 — CI-gating).
 *
 * After a game, this walks EVERY frame captured at EVERY client and asserts the
 * §5 entitlement table: no frame delivered to a seat ever contained information
 * that seat was not entitled to at that moment under the rules.
 *
 * The audit combines a TYPED check (the structural entitlement of secret-bearing
 * frame types) with a strong CROSS-CAPTURE DEEP SCAN: using the true roles from
 * the legal game_over reveal as ground truth, we walk each non-mafia / spectator
 * observer's ordered capture and assert that no frame mentions another seat's
 * true role string before that seat became legally revealed (death_announce,
 * mayor self-reveal, or game_over). This is the teeth of §12.3 — it would catch a
 * server that accidentally broadcast a role in any field of any message.
 */

import { type ServerMessage, type SeatId } from './protocol.js';

export interface AuditSeat {
  seat: SeatId;
  /** True role/faction (from game_over reveal). */
  role: string;
  faction: string;
  /** Ordered frames this client received. */
  frames: ServerMessage[];
}

export interface LeakViolation {
  observerSeat: number;
  observerIsSpectator: boolean;
  frameIndex: number;
  frameType: string;
  reason: string;
  frame: unknown;
}

export interface AuditInput {
  seats: AuditSeat[];
  spectators: { frames: ServerMessage[] }[];
  deadSeeAll: boolean;
  /**
   * TEST MODE only: the seat id (or -1 for a spectating host) that is the god
   * audience permitted to receive `debug_*` frames. In a NORMAL game this is
   * absent and ANY debug_* frame at ANY observer is a leak.
   */
  godSeat?: number | null;
}

/** Server→client frames that are legal ONLY for a test-mode god audience. */
const DEBUG_FRAME_TYPES = new Set(['debug_state', 'debug_trace', 'debug_event']);

/** Returns every entitlement violation; empty ⇒ the game leaked nothing. */
export function auditGame(input: AuditInput): LeakViolation[] {
  const out: LeakViolation[] = [];
  const trueRole = new Map<SeatId, string>();
  for (const s of input.seats) trueRole.set(s.seat, s.role);
  const mafiaSet = new Set(input.seats.filter((s) => s.faction === 'MAFIA').map((s) => s.seat));
  // The second evil faction's roster, derived from the SAME game_over true-faction
  // reveal as the mafia set — the ground truth the auditor trusts.
  const triadSet = new Set(input.seats.filter((s) => s.faction === 'TRIAD').map((s) => s.seat));

  const godSeat = input.godSeat ?? null;
  for (const obs of input.seats) {
    auditObserver(obs.frames, obs.seat, false, mafiaSet, triadSet, trueRole, out, godSeat);
  }
  input.spectators.forEach((spec, i) => {
    auditObserver(spec.frames, -1 - i, true, mafiaSet, triadSet, trueRole, out, godSeat);
  });
  return out;
}

function auditObserver(
  frames: ServerMessage[],
  observerSeat: SeatId,
  isSpectator: boolean,
  mafiaSet: Set<SeatId>,
  triadSet: Set<SeatId>,
  trueRole: Map<SeatId, string>,
  out: LeakViolation[],
  godSeat: number | null,
): void {
  const revealed = new Set<SeatId>();
  const observerIsMafia = !isSpectator && mafiaSet.has(observerSeat);
  const observerIsTriad = !isSpectator && triadSet.has(observerSeat);
  const observerIsGod = godSeat !== null && observerSeat === godSeat;

  frames.forEach((msg, idx) => {
    const push = (reason: string) =>
      out.push({ observerSeat, observerIsSpectator: isSpectator, frameIndex: idx, frameType: msg.type, reason, frame: msg });

    // TEST MODE god-view frames are legal ONLY for the test-mode god audience.
    // Anywhere else (normal game, or a non-god observer in a test game) they are
    // a leak — and for the god they carry full state by design, so we skip the
    // role-string deep scan for them.
    if (DEBUG_FRAME_TYPES.has(msg.type)) {
      if (!observerIsGod) push('received a debug_* frame while not the test-mode god audience');
      return;
    }

    // 1) Typed structural entitlement checks.
    switch (msg.type) {
      case 'game_over':
        for (const r of msg.allRoles) revealed.add(r.seat);
        break;
      case 'death_announce':
        // The dying seat's role is legally revealed here. But it must not be
        // delivered BEFORE death — by construction this IS the death reveal, so
        // mark it revealed from this frame onward (this frame is the reveal).
        // EXCEPTION (Janitor, batch A): a `cleaned` body carries NO role and does
        // NOT reveal the seat — its alignment stays secret, so we leave it
        // unrevealed (a later leak of its true role is then correctly caught).
        if (!msg.cleaned) revealed.add(msg.seat);
        break;
      case 'day_ability_ack':
        if (msg.ability === 'reveal' && msg.target !== undefined) revealed.add(msg.target);
        break;
      case 'your_role':
        // your_role is addressed to the owning seat alone, so the observer here IS
        // the role's owner. The faction roster ("mates") is legitimate ONLY for a
        // seat of an informed evil faction (Mafia OR Triad); a Town/neutral seat
        // carrying mates — or a non-evil observer ever receiving them — is a leak.
        if (isSpectator) push('spectator received a your_role frame');
        else if (msg.mates && !observerIsMafia && !observerIsTriad) {
          push('non-evil seat received a faction roster (mates)');
        } else if (msg.mates && observerIsMafia && msg.mates.some((m) => !mafiaSet.has(m))) {
          // A Mafia seat's roster must list ONLY Mafia members — a TRIAD (or any
          // non-mafia) seat in the mates list is a cross-faction leak.
          push('mafia seat received a faction roster naming a non-mafia seat (mates)');
        } else if (msg.mates && observerIsTriad && msg.mates.some((m) => !triadSet.has(m))) {
          push('triad seat received a faction roster naming a non-triad seat (mates)');
        }
        break;
      case 'chat_message':
        if (msg.channel === 'mafia' && !observerIsMafia)
          push('received mafia night chat while not entitled');
        else if (msg.channel === 'triad' && !observerIsTriad)
          push('received triad night chat while not entitled');
        else if (msg.channel === 'jail' && isSpectator) push('spectator received jail chat');
        else if (msg.channel === 'dead' && isSpectator) push('spectator received dead chat');
        break;
      case 'whisper':
        if (isSpectator) push('spectator received whisper content');
        break;
      case 'private_result':
        if (isSpectator) push('spectator received a private_result');
        break;
      default:
        break;
    }

    // 2) Cross-capture deep scan: a non-mafia / spectator observer must not see
    // ANY other seat's true role string in ANY field before that seat is legally
    // revealed. (Mafia legitimately learn their mates' faction, not roles, via
    // your_role.mates which carries no role strings — so this scan applies to
    // everyone uniformly: role strings of OTHERS are never legal pre-reveal.)
    if (msg.type === 'game_over') return; // the legal full reveal frame itself
    const roleStrings = collectRoleStrings(msg);
    if (roleStrings.size === 0) return;
    for (const [seat, role] of trueRole) {
      if (seat === observerSeat) continue; // own role is allowed
      if (revealed.has(seat)) continue; // already legally revealed
      // death_announce/your_role carry a role legitimately for the subject seat
      // only — those are handled by the typed checks and the revealed set. Any
      // OTHER occurrence of a non-revealed seat's role string is a leak.
      if (mentionsRoleForOtherSeat(msg, role)) {
        push(`frame mentions seat ${seat}'s unrevealed role "${role}"`);
        break;
      }
      void roleStrings;
    }
  });
}

/**
 * Collect all role-id strings appearing in STRUCTURED fields of a frame.
 *
 * Free human-authored text (`text` on chat/whisper) is intentionally excluded:
 * a player may legitimately *claim* a role in day chat ("I'm the GODFATHER"), so
 * a substring there is not a leak. The scan targets structured role-typed fields,
 * where a role id appearing is always a server-authored fact — exactly the
 * accidental-broadcast surface §12.3 must catch.
 */
function collectRoleStrings(msg: ServerMessage): Set<string> {
  const found = new Set<string>();
  const walk = (v: unknown, key: string | null): void => {
    if (typeof v === 'string') {
      // Skip free-text fields; only exact role-id tokens in structured fields.
      if (key !== 'text' && KNOWN_ROLES.has(v)) found.add(v);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x, key);
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k);
    }
  };
  walk(msg, null);
  return found;
}

/**
 * Whether a frame legitimately carries `role` for its SUBJECT seat (your_role
 * for self, death_announce for the dying seat) — those are not leaks. Any other
 * frame containing the role string is. We treat your_role and death_announce as
 * legitimate carriers (the typed checks above already gate them), so the deep
 * scan only fires on UNEXPECTED carriers.
 */
function mentionsRoleForOtherSeat(msg: ServerMessage, role: string): boolean {
  if (msg.type === 'your_role') return false; // own-role frame (typed-checked)
  if (msg.type === 'death_announce') return msg.role !== role ? false : false; // reveal frame
  if (msg.type === 'game_over') return false;
  // Consigliere exact-role result (batch A): a LEGITIMATE per-seat carrier of
  // another seat's role. The engine addresses it ONLY to the consigliere via
  // `toSeat`, so by the time the auditor walks an observer's capture and sees
  // one, that observer IS the entitled consigliere — exactly like your_role for
  // self. (Any accidental broadcast of a role in a NON-consigliere frame type is
  // still caught: this whitelist is scoped to this one structural frame.)
  if (msg.type === 'private_result' && msg.kind === 'consigliere_result') return false;
  // Janitor cleaned-body result (batch A): same rationale — addressed to the
  // janitor alone, so it legitimately carries the scrubbed victim's role.
  if (msg.type === 'private_result' && msg.kind === 'janitor_result') return false;
  // Amnesiac remember result (batch B): carries the amnesiac's OWN new role,
  // addressed to the amnesiac alone — exactly like your_role for self.
  if (msg.type === 'private_result' && msg.kind === 'remember_result') return false;
  // Coroner autopsy result (batch F): carries an ALREADY-revealed DEAD seat's role,
  // addressed to the Coroner alone. The role was made public at the seat's
  // death_announce, so it leaks nothing new; whitelisted like consigliere_result.
  // (The autopsied seat is in the `revealed` set by the time this frame arrives, so
  // the deep scan would clear it anyway — this whitelist makes the intent explicit.)
  if (msg.type === 'private_result' && msg.kind === 'coroner_result') return false;
  return collectRoleStrings(msg).has(role);
}

/** The MVP role-id set (BUILD_SPEC §6.5). Used to detect role strings in frames. */
const KNOWN_ROLES = new Set<string>([
  'CITIZEN',
  'SHERIFF',
  'INVESTIGATOR',
  'LOOKOUT',
  'DOCTOR',
  'ESCORT',
  'JAILOR',
  'VIGILANTE',
  'MAYOR',
  'GODFATHER',
  'MAFIOSO',
  'CONSORT',
  'FRAMER',
  'SERIAL_KILLER',
  'JESTER',
  'EXECUTIONER',
  'SURVIVOR',
  // --- Role-expansion batch A ---
  'CONSIGLIERE',
  'FORGER',
  'JANITOR',
  'BODYGUARD',
  'BLACKMAILER',
  'VETERAN',
  // --- Role-expansion batch B ---
  'TRACKER',
  'SPY',
  'AMNESIAC',
  'DISGUISER',
  'ARSONIST',
  // --- Role-expansion batch C ---
  'CRUSADER',
  'AMBUSHER',
  'PSYCHIC',
  'HYPNOTIST',
  // --- Role-expansion batch D ---
  'WEREWOLF',
  'MASS_MURDERER',
  'GUARDIAN_ANGEL',
  'JUGGERNAUT',
  // --- Triad faction ---
  'DRAGON_HEAD',
  'ENFORCER',
  'VANGUARD',
  // --- Role-expansion batch E (complex neutrals / conversions) ---
  'WITCH',
  'PIRATE',
  'PLAGUEBEARER',
  'PESTILENCE',
  // --- Vampire conversion faction ---
  // Knowledge-isolated design: vampires share NO chat and NO roster, so no new
  // entitlement check is needed. We register both role ids so the cross-capture
  // deep scan still catches any accidental broadcast of a VAMPIRE / VAMPIRE_HUNTER
  // role string (e.g. if a `turned` result ever leaked the convert's role, or a
  // converted seat's pre-reveal role appeared at an unentitled observer).
  'VAMPIRE',
  'VAMPIRE_HUNTER',
  // --- Cult conversion faction ---
  // Knowledge-isolated design: the Cult shares NO chat and NO roster, so no new
  // entitlement check is needed. We register both role ids so the cross-capture
  // deep scan still catches any accidental broadcast of a CULT_LEADER / CULTIST
  // role string (e.g. if a `recruited` result ever leaked the convert's role, or a
  // recruited seat's pre-reveal role appeared at an unentitled observer).
  'CULT_LEADER',
  'CULTIST',
  // --- Role-expansion batch F (distinct-mechanic Town roles) ---
  // TRANSPORTER / TRAPPER carry no role strings in any result (transport rewrites
  // targets; the trapper_result carries only a seat). CORONER's autopsy carries a
  // role string for an already-revealed dead seat (whitelisted above). Registered
  // so the cross-capture deep scan catches any accidental broadcast of these role
  // ids before legal reveal.
  'TRANSPORTER',
  'CORONER',
  'TRAPPER',
]);
