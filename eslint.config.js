import eslint from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  {
    files: [
      '*.config.js',
      'scripts/**/*.js',
      'tests/**/*.js',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      globals: globals.browser,
    },
  },
];
