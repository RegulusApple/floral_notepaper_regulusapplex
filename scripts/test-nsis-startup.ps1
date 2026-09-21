<#
.SYNOPSIS
  Verifies the built installer initialization without installing the app.
  Uses isolated registry keys and exits at the end of the real .onInit function.
#>
[CmdletBinding()]
param([string]$NsisRoot = "$env:LOCALAPPDATA\tauri\NSIS")
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$generated = Join-Path $repo 'src-tauri\target\x86_64-pc-windows-msvc\release\nsis\x64'
$testId = [guid]::NewGuid().ToString('N')
$testRoot = Join-Path $repo "local-build\nsis-startup-$testId"
New-Item -ItemType Directory -Path $testRoot | Out-Null
$source = Get-Content -LiteralPath (Join-Path $generated 'installer.nsi') -Raw
$registryBase = "Software\FloralInstallerTests\$testId"
$source = $source.Replace('!define MANUKEY "Software\${MANUFACTURER}"', "!define MANUKEY `"$registryBase`"")
$source = $source.Replace('!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRIVATE_INSTALL_NAME}"',
  "!define UNINSTKEY `"$registryBase\Uninstall`"")
$source = $source.Replace('!define OUTFILE "nsis-output.exe"', '!define OUTFILE "startup-test.exe"')
# The actual initialization is preserved; only its exit is intercepted. No
# installation section, permissions hook, application, or uninstaller runs.
$probe = @'
  FileOpen $R0 "$EXEDIR\init-result.ini" w
  FileWriteWord $R0 0xFEFF
  FileClose $R0
  WriteINIStr "$EXEDIR\init-result.ini" "startup" "directory" "$INSTDIR"
  WriteINIStr "$EXEDIR\init-result.ini" "startup" "scope" "$MultiUser.InstallMode"
  SetErrorLevel 0
  Quit
FunctionEnd
'@
$initPattern = [regex]::new('(?ms)^(Function \.onInit\b.*?)^FunctionEnd')
if ($initPattern.Matches($source).Count -ne 1) { throw 'Expected exactly one installer .onInit.' }
$source = $initPattern.Replace($source, { param($match) $match.Groups[1].Value + $probe })
$testScript = Join-Path $testRoot 'startup-test.nsi'
[IO.File]::WriteAllText($testScript, $source, [Text.UTF8Encoding]::new($false))
foreach ($include in @('utils.nsh', 'FileAssociation.nsh', 'SimpChinese.nsh')) {
  Copy-Item -LiteralPath (Join-Path $generated $include) -Destination $testRoot
}
# The upstream template contains unused StrCase/StrLoc/Skip helpers and a label.
# Keep all other warnings fatal, in particular unknown variables (6000).
$compileArgs = @('/INPUTCHARSET', 'UTF8', '/WX', '/V2',
  '/X!pragma warning disable 6010', '/X!pragma warning disable 6012', $testScript)
& (Join-Path $NsisRoot 'makensis.exe') @compileArgs
if ($LASTEXITCODE -ne 0) { throw 'Startup probe compilation failed.' }

$userHive = [Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser', 'Registry64')
$machineHive = [Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine', 'Registry64')
$keyPath = "$registryBase\floral-notepaper-regulusapplex"
$userKey = $null
$machineKey = $null
try {
  $userKey = $userHive.CreateSubKey($keyPath)
  $machineKey = $machineHive.CreateSubKey($keyPath)
  $stale = Join-Path $testRoot 'removed-installation'
  $userKey.SetValue('', $stale)
  $machineKey.SetValue('', $stale)
  $userDefault = Join-Path $env:LOCALAPPDATA 'Programs\floral-notepaper-regulusapplex'
  $machineDefault = Join-Path $env:ProgramW6432 'floral-notepaper-regulusapplex'
  $custom = Join-Path $testRoot '自选目录 空格\floral-notepaper-regulusapplex'
  $exe = Join-Path $testRoot 'startup-test.exe'
  $resultFile = Join-Path $testRoot 'init-result.ini'
  function Assert-Startup([string]$Name, [string]$Arguments, [string]$ExpectedDir, [string]$ExpectedScope) {
    $process = Start-Process -FilePath $exe -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(45000)) {
      Stop-Process -Id $process.Id -Force
      throw "Startup test timed out: $Name"
    }
    $result = Get-Content -LiteralPath $resultFile -Raw
    if ($process.ExitCode -ne 0 -or
        $result -notmatch "(?m)^directory=$([regex]::Escape($ExpectedDir))\s*$" -or
        $result -notmatch "(?m)^scope=$ExpectedScope\s*$") {
      throw "$Name failed (exit $($process.ExitCode)): $result"
    }
    Write-Host "PASS $Name"
  }
  Assert-Startup 'fresh-default-ignores-stale-location' '/S' $machineDefault 'AllUsers'
  Assert-Startup 'current-user-default' '/S /CurrentUser' $userDefault 'CurrentUser'
  Assert-Startup 'explicit-custom-path' "/S /AllUsers /D=$custom" $custom 'AllUsers'
  Assert-Startup 'update-ignores-removed-installation' '/S /UPDATE' $machineDefault 'AllUsers'

  # Files are harmless test sentinels and are never launched.
  $existing = Join-Path $testRoot 'existing-user-install'
  New-Item -ItemType Directory -Path $existing | Out-Null
  New-Item -ItemType File -Path (Join-Path $existing 'floral-notepaper-regulusapplex.exe') | Out-Null
  New-Item -ItemType File -Path (Join-Path $existing 'uninstall.exe') | Out-Null
  $userKey.SetValue('', $existing)
  Assert-Startup 'update-preserves-user-scope-and-location' '/S /UPDATE' $existing 'CurrentUser'
  Assert-Startup 'explicit-mode-takes-precedence' '/S /UPDATE /AllUsers' $machineDefault 'AllUsers'
  Assert-Startup 'fresh-default-with-existing-user-install' '/S' $machineDefault 'AllUsers'
} finally {
  if ($null -ne $userKey) { $userKey.Dispose() }
  if ($null -ne $machineKey) { $machineKey.Dispose() }
  # Exact, unique test keys only; app uninstall/manufacturer keys are untouched.
  $userHive.DeleteSubKeyTree($registryBase, $false)
  $machineHive.DeleteSubKeyTree($registryBase, $false)
  $userHive.Dispose()
  $machineHive.Dispose()
}
Write-Host "NSIS startup checks passed. Probe artifacts: $testRoot"
