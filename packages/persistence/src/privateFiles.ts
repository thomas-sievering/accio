import { spawn } from 'node:child_process';
import { chmod, lstat, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';

/** Private stdin/stdout are consumed here, never included in errors or diagnostics. */
export function privatePowerShell(script: string, input = '', path?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; ${script}`], {
      windowsHide: true, stdio: 'pipe', env: { ...process.env, ACCIO_PRIVATE_PATH: path ?? '' },
    });
    let output = ''; let failed = false;
    const timer = setTimeout(() => { failed = true; child.kill(); }, 10_000);
    child.stdout.on('data', (data) => { output += String(data); if (output.length > 1_000_000) { failed = true; child.kill(); } });
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); reject(new Error('Private storage operation failed.')); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 && !failed ? resolve(output.trim()) : reject(new Error('Private storage operation failed.')); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/** Secure before creating any files. On Windows verify the resulting allow rules. */
export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe private storage directory.');
  if (process.platform === 'win32') {
    await privatePowerShell(`
      $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;
      function Test-PrivateAcl($a){
        if(-not $a.AreAccessRulesProtected){return $false};
        if($a.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){return $false};
        $ownerAllowed=$false;
        foreach($r in $a.Access){
          if($r.AccessControlType -eq 'Allow'){
            if($r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){return $false};
            if(($r.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl){$ownerAllowed=$true}
          }
        }; return $ownerAllowed
      };
      if(Test-PrivateAcl (Get-Acl -LiteralPath $env:ACCIO_PRIVATE_PATH)){exit 0};
      $acl=New-Object Security.AccessControl.DirectorySecurity;
      $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false);
      $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow');
      $acl.AddAccessRule($rule); Set-Acl -LiteralPath $env:ACCIO_PRIVATE_PATH -AclObject $acl;
      $check=Get-Acl -LiteralPath $env:ACCIO_PRIVATE_PATH;
      if(-not (Test-PrivateAcl $check)){throw 'unexpected access'}
    `, '', path);
  } else {
    if (process.getuid && info.uid !== process.getuid()) throw new Error('Private storage belongs to another user.');
    await chmod(path, 0o700);
  }
}

/** The parent must have been secured first. Exclusive creation never replaces a link. */
export async function privateFile(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
