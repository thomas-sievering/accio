import babelParser from '@babel/eslint-parser';
import reactHooks from 'eslint-plugin-react-hooks';
import busyButton from './scripts/eslint/busy-button.js';

// Babel parses the TypeScript because typescript-eslint does not yet support TypeScript 7.
const parse = (plugins) => ({
  parser: babelParser,
  parserOptions: { requireConfigFile: false, babelOptions: { babelrc: false, configFile: false, parserOpts: { plugins } } },
});

// The React Hooks rules and one house rule: the repository adopts no other lint rules and no formatter.
// accio/busy-button keeps every pending action looking the same (AGENTS.md, "Waiting on an action").
export default [
  { files: ['apps/web/src/**/*.ts'], languageOptions: parse(['typescript']) },
  { files: ['apps/web/src/**/*.tsx'], languageOptions: parse(['typescript', 'jsx']) },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { 'react-hooks': reactHooks, accio: { rules: { 'busy-button': busyButton } } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'accio/busy-button': 'error',
    },
  },
];
