param([ValidateSet('status','basics','git','container','linkage','shell')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'
$linuxPath = (& wsl -d Ubuntu -- wslpath -a $PSScriptRoot.Replace('\','/')).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve WSL path' }
& wsl -d Ubuntu -- bash "$linuxPath/vm-demo.sh" $Action
exit $LASTEXITCODE
