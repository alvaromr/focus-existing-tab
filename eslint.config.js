import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/', 'store/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['src/**', 'options/**', 'popup/**'],
    languageOptions: { globals: { ...globals.browser, chrome: 'readonly' } },
  },
  {
    // The pure core: no browser or extension APIs, so it runs and is tested in plain Node.
    files: ['src/lib/**'],
    rules: {
      'no-restricted-globals': ['error', 'chrome', 'document', 'window', 'navigator'],
      'no-restricted-imports': ['error', { patterns: ['**/chrome/*', '../*'] }],
    },
  },
  {
    files: ['scripts/**', 'test/**'],
    languageOptions: { globals: { ...globals.node, WebSocket: 'readonly' } },
  },
];
