param(
  [string]$Repository = "github:aabrur/crimson-odyssey#main",
  [switch]$FromCurrentDirectory
)

$ErrorActionPreference = "Stop"

Write-Host "Crimson Odyssey installer" -ForegroundColor Red

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 22 or newer is required. Install Node.js before running this script."
}

$major = [int]((node --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) {
  throw "Node.js 22 or newer is required. Current version: $(node --version)"
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required."
}

if ($FromCurrentDirectory -or (Test-Path (Join-Path $PSScriptRoot "package.json"))) {
  Push-Location $PSScriptRoot
  try {
    npm install -g .
  }
  finally {
    Pop-Location
  }
}
else {
  npm install -g $Repository
}

crimson --version
Write-Host "Installed. Run: crimson setup" -ForegroundColor Green
