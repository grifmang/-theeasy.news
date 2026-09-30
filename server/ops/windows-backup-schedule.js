// Prints reviewable Task Scheduler commands. Never registers or removes a task.
const path=require('path');
const quote=value=>`'${value.replace(/'/g,"''")}'`;
function commands({node=process.execPath,script=path.join(__dirname,'backup-railway-to-windows.js')}={}) {
  if(process.platform!=='win32'||!path.isAbsolute(node)||!path.isAbsolute(script))throw new Error('Windows absolute paths required');
  const task="EasyNewsEncryptedBackup";
  const argument=`\"${script}\"`;
  return {
    install:`$action = New-ScheduledTaskAction -Execute ${quote(node)} -Argument ${quote(argument)} -WorkingDirectory ${quote(path.dirname(path.dirname(script)))}\n`+
      `$trigger = New-ScheduledTaskTrigger -Daily -At 03:00\n`+
      `$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew\n`+
      `$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited\n`+
      `Register-ScheduledTask -TaskName ${quote(task)} -Action $action -Trigger $trigger -Settings $settings -Principal $principal`,
    uninstall:`Unregister-ScheduledTask -TaskName ${quote(task)} -Confirm:$false`
  };
}
if(require.main===module) {
  try {
    const [mode,...extra]=process.argv.slice(2);
    if(extra.length||!['install','uninstall'].includes(mode))throw new Error('Usage: node windows-backup-schedule.js <install|uninstall>');
    console.log('# Run this in PowerShell as the Windows account that owns identity.dpapi.');
    console.log('# Interactive logon is required: missed runs start when that account next logs on; DPAPI CurrentUser cannot recover on a different account or fresh host.');
    console.log(commands()[mode]);
  }catch{console.error('Cannot generate Windows backup schedule command');process.exitCode=1;}
}
module.exports={commands};
