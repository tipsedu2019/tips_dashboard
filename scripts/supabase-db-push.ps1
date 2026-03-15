param()

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$localEnvPath = Join-Path $root '.env.supabase.local'
$defaultProjectRef = 'dqpccpblshdnqzbjvkxd'
$localNpmCachePath = Join-Path $root '.codex-temp\npm-cache'

function Import-EnvFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return
  }

  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) {
      return
    }

    $separator = $line.IndexOf('=')
    if ($separator -lt 1) {
      return
    }

    $name = $line.Substring(0, $separator).Trim()
    $value = $line.Substring($separator + 1).Trim()
    [System.Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

function Mask-Argument {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $Value
  }

  if ($Value -match '^postgresql://') {
    return ($Value -replace '://([^:]+):([^@]+)@', '://$1:***@')
  }

  if ($Value.StartsWith('sbp_')) {
    return 'sbp_***'
  }

  return $Value
}

function Invoke-SupabaseCli {
  param([string[]]$Arguments)

  $maskedArgs = $Arguments | ForEach-Object { Mask-Argument $_ }
  $localCli = Join-Path $root 'node_modules\.bin\supabase.cmd'
  $hasLocalCli = Test-Path $localCli
  $globalCli = Get-Command supabase -ErrorAction SilentlyContinue

  if ($hasLocalCli) {
    Write-Host ('> ' + $localCli + ' ' + ($maskedArgs -join ' '))
    & $localCli @Arguments
  } elseif ($globalCli) {
    Write-Host ('> supabase ' + ($maskedArgs -join ' '))
    & supabase @Arguments
  } else {
    Write-Host ('> npx --yes supabase@latest ' + ($maskedArgs -join ' '))
    New-Item -ItemType Directory -Force -Path $localNpmCachePath | Out-Null
    [System.Environment]::SetEnvironmentVariable('npm_config_cache', $localNpmCachePath, 'Process')
    [System.Environment]::SetEnvironmentVariable('npm_config_update_notifier', 'false', 'Process')
    & npx --yes supabase@latest @Arguments
  }

  if ($LASTEXITCODE -ne 0) {
    throw 'Supabase CLI command failed.'
  }
}

Import-EnvFile -Path $localEnvPath

$projectRef = if ([string]::IsNullOrWhiteSpace($env:SUPABASE_PROJECT_REF)) {
  $defaultProjectRef
} else {
  $env:SUPABASE_PROJECT_REF
}

if (-not [string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)) {
  Invoke-SupabaseCli -Arguments @(
    'db',
    'push',
    '--db-url',
    $env:SUPABASE_DB_URL,
    '--include-all'
  )
  exit 0
}

if ([string]::IsNullOrWhiteSpace($env:SUPABASE_ACCESS_TOKEN) -or [string]::IsNullOrWhiteSpace($env:SUPABASE_DB_PASSWORD)) {
  throw @"
Set one of the following before running db:push:
- SUPABASE_DB_URL
- SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD

Recommended:
1. Copy .env.supabase.example to .env.supabase.local
2. Fill in the values once
3. Run npm run db:push
"@
}

Invoke-SupabaseCli -Arguments @(
  'login',
  '--token',
  $env:SUPABASE_ACCESS_TOKEN
)

Invoke-SupabaseCli -Arguments @(
  'link',
  '--project-ref',
  $projectRef,
  '--password',
  $env:SUPABASE_DB_PASSWORD
)

Invoke-SupabaseCli -Arguments @(
  'db',
  'push',
  '--linked',
  '--include-all'
)
