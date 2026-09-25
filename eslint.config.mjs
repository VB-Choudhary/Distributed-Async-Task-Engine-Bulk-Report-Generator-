// eslint.config.mjs
// ESLint flat config format (required from ESLint v9+)
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript-ESLint recommended + type-checked rules
  ...tseslint.configs.recommendedTypeChecked,

  // Prettier integration (disables formatting rules that conflict with Prettier)
  prettierConfig,

  {
    // Apply to all TypeScript source, test, and script files
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],

    languageOptions: {
      parserOptions: {
        // projectService auto-discovers tsconfigs. We set defaultProject to
        // tsconfig.test.json so test files and scripts (excluded from tsconfig.json) are
        // still parsed with full type information.
        projectService: {
          allowDefaultProject: ['tests/*.ts', 'tests/*/*.ts', 'scripts/*.ts'],
          defaultProject: './tsconfig.test.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },

    plugins: {
      prettier: prettierPlugin,
    },

    rules: {
      // Enforce Prettier formatting as an ESLint error
      'prettier/prettier': 'error',

      // Enforce explicit return types on functions — keeps the codebase self-documenting
      '@typescript-eslint/explicit-function-return-type': 'error',

      // Disallow floating promises — easy source of silent failures in async code
      '@typescript-eslint/no-floating-promises': 'error',

      // Disallow the unsafe `any` escape hatch
      '@typescript-eslint/no-explicit-any': 'error',

      // Unused vars are always a bug; prefix with _ to intentionally ignore
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  {
    // Ignore generated and dependency directories, and the ESLint config itself
    // (it's an .mjs file without a tsconfig reference, which breaks typed rules)
    ignores: ['dist/**', 'node_modules/**', 'vitest.config.ts', 'eslint.config.mjs'],
  },
);
