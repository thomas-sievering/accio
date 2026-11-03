/** Display only: unwrap a single shell script argument, retaining ambiguous invocations. */
export function shellCommandSummary(command: string, truncated = false): string {
  const tokens = shellWords(command.trim(), truncated);
  if (!tokens?.length) return command;
  const program = tokens[0]!.split(/[\\/]/).at(-1)!.toLowerCase().replace(/\.exe$/, '');
  const powershell = program === 'powershell' || program === 'pwsh';
  const posix = ['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'].includes(program);
  if (!powershell && !posix) return command;
  for (let index = 1; index < tokens.length; index++) {
    const flag = tokens[index]!.toLowerCase();
    const scriptFlag = powershell ? flag === '-command' || flag === '-c'
      : flag === '--command' || /^-[ilr]*c[ilr]*$/.test(flag);
    if (scriptFlag) return index === tokens.length - 2 && tokens[index + 1]!.trim()
      ? tokens[index + 1]!.trim() : command;
    const knownFlag = powershell ? ['-nologo', '-noprofile', '-noninteractive', '-noexit'].includes(flag)
      : ['-l', '-i', '-r', '--login', '--noprofile', '--norc'].includes(flag);
    if (!knownFlag) return command;
  }
  return command;
}

// Codex reports shell-quoted argv, including on Windows. Decode that outer
// quoting only; never interpret the script inside it. Operators outside quoted
// arguments, extra arguments, and incomplete quoting retain the raw command.
function shellWords(input: string, truncated: boolean): string[] | null {
  const words: string[] = [];
  let word = '';
  let quote: string | undefined;
  let started = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index]!;
    if (char === '\\' && quote !== "'") {
      const next = input[index + 1];
      if (next === undefined) return null;
      // Keep ordinary Windows path separators, including inside double quotes.
      if ((quote === '"' || /^[A-Za-z]:/.test(word)) && !['"', '\\', '$', '`', '\n'].includes(next)) word += char;
      else { word += next; index++; }
      started = true;
    } else if (quote) {
      if (char === quote) quote = undefined;
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/[;&|<>`$(){}#]/.test(char)) {
      return null;
    } else if (/\s/.test(char)) {
      if (started) { words.push(word); word = ''; started = false; }
    } else {
      word += char;
      started = true;
    }
  }
  // Older transcript previews were clipped before wrapper removal. Their
  // explicit ellipsis permits showing the remaining (still clipped) script.
  if (quote && !(truncated && input.endsWith('…'))) return null;
  if (started) words.push(word);
  return words;
}
