import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/shared',
  'packages/engine',
  'packages/server',
  'packages/client',
  'packages/bots',
]);
