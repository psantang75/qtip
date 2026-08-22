import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Backend ESLint (flat config), mirroring frontend/eslint.config.js but scoped
 * to a Node/Express + Prisma codebase.
 *
 * Adoption strategy (industry-standard ratchet): this linter was introduced onto
 * an existing tree, so pre-existing style debt is set to `warn` (visible in
 * `npm run lint`, but the gate stays green) rather than churning ~25 unrelated
 * files in one pass. Genuine breakage still errors. Burn the warnings down as you
 * touch files, and promote a rule to `error` once its count hits zero — tracked
 * in docs/maintenance_cadence.md. The hard type gate is `tsc` (deploy/Dockerfile).
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'src/generated/**',
      'node_modules/**',
      'coverage/**',
      'scripts/**',
      'prisma/seed.ts',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // ── OFF: intentional or defensive patterns in this codebase ──────────────
      // Dynamic Excel/import + raw-SQL boundaries legitimately use `any`.
      '@typescript-eslint/no-explicit-any': 'off',
      // Prisma/adapter interop and a few dynamic requires rely on require().
      '@typescript-eslint/no-require-imports': 'off',
      // Deliberate control-char sanitization (htmlText, contentDisposition).
      'no-control-regex': 'off',
      // `ApiErrors` namespace in utils/errorHandler.ts is an established pattern.
      '@typescript-eslint/no-namespace': 'off',
      // The `Function` type in the global error handler is intentional.
      '@typescript-eslint/no-unsafe-function-type': 'off',
      // Fires on defensive escapes inside regex char classes (`\]`, `\/`) where
      // auto-removal would be unsafe — net noise on validation regexes.
      'no-useless-escape': 'off',

      // ── ERROR: burned down to zero, now enforced (regressions fail lint) ─────
      // `_`-prefixed args/vars are the opt-out for deliberately unused bindings.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      'prefer-const': 'error',
      '@typescript-eslint/no-empty-object-type': 'error',
      'no-case-declarations': 'error',
      'no-irregular-whitespace': 'error',
      // Burned down to zero (the 4 pure-rethrow wrappers in the repositories were
      // unwrapped), so it's promoted from warn to error — regressions now fail lint.
      'no-useless-catch': 'error',
    },
  },
);
