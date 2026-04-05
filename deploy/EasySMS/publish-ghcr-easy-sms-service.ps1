param(
  [string]$Owner = $env:GITHUB_REPOSITORY_OWNER,
  [string]$Tag = (Get-Date -Format "yyyyMMddHHmmss"),
  [switch]$Push
)

if (-not $Owner) {
  throw "Owner is required. Pass -Owner or set GITHUB_REPOSITORY_OWNER."
}

$image = "ghcr.io/$Owner/easy-sms-service"

docker build `
  -f deploy/EasySMS/Dockerfile `
  -t "${image}:${Tag}" `
  .

if ($LASTEXITCODE -ne 0) {
  throw "Docker build failed."
}

if ($Push) {
  docker push "${image}:${Tag}"
  if ($LASTEXITCODE -ne 0) {
    throw "Docker push failed."
  }
}

Write-Host "Built image ${image}:${Tag}"
