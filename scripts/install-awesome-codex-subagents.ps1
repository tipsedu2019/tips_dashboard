param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$repoZipUrl = "https://github.com/VoltAgent/awesome-codex-subagents/archive/refs/heads/main.zip"
$targetDir = Join-Path $env:USERPROFILE ".codex\agents"
$tempRoot = Join-Path $env:TEMP "awesome-codex-subagents-install"
$zipPath = Join-Path $tempRoot "awesome-codex-subagents-main.zip"
$extractRoot = Join-Path $tempRoot "extract"
$repoRoot = Join-Path $extractRoot "awesome-codex-subagents-main"
$categoriesRoot = Join-Path $repoRoot "categories"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $targetDir "_backup-$timestamp"

function Download-RepoZip {
  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

  try {
    Invoke-WebRequest -Uri $repoZipUrl -OutFile $zipPath -Headers @{ "User-Agent" = "CodexInstaller" }
    return
  } catch {
  }

  $handler = New-Object System.Net.Http.HttpClientHandler
  $client = New-Object System.Net.Http.HttpClient($handler)
  $client.DefaultRequestHeaders.UserAgent.ParseAdd("CodexInstaller/1.0")

  try {
    $bytes = $client.GetByteArrayAsync($repoZipUrl).GetAwaiter().GetResult()
    [System.IO.File]::WriteAllBytes($zipPath, $bytes)
  } finally {
    $client.Dispose()
    $handler.Dispose()
  }
}

if (Test-Path $extractRoot) {
  Remove-Item $extractRoot -Recurse -Force
}

Download-RepoZip

if (Test-Path $extractRoot) {
  Remove-Item $extractRoot -Recurse -Force
}

Expand-Archive -Path $zipPath -DestinationPath $extractRoot -Force

if (-not (Test-Path $categoriesRoot)) {
  throw "Could not find categories directory in extracted repository."
}

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

$agentFiles = Get-ChildItem -Path $categoriesRoot -Recurse -Filter *.toml | Sort-Object Name

if ($agentFiles.Count -eq 0) {
  throw "No agent files were found in the downloaded repository."
}

$installed = 0
$overwritten = 0
$backedUp = 0

foreach ($file in $agentFiles) {
  $dest = Join-Path $targetDir $file.Name

  if (Test-Path $dest) {
    if (-not $Force) {
      New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
      Copy-Item -Path $dest -Destination (Join-Path $backupDir $file.Name) -Force
      $backedUp++
    }

    Copy-Item -Path $file.FullName -Destination $dest -Force
    $overwritten++
    continue
  }

  Copy-Item -Path $file.FullName -Destination $dest -Force
  $installed++
}

Write-Host "Installed new agents: $installed"
Write-Host "Overwritten agents: $overwritten"
Write-Host "Backed up existing agents: $backedUp"
Write-Host "Target directory: $targetDir"

if (Test-Path $backupDir) {
  Write-Host "Backup directory: $backupDir"
}

Write-Host "Restart Codex to pick up the new subagents."
