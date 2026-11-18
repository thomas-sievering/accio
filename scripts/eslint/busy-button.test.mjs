import { RuleTester } from 'eslint';
import { test } from 'node:test';
import babelParser from '@babel/eslint-parser';
import rule from './busy-button.js';

RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (name, fn) => test(name, fn);
RuleTester.itOnly = RuleTester.it;

const tester = new RuleTester({
  languageOptions: {
    parser: babelParser,
    parserOptions: { requireConfigFile: false, babelOptions: { babelrc: false, configFile: false, parserOpts: { plugins: ['typescript', 'jsx'] } } },
  },
});

tester.run('accio/busy-button', rule, {
  valid: [
    `<Button busy={busy} busyLabel="Saving…">Save</Button>`,
    // A status line, not a button, may say what is happening.
    `<small>{busy ? 'Saving…' : status}</small>`,
    // An ellipsis that opens something is no wait.
    `<button>{busy ? 'Rename…' : 'Rename'}</button>`,
    `<button>{open ? 'Hiding…' : 'Show'}</button>`,
  ],
  invalid: [
    { code: `<button disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>`, errors: [{ messageId: 'useButton' }] },
    { code: `<button disabled={save.busy}><span>{save.busy ? 'Copying...' : 'Copy'}</span></button>`, errors: [{ messageId: 'useButton' }] },
    { code: `<button>{!busy ? 'Apply' : \`Applying…\`}</button>`, errors: [{ messageId: 'useButton' }] },
    { code: `<SettingsFooter saveLabel={busy ? 'Adding…' : 'Add'} />`, errors: [{ messageId: 'useButton' }] },
  ],
});
