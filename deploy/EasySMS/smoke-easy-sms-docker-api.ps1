param(
  [string]$BaseUrl = "http://127.0.0.1:18081",
  [string]$ApiKey,
  [switch]$Rebuild
)

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

if ($Rebuild) {
  docker compose -f (Join-Path $workspaceRoot "deploy/EasySMS/docker-compose.yaml") up -d --build
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose up failed."
  }
}

$headers = @{}
if ($ApiKey) {
  $headers["Authorization"] = "Bearer $ApiKey"
}

$health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/healthz" -Headers $headers
$providers = Invoke-RestMethod -Method Get -Uri "$BaseUrl/providers" -Headers $headers
$providerHealth = Invoke-RestMethod -Method Get -Uri "$BaseUrl/providers/health" -Headers $headers
$probeResults = Invoke-RestMethod -Method Post -Uri "$BaseUrl/providers/probe" -Headers $headers
$numbers = Invoke-RestMethod -Method Get -Uri "$BaseUrl/sms/public-numbers?limit=5" -Headers $headers

Write-Host "Health:" ($health | ConvertTo-Json -Depth 4)
Write-Host "Providers:" ($providers | ConvertTo-Json -Depth 6)
Write-Host "Provider Health:" ($providerHealth | ConvertTo-Json -Depth 8)
Write-Host "Probe Results:" ($probeResults | ConvertTo-Json -Depth 8)
Write-Host "Public Numbers:" ($numbers | ConvertTo-Json -Depth 6)
