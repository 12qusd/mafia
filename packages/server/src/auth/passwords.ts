/**
 * Password hashing via argon2id (BUILD_SPEC §7.1, §10).
 *
 * Wrapped so tests can stub it and so the rest of the server never imports
 * argon2 directly. Uses argon2id (the default `argon2.argon2id` type).
 */

import argon2 from 'argon2';

const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // ~19 MB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
