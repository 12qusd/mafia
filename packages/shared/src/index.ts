/**
 * @nocturne/shared — protocol schemas, types, role/setup data, constants and
 * strings. The single source of truth shared by engine, server, client and
 * bots (BUILD_SPEC §4.1). No game logic, no I/O.
 */

export * from './constants.js';
export * from './types/index.js';
export * from './roles/index.js';
export * from './setups/index.js';
export * from './protocol/index.js';
export * from './platform.js';
export * as strings from './strings.js';
