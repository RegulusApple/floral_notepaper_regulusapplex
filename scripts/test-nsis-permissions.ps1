<#
.SYNOPSIS
  Compiles and runs the real NSIS data-directory hook in isolated fixtures.
  Does not register/install the app or use any existing Document directories.
#>
[CmdletBinding()]
param([string]$NsisRoot = "$env:LOCALAPPDATA\tauri\NSIS")
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = Join-Path $repo "local-build\nsis-permissions-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $testRoot | Out-Null
$compiler = Join-Path $NsisRoot 'makensis.exe'
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$hook = Join-Path $repo 'src-tauri\nsis-hooks.nsh'
$harness = Join-Path $repo 'tests\nsis\data-permissions.nsi'

foreach ($variant in @('normal', 'missing-tool')) {
  $output = Join-Path $testRoot "$variant.exe"
  $compilerArgs = @('/INPUTCHARSET', 'UTF8', '/WX', '/V2', "/DHOOKS=$hook", "/DTEST_EXE=$output")
  if ($variant -eq 'missing-tool') { $compilerArgs += '/DBROKEN_ICACLS' }
  & $compiler @compilerArgs $harness
  if ($LASTEXITCODE -ne 0) { throw "NSIS compilation failed ($variant)." }
}

function Set-FixtureAcl([string]$Path, [string]$Access) {
  $fullPath = [IO.Path]::GetFullPath($Path)
  if (-not $fullPath.StartsWith("$testRoot\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "ACL fixture outside test directory: $fullPath"
  }
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner($sid)
  # Do not grant Administrators access in the restrictive fixtures: the runner
  # may itself have a full token without a linked UAC token (e.g. CI).
  foreach ($admin in @('S-1-5-18')) {
    $principal = [Security.Principal.SecurityIdentifier]::new($admin)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      $principal, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  }
  $rights = if ($Access -eq 'readonly') { 'ReadAndExecute' } else { 'Modify' }
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    $sid, $rights, 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  if ($Access -eq 'denied') {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      [Security.Principal.SecurityIdentifier]::new('S-1-5-11'),
      'Write', 'ContainerInherit,ObjectInherit', 'None', 'Deny'))
  }
  Set-Acl -LiteralPath $fullPath -AclObject $acl
}

$cases = @(
  @{ Name = 'current-user'; Mode = 'CurrentUser'; Access = 'writable'; Tool = 'normal'; Exit = 0; Grant = 'skipped' },
  @{ Name = 'machine-sid'; Mode = 'AllUsers'; Access = 'readonly'; Tool = 'normal'; Exit = 0; Grant = '0' },
  @{ Name = 'machine-grant-failure-writable'; Mode = 'AllUsers'; Access = 'writable'; Tool = 'missing-tool'; Exit = 0; Grant = 'error' },
  @{ Name = 'machine-grant-failure-readonly'; Mode = 'AllUsers'; Access = 'readonly'; Tool = 'missing-tool'; Exit = 5; Grant = 'error' },
  @{ Name = 'current-user-readonly'; Mode = 'CurrentUser'; Access = 'readonly'; Tool = 'normal'; Exit = 5; Grant = 'skipped' },
  @{ Name = 'machine-deny'; Mode = 'AllUsers'; Access = 'denied'; Tool = 'normal'; Exit = 5; Grant = '0' },
  @{ Name = 'protected-child'; Mode = 'AllUsers'; Access = 'writable'; Tool = 'normal'; Exit = 5; Grant = '0'; ChildReadOnly = $true }
)
foreach ($case in $cases) {
  $install = Join-Path $testRoot "$($case.Name) 空格\floral-notepaper-regulusapplex"
  $document = Join-Path $install 'Document'
  foreach ($folder in @('', 'diary', 'weekly', 'monthly', 'tiles')) {
    New-Item -ItemType Directory -Path (Join-Path $document $folder) -Force | Out-Null
  }
  # An existing user file must survive both successful and failed installs.
  $sentinel = Join-Path $document 'existing.md'
  Copy-Item -LiteralPath (Join-Path $repo 'LICENSE') -Destination $sentinel
  $hash = (Get-FileHash -LiteralPath $sentinel).Hash
  Set-FixtureAcl $document $case.Access
  if ($case.ChildReadOnly) { Set-FixtureAcl (Join-Path $document 'diary') 'readonly' }
  $parentAcl = (Get-Acl -LiteralPath $install).Sddl
  $before = (Get-Acl -LiteralPath $document).Sddl
  $result = Join-Path $testRoot "$($case.Name).ini"
  $exe = Join-Path $testRoot "$($case.Tool).exe"
  $arguments = "/S /MODE=$($case.Mode) /RESULT=`"$result`" /D=$install"
  $process = Start-Process -FilePath $exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(45000)) {
    Stop-Process -Id $process.Id -Force
    throw "NSIS test timed out: $($case.Name)"
  }
  $output = Get-Content -LiteralPath $result -Raw
  if ($process.ExitCode -ne $case.Exit) {
    throw "$($case.Name): expected exit $($case.Exit), got $($process.ExitCode). $output"
  }
  if ($output -notmatch "(?m)^sid=$([regex]::Escape($sid.Value))\s*$") {
    throw "$($case.Name): incorrect installer SID. $output"
  }
  if ($output -notmatch "(?m)^grant=$($case.Grant)\s*$") {
    throw "$($case.Name): incorrect grant result. $output"
  }
  if ($process.ExitCode -eq 5 -and $output -notmatch '(?m)^error=.+') {
    throw "$($case.Name): failure must explain which directory is not writable."
  }
  if ($case.Mode -eq 'CurrentUser' -and (Get-Acl -LiteralPath $document).Sddl -ne $before) {
    throw 'CurrentUser unexpectedly changed Document permissions.'
  }
  if ((Get-Acl -LiteralPath $install).Sddl -ne $parentAcl) { throw 'Installation root ACL changed.' }
  if ((Get-FileHash -LiteralPath $sentinel).Hash -ne $hash) { throw 'Existing data changed.' }
  if (@(Get-ChildItem -LiteralPath $document -Recurse -Filter 'flr*.tmp').Count -ne 0) {
    throw 'A permission probe file was left behind.'
  }
  Write-Host "PASS $($case.Name)"
}
Write-Host "NSIS permission checks passed. Isolated fixtures: $testRoot"
