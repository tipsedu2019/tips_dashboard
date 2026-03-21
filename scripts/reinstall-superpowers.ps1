$ErrorActionPreference = "Stop"

$userProfile = $env:USERPROFILE
$repoPath = Join-Path $userProfile ".codex\superpowers"
$skillsPath = Join-Path $repoPath "skills"
$agentsRoot = Join-Path $userProfile ".agents"
$agentsSkills = Join-Path $agentsRoot "skills"
$linkPath = Join-Path $agentsSkills "superpowers"
$configPath = Join-Path $userProfile ".codex\config.toml"

Write-Host "Reinstalling Superpowers for the current Windows user..."
Write-Host "User profile: $userProfile"

if (-not (Test-Path $repoPath)) {
  throw "Superpowers repo was not found at $repoPath"
}

if (-not (Test-Path $skillsPath)) {
  throw "Superpowers skills directory was not found at $skillsPath"
}

New-Item -ItemType Directory -Force -Path $agentsSkills | Out-Null

if (Test-Path $linkPath) {
  $existing = Get-Item $linkPath -Force
  if ($existing.Attributes.ToString().Contains("ReparsePoint")) {
    Remove-Item $linkPath -Force
  } else {
    Remove-Item $linkPath -Recurse -Force
  }
}

$mklinkOutput = cmd /c mklink /J "$linkPath" "$skillsPath" 2>&1
Write-Host $mklinkOutput

if (-not (Test-Path $linkPath)) {
  throw "Failed to create junction at $linkPath"
}

Write-Host ""
Write-Host "Superpowers junction is ready:"
Get-Item $linkPath | Select-Object FullName, Attributes, LinkType, Target | Format-List

if (Test-Path $configPath) {
  Write-Host ""
  Write-Host "Codex config:"
  Get-Content $configPath
}

Write-Host ""
Write-Host "Next step: restart Codex to pick up the new skills."
