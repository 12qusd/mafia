// @ts-check
//
// Engine-local ESLint flat config (BUILD_SPEC §4.3). Extends the repo root config
// and adds a hard determinism guard: the pure engine may never read wall-clock
// time or unseeded randomness. Run with:
//   pnpm --filter @nocturne/engine lint
//
// (The same invariant is also enforced by test/purity.test.ts, which is CI-gating
// even when only `pnpm --filter @nocturne/engine test` is run.)

import rootConfig from '../../eslint.config.js';

const FORBIDDEN_DETERMINISM = [
  {
    selector: "MemberExpression[object.name='Date'][property.name='now']",
    message: 'Engine must be deterministic: no Date.now (§4.3). Use the injected event timestamp.',
  },
  {
    selector: "MemberExpression[object.name='Math'][property.name='random']",
    message: 'Engine must be deterministic: no Math.random (§4.3). Use the seeded PRNG in state.',
  },
  {
    selector: "NewExpression[callee.name='Date']",
    message: 'Engine must be deterministic: no `new Date` (§4.3).',
  },
  {
    selector: "MemberExpression[object.name='performance'][property.name='now']",
    message: 'Engine must be deterministic: no performance.now (§4.3).',
  },
];

export default [
  ...rootConfig,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...FORBIDDEN_DETERMINISM],
    },
  },
];
