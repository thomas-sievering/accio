// Prints a recorded change log as a timeline, one block per frame that changed.
// Usage: node .agents/skills/smooth-ui/scripts/changes.mjs out/smooth/<tag> [ignore-regex]
// The optional regex drops moves of elements that legitimately animate (spinners, clocks).
import { readFileSync } from 'node:fs';

const [dir, ignore] = process.argv.slice(2);
const skip = ignore ? new RegExp(ignore) : undefined;
for (const frame of JSON.parse(readFileSync(`${dir}/changes.json`, 'utf8'))) {
  const moved = skip ? frame.moved.filter((m) => !skip.test(m)) : frame.moved;
  if (!frame.added.length && !frame.removed.length && !moved.length) continue;
  console.log(`== t=${frame.t}ms  +${frame.added.length} -${frame.removed.length} ~${moved.length}`);
  for (const k of frame.added.slice(0, 12)) console.log(`  + ${k}`);
  for (const k of frame.removed.slice(0, 12)) console.log(`  - ${k}`);
  for (const k of moved.slice(0, 12)) console.log(`  ~ ${k}`);
}
