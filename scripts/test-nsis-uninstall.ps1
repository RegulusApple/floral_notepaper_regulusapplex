<# Tests the real Document uninstaller functions using isolated disposable data. #>
[CmdletBinding()]
param([string]$NsisRoot = "$env:LOCALAPPDATA\tauri\NSIS")
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = Join-Path $repo "local-build\nsis-uninstall-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $testRoot | Out-Null
$creator = Join-Path $testRoot 'creator.exe'
$uninstaller = Join-Path $testRoot 'test-uninstall.exe'
$hook = Join-Path $repo 'src-tauri\nsis-document-uninstall.nsh'
& (Join-Path $NsisRoot 'makensis.exe') '/INPUTCHARSET' 'UTF8' '/WX' '/V2' `
  "/DDOCUMENT_HOOK=$hook" "/DTEST_EXE=$creator" "/DTEST_UNINSTALLER=$uninstaller" `
  (Join-Path $repo 'tests\nsis\document-uninstall.nsi')
if ($LASTEXITCODE -ne 0) { throw 'Uninstall harness compilation failed.' }
$process = Start-Process -FilePath $creator -ArgumentList '/S' -WindowStyle Hidden -PassThru
if (-not $process.WaitForExit(45000) -or $process.ExitCode -ne 0) { throw 'Harness setup failed.' }

$cases = @(
  @{ Name = 'default-preserves-data'; Choice = ''; Keep = $true },
  @{ Name = 'explicit-delete'; Choice = 'delete'; Keep = $false },
  @{ Name = 'update-preserves-data'; Choice = 'delete'; Mode = 'update'; Keep = $true },
  @{ Name = 'passive-preserves-data'; Choice = 'delete'; Mode = 'passive'; Keep = $true },
  @{ Name = 'empty-document'; Empty = $true; Keep = $false },
  @{ Name = 'absent-document'; Absent = $true; Keep = $false },
  @{ Name = 'locked-file-reports-error'; Choice = 'delete'; Locked = $true; Keep = $true; Exit = 5 },
  @{ Name = 'nested-junction-preserves-target'; Choice = 'delete'; Link = 'nested'; Keep = $false },
  @{ Name = 'document-junction-rejected'; Choice = 'delete'; Link = 'document'; Keep = $true; Exit = 5 },
  @{ Name = 'ancestor-junction-rejected'; Choice = 'delete'; Link = 'ancestor'; Keep = $true; Exit = 5 }
)
foreach ($case in $cases) {
  $caseRoot = Join-Path $testRoot "$($case.Name) 空格"
  New-Item -ItemType Directory -Path $caseRoot | Out-Null
  $install = Join-Path $caseRoot 'floral-notepaper-regulusapplex'
  $outside = Join-Path $caseRoot 'outside-data'
  New-Item -ItemType Directory -Path $outside | Out-Null
  $externalSentinel = Join-Path $outside 'keep.md'
  Copy-Item -LiteralPath (Join-Path $repo 'LICENSE') -Destination $externalSentinel
  $externalHash = (Get-FileHash -LiteralPath $externalSentinel).Hash
  if ($case.Link -eq 'ancestor') {
    New-Item -ItemType Junction -Path $install -Target $outside | Out-Null
  } else {
    New-Item -ItemType Directory -Path $install | Out-Null
  }
  $document = Join-Path $install 'Document'
  if ($case.Link -eq 'document') {
    New-Item -ItemType Junction -Path $document -Target $outside | Out-Null
  } elseif (-not $case.Absent) {
    New-Item -ItemType Directory -Path $document | Out-Null
  }
  $sentinel = $null
  if (-not $case.Empty -and -not $case.Absent) {
    New-Item -ItemType Directory -Path (Join-Path $document 'diary') | Out-Null
    $sentinel = Join-Path $document 'diary\keep.md'
    Copy-Item -LiteralPath (Join-Path $repo 'LICENSE') -Destination $sentinel
    $hash = (Get-FileHash -LiteralPath $sentinel).Hash
  }
  if ($case.Link -eq 'nested') {
    New-Item -ItemType Junction -Path (Join-Path $document 'linked-folder') -Target $outside | Out-Null
  }
  $app = Join-Path $install 'application-sentinel.exe'
  New-Item -ItemType File -Path $app | Out-Null
  # The production deletion function must only ever receive this test fixture.
  $resolved = [IO.Path]::GetFullPath($install)
  if (-not $resolved.StartsWith("$testRoot\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Invalid test deletion target: $resolved"
  }
  $stream = $null
  try {
    if ($case.Locked) {
      $stream = [IO.File]::Open($sentinel, 'Open', 'Read', 'ReadWrite')
    }
    $arguments = "/S /CHOICE=$($case.Choice) /MODE=$($case.Mode) _?=$resolved"
    $process = Start-Process -FilePath $uninstaller -ArgumentList $arguments -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(45000)) {
      Stop-Process -Id $process.Id -Force
      throw "Uninstall test timed out: $($case.Name)"
    }
    $expectedExit = if ($case.Exit) { $case.Exit } else { 0 }
    $result = Get-Content -LiteralPath (Join-Path $caseRoot 'result.ini') -Raw
    if ($process.ExitCode -ne $expectedExit) { throw "$($case.Name): exit $($process.ExitCode). $result" }
    if ((Test-Path -LiteralPath $document) -ne $case.Keep) { throw "$($case.Name): unexpected Document state." }
    if ($case.Keep -and $sentinel -and (Get-FileHash -LiteralPath $sentinel).Hash -ne $hash) {
      throw "$($case.Name): preserved data changed."
    }
    if ($expectedExit -ne 0 -and $result -notmatch '(?m)^error=.+') { throw 'Missing deletion error.' }
    if ((Test-Path -LiteralPath $app) -ne ($expectedExit -ne 0)) { throw 'Incorrect application removal state.' }
    if ((Get-FileHash -LiteralPath $externalSentinel).Hash -ne $externalHash) { throw 'Data outside Document changed.' }
    Write-Host "PASS $($case.Name)"
  } finally {
    if ($stream) { $stream.Dispose() }
  }
}
Write-Host "NSIS uninstall checks passed. Test artifacts: $testRoot"
