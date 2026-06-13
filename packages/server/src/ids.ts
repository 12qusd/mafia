/**
 * ID, token, and noir-name generation (BUILD_SPEC §7.1, §7.2, §4.3).
 *
 * Tokens and seeds use Node's crypto for unpredictability (the match seed is
 * secret until game end, §4.3). Invite codes are 6-char (§7.2). Guest display
 * names are random noir-flavored handles (§7.1) — original wording (§2.1.2).
 */

import { randomBytes, createHash, randomInt } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { INVITE_CODE_LENGTH } from '@nocturne/shared';

/** A fresh UUID v4 (lobby/match/user ids). */
export function newId(): string {
  return uuidv4();
}

/** A 256-bit random session token (hex). Stored only as a hash server-side. */
export function newSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/** A cryptographically random match seed, secret until game end (§4.3). */
export function newSeed(): string {
  return randomBytes(24).toString('hex');
}

/** SHA-256 hash of a token (+secret) for at-rest storage of sessions (§7.1). */
export function hashToken(token: string, secret: string): string {
  return createHash('sha256').update(`${secret}:${token}`).digest('hex');
}

// Unambiguous alphabet (no 0/O/1/I) for human-typed invite codes.
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A 6-char private-lobby invite code (§7.2). */
export function newInviteCode(): string {
  let out = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    out += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  }
  return out;
}

// Original noir handle parts (§2.1.2 — written fresh, 1920s Prohibition voice).
const ADJECTIVES = [
  'Smoky',
  'Velvet',
  'Crooked',
  'Midnight',
  'Silent',
  'Lucky',
  'Shadow',
  'Brass',
  'Gilded',
  'Hollow',
  'Restless',
  'Quiet',
  'Foggy',
  'Amber',
  'Ashen',
];
const NOUNS = [
  'Sparrow',
  'Lantern',
  'Domino',
  'Clover',
  'Marlowe',
  'Raven',
  'Ledger',
  'Whistle',
  'Cinder',
  'Magpie',
  'Tumbler',
  'Coyote',
  'Switch',
  'Verdict',
  'Echo',
];

/** A random noir guest display name, e.g. "Smoky Sparrow 42" (§7.1). */
export function newGuestName(): string {
  const a = ADJECTIVES[randomInt(ADJECTIVES.length)];
  const n = NOUNS[randomInt(NOUNS.length)];
  const num = randomInt(10, 99);
  return `${a} ${n} ${num}`;
}
