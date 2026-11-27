param(
    [ValidateSet('status','start','wait','retest')][string]$Action = 'status',
    [Parameter(ValueFromRemainingArguments=$true)][string[]]$RunnerArgs
)
$ErrorActionPreference = 'Stop'
$vmWindowsPath = Join-Path $PSScriptRoot 'openeuler-vm'
$distro = if ($env:VMOBSERVE_WSL_DISTRO -and $env:VMOBSERVE_WSL_DISTRO.Trim()) { $env:VMOBSERVE_WSL_DISTRO.Trim() } else { 'Ubuntu' }
$vmLinuxPath = (& wsl -d $distro -- wslpath -a $vmWindowsPath.Replace('\','/')).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve WSL path' }
& wsl -d $distro -- bash "$vmLinuxPath/$Action.sh" @RunnerArgs
exit $LASTEXITCODE
