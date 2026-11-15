import babelParser from '@babel/eslint-parser';
import reactHooks from 'eslint-plugin-react-hooks';

// Babel parses the TypeScript because typescript-eslint does not yet support TypeScript 7.
const parse = (plugins) => ({
  parser: babelParser,
  parserOptions: { requireConfigFile: false, babelOptions: { babelrc: false, configFile: false, parserOpts: { plugins } } },
});

// Only the React Hooks rules: the repository adopts no other lint rules and no formatter.
export default [
  { files: ['apps/web/src/**/*.ts'], languageOptions: parse(['typescript']) },
  { files: ['apps/web/src/**/*.tsx'], languageOptions: parse(['typescript', 'jsx']) },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
];
