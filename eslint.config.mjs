import js from '@eslint/js'
import ts from 'typescript-eslint'
import globals from 'globals'
import importX from 'eslint-plugin-import-x'

export default ts.config(
  js.configs.recommended,
  ...ts.configs.strictTypeChecked,
  ...ts.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  // Node.js context — plugin source, build scripts, tests
  {
    files: ['plugin/**/*.ts', 'scripts/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // Browser context — widget web assets served inside iframes
  {
    files: ['src/web/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    rules: {
      // Ban any
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',

      // TypeScript handles undefined globals; no-undef creates false positives with TS types
      'no-undef': 'off',

      // non-nullable-type-assertion-style conflicts with no-non-null-assertion (we keep the latter)
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',

      // noUncheckedIndexedAccess makes indexed access return T | undefined; ! is
      // the idiomatic fix in bounds-checked loops and is cleaner than adding guards.
      '@typescript-eslint/no-non-null-assertion': 'off',

      // _-prefixed names are the TypeScript convention for required-but-unused args
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // Numbers in template literals are universally idiomatic; ban only non-serialisable types
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],

      // Arrow shorthand returning void is idiomatic for event handlers / callbacks
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],

      // Empty arrow functions are used as no-op callbacks; empty methods appear in test stubs
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions', 'methods'] }],
    },
  },
  {
    // Catch imports of packages not declared in package.json.
    // devDependencies are only allowed in build scripts, tests, and this config.
    plugins: { 'import-x': importX },
    rules: {
      'import-x/no-extraneous-dependencies': ['error', {
        devDependencies: ['scripts/**', 'test/**', 'eslint.config.mjs', 'rollup.config.mjs'],
      }],
    },
  },
  // Node's test runner awaits test Promises internally; floating-promise fires false positives
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  // The config file itself is not part of the tsconfig project; disable type-aware rules
  {
    files: ['*.mjs'],
    extends: [ts.configs.disableTypeChecked],
  },
  {
    ignores: ['dist/**', 'public/**', 'node_modules/**'],
  },
)
