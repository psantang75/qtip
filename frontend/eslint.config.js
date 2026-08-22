import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

/**
 * Forbidden toast-title wordings.
 *
 * These match the pre-`docs/error-messages-catalog.md` voice we just removed
 * in commit 9217246. Anything matching these patterns should use a canonical
 * helper from `@/lib/t` (e.g. `t.eSave('form')`, `t.msg.auth.wrongCredentials()`)
 * or, for genuinely bespoke wording, follow the catalog's voice:
 *   - Title:   "Couldn't <verb> <noun>"  (sentence case, no trailing period)
 *   - Description: actionable, ends with a period.
 *
 * If you hit one of these errors and the right wording really is "Failed to
 * load X", the rule is wrong — file a tiny PR adjusting the regex below.
 */
// Prefix match (no trailing `$`) so it catches "Failed to load forms",
// "Save failed: timeout", etc. — not just exact-string regressions.
const FORBIDDEN_TOAST_TITLE = /^(Failed to|Save failed|Update failed|Delete failed|Add failed|Run failed|Submit failed|Test failed|Resend failed|Archive failed|Restore failed|Reorder failed|Close failed|Rollback failed|Activate failed|Eval failed|Set default failed|Search failed|Signing failed|PDF generation failed|Download failed|Duplicate failed)\b/

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],

      // Catch regressions to pre-catalog error-message wording.
      // Selector matches: toast({ title: 'Failed to ...', ... })  and  toast({ title: 'Save failed', ... })
      'no-restricted-syntax': [
        'error',
        {
          selector: `CallExpression[callee.name='toast'] > ObjectExpression > Property[key.name='title'] > Literal[value=/${FORBIDDEN_TOAST_TITLE.source}/]`,
          message:
            "Use canonical wording from docs/error-messages-catalog.md. Prefer `t.eSave('<noun>')` / `t.eLoad('<noun>')` from @/lib/t, or write the title as \"Couldn't <verb> <noun>\".",
        },
        {
          selector: `CallExpression[callee.name='toast'] > ObjectExpression > Property[key.name='title'] > TemplateLiteral[quasis.0.value.raw=/${FORBIDDEN_TOAST_TITLE.source}/]`,
          message:
            "Use canonical wording from docs/error-messages-catalog.md. Prefer `t.eSave('<noun>')` / `t.eLoad('<noun>')` from @/lib/t, or write the title as \"Couldn't <verb> <noun>\".",
        },
      ],
    },
  },
  // The rule fires (correctly) inside the registry/shim files where these
  // strings are documented in JSDoc examples, so scope it out for those.
  {
    files: [
      'src/lib/errorMessages.ts',
      'src/lib/errorMessages.bespoke.ts',
      'src/lib/t.ts',
      'eslint.config.js',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // shadcn/ui primitives are vendored/auto-generated and intentionally
  // co-locate their `*Variants` (cva) exports and form hooks alongside the
  // component — that's the upstream shadcn pattern. Splitting them would mean
  // editing files we're told to leave untouched (.cursorrules), so the
  // fast-refresh-only warning is scoped off here rather than restructured.
  {
    files: ['src/components/ui/**'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
)
