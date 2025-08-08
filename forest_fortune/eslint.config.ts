import js from '@eslint/js';
import parser from '@typescript-eslint/parser';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const prettierConfig = require('eslint-config-prettier');
const nodePlugin = require('eslint-plugin-node');

dotenv.config();

export default [
  js.configs.recommended,
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '*.min.js',
      'coverage/**',
      'eslint.config.ts' // Ignore this config file itself
    ]
  },
  // JavaScript files configuration
  // {
  //   files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
  //   languageOptions: {
  //     ecmaVersion: 'latest',
  //     sourceType: 'module',
  //     globals: {
  //       console: 'readonly',
  //       process: 'readonly',
  //       __dirname: 'readonly',
  //       module: 'readonly',
  //       require: 'readonly',
  //       Buffer: 'readonly',
  //       setTimeout: 'readonly',
  //       clearTimeout: 'readonly',
  //       setInterval: 'readonly',
  //       clearInterval: 'readonly',
  //     },
  //   },
  //   plugins: {
  //     node: nodePlugin,
  //   },
  //   rules: {
  //     'node/no-unsupported-features/es-syntax': 'off',
  //     'no-magic-numbers': ['warn', { ignore: [0, 1, -1], enforceConst: true }],
  //     'consistent-return': 'warn',
  //     'no-duplicate-imports': 'error',
  //     'object-shorthand': ['warn', 'always'],
  //     'prefer-arrow-callback': 'warn',
  //     'arrow-body-style': ['warn', 'as-needed'],
  //     'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
  //     'no-unreachable': 'error',
  //     'complexity': ['warn', { max: 10 }],
  //     // 'max-lines-per-function': ['warn', { max: 60 }],
  //     'camelcase': ['warn', { properties: 'always' }],
  //     'no-nested-ternary': 'warn',
  //     'prefer-const': 'warn',
  //     'prefer-template': 'warn',
  //     'no-var': 'error',
  //     'no-restricted-syntax': [
  //       'warn',
  //       {
  //         selector: 'ForStatement',
  //         message: 'Avoid `for`; prefer for...of, map, or forEach unless performance/early exit required.',
  //       },
  //       {
  //         selector: 'ForInStatement',
  //         message: '`for...in` is discouraged; use Object.keys/entries + forEach instead.',
  //       },
  //       {
  //         selector: 'WhileStatement',
  //         message: '`while` loops are discouraged unless absolutely necessary.',
  //       },
  //     ],
  //   },
  // },
  // TypeScript files configuration
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: path.resolve(),
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        module: 'readonly',
        require: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    plugins: {
      node: nodePlugin,
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'node/no-unsupported-features/es-syntax': 'off',
      'no-magic-numbers': ['warn', { ignore: [0, 1, -1], enforceConst: true }],
      'consistent-return': 'warn',
      'no-duplicate-imports': 'error',
      'object-shorthand': ['warn', 'always'],
      'prefer-arrow-callback': 'warn',
      'arrow-body-style': ['warn', 'as-needed'],
      // Disable base rule for TypeScript files
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
      'no-unreachable': 'error',
      'complexity': ['warn', { max: 10 }],
      // 'max-lines-per-function': ['warn', { max: 60 }],
      'camelcase': ['warn', { properties: 'always' }],
      'no-nested-ternary': 'warn',
      'prefer-const': 'warn',
      'prefer-template': 'warn',
      'no-var': 'error',
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'ForStatement',
          message: 'Avoid `for`; prefer for...of, map, or forEach unless performance/early exit required.',
        },
        {
          selector: 'ForInStatement',
          message: '`for...in` is discouraged; use Object.keys/entries + forEach instead.',
        },
        {
          selector: 'WhileStatement',
          message: '`while` loops are discouraged unless already necessary.',
        },
      ],
    },
  },
  prettierConfig,
];

// // eslint.config.js
// import js from '@eslint/js';
// import parser from '@typescript-eslint/parser';
// import { createRequire } from 'node:module';
// import path from 'node:path';

// const require = createRequire(import.meta.url);
// const tsPlugin = require('@typescript-eslint/eslint-plugin');
// const prettierConfig = require('eslint-config-prettier');
// import process from 'node:process'; 
// import dotenv from 'dotenv';
// dotenv.config();

// export default [
//   js.configs.recommended,
//   {
//     ignores: [
//       'node_modules/**',
//       'dist/**',
//       'build/**',
//       '*.min.js',
//       'coverage/**',
//       'eslint.config.ts' // Ignore this config file itself
//     ]
//   },
//   {
//     files: ['**/*.ts'],
//     languageOptions: {
//       parser,
//       parserOptions: {
//         // ⬅️ These 2 lines are necessary
//         project: './tsconfig.json',
//         tsconfigRootDir: path.resolve(),
//         ecmaVersion: 'latest',
//         sourceType: 'module',
//       },
//       globals: {
//         console: 'readonly',
//         process: 'readonly',
//         __dirname: 'readonly',
//         module: 'readonly',
//         require: 'readonly',
//         Buffer: 'readonly',
//         setTimeout: 'readonly',
//         clearTimeout: 'readonly',
//         setInterval: 'readonly',
//         clearInterval: 'readonly',
//       },
//     },
//     plugins: {
//       '@typescript-eslint': tsPlugin,
//     },
//     rules: {
//       '@typescript-eslint/no-unused-vars': 'warn',
//       '@typescript-eslint/no-explicit-any': 'warn',
//       '@typescript-eslint/no-floating-promises': 'warn',
//       '@typescript-eslint/explicit-function-return-type': 'warn',
//       'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
//       'no-unreachable': 'error',
//       'complexity': ['warn', { max: 10 }],
//       'max-lines-per-function': ['warn', { max: 60 }],
//       'camelcase': ['warn', { properties: 'always' }],
//       'no-nested-ternary': 'warn',
//       'prefer-const': 'warn',
//       'prefer-template': 'warn',
//       'no-var': 'error',
//     },
//   },
//   {
//     ...prettierConfig,
//   },
// ];
