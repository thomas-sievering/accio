import { expect, it } from 'vitest';
import { shellCommandSummary } from './shellCommand.js';

it.each([
  [String.raw`"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'git status'`, 'git status'],
  [String.raw`"C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -NonInteractive -Command 'Get-Content "my file.txt"'`, 'Get-Content "my file.txt"'],
  [String.raw`powershell.exe -Command "Write-Output \"hello\""`, 'Write-Output "hello"'],
  ["/bin/bash -lc 'git status && pnpm test'", 'git status && pnpm test'],
  ["/bin/sh -c 'echo first\necho second'", 'echo first\necho second'],
  ["zsh --login --command 'echo hello'", 'echo hello'],
])('shows the script inside %s', (raw, script) => {
  expect(shellCommandSummary(raw)).toBe(script);
});

it.each([
  'git status', 'Get-Content notes.txt', "python -c 'print(1)'",
  "bash -lc 'echo $0' name", "bash -lc 'pwd'; git status",
  "bash -lc 'pwd' && git status", "bash -lc 'unterminated", "bash -lc ''",
  'powershell.exe -File script.ps1', 'pwsh -EncodedCommand abc',
  "bash --unknown -c 'pwd'", "env bash -c 'pwd'",
])('retains ambiguous or ordinary commands: %s', raw => {
  expect(shellCommandSummary(raw)).toBe(raw);
});

it('unwraps explicitly clipped legacy previews only when requested', () => {
  const raw = String.raw`"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'Get-Content long…`;
  expect(shellCommandSummary(raw)).toBe(raw);
  expect(shellCommandSummary(raw, true)).toBe('Get-Content long…');
});
