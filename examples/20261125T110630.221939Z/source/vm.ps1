param(
    [ValidateSet('status','start','wait','retest')][string]$Action = 'status',
    [Parameter(ValueFromRemainingArguments=$true)][string[]]$RunnerArgs
)
$ErrorActionPreference = 'Stop'
$vmWindowsPath = Join-Path $PSScriptRoot 'openeuler-vm'
$vmLinuxPath = (& wsl -d Ubuntu -- wslpath -a $vmWindowsPath.Replace('\','/')).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve WSL path' }
& wsl -d Ubuntu -- bash "$vmLinuxPath/$Action.sh" @RunnerArgs
exit $LASTEXITCODE
