// @ts-check
// Server-local ESLint config (BUILD_SPEC §5 information-security guard).
//
// Forbids direct `socket.send(...)` member calls outside the transport module.
// All outbound delivery MUST go through `src/transport.ts` (sendTo /
// broadcastPublic / dispatchEffect / sendToSocket). This is the lint half of
// the §5 invariant; the code-review convention is documented in
// DECISIONS-server.md.
//
// Run from this package: `pnpm --filter @nocturne/server exec eslint src`.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '**/*.test.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='send'][callee.object.name='socket']",
          message:
            'Direct socket.send is forbidden (BUILD_SPEC §5). Deliver via ScopedTransport ' +
            '(sendTo / broadcastPublic / dispatchEffect) or sendToSocket in transport.ts.',
        },
      ],
    },
  },
  // The transport module is the single sanctioned exception.
  {
    files: ['src/transport.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  prettier,
);
