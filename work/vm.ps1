[CmdletBinding(PositionalBinding=$false)]
param(
    [Parameter(Position=0)]
    [ValidateSet('status','start','wait','retest')][string]$Action = 'status',
    [string]$StudentSource,
    [Parameter(ValueFromRemainingArguments=$true)][string[]]$RunnerArgs
)
$ErrorActionPreference = 'Stop'
$vmWindowsPath = Join-Path $PSScriptRoot 'openeuler-vm'
$distro = if ($env:VMOBSERVE_WSL_DISTRO -and $env:VMOBSERVE_WSL_DISTRO.Trim()) { $env:VMOBSERVE_WSL_DISTRO.Trim() } else { 'Ubuntu' }
function Convert-ToWslPath([string]$Path) {
    $mapped = & wsl -d $distro --exec wslpath -a $Path.Replace('\','/')
    if ($LASTEXITCODE -ne 0 -or !$mapped) { throw "Cannot resolve WSL path: $Path" }
    $mapped.Trim()
}
if ($PSBoundParameters.ContainsKey('StudentSource')) {
    if ($Action -ne 'retest') { throw '-StudentSource requires the retest action' }
    $source = Get-Item -LiteralPath $StudentSource
    if ($source -isnot [IO.FileInfo]) { throw '-StudentSource must point to a local C file' }
    $RunnerArgs = @($RunnerArgs) + @('--student-source', (Convert-ToWslPath $source.FullName))
}
$vmLinuxPath = Convert-ToWslPath $vmWindowsPath
& wsl -d $distro --exec bash "$vmLinuxPath/$Action.sh" @RunnerArgs
exit $LASTEXITCODE
