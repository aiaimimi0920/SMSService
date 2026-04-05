param(
  [string]$SourcePath = "C:\Users\Public\nas_home\AI\GameEditor\SMSService\others\tampermonkey\easy_sms_proxy.user.js",
  [string]$SecretsPath = "C:\Users\Public\nas_home\AI\GameEditor\SMSService\others\tampermonkey\easy_sms_proxy.secrets.local.json",
  [string]$OutputPath = "C:\Users\Public\nas_home\AI\GameEditor\SMSService\others\tampermonkey\easy_sms_proxy.local.user.js",
  [switch]$CopyToClipboard
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $SourcePath)) {
  throw "Source userscript not found: $SourcePath"
}

$source = Get-Content -Raw -LiteralPath $SourcePath
$overrides = $null

if (Test-Path -LiteralPath $SecretsPath) {
  $overrides = Get-Content -Raw -LiteralPath $SecretsPath | ConvertFrom-Json
}

if ($overrides -ne $null) {
  foreach ($property in $overrides.PSObject.Properties) {
    if ($property.Name -eq "_notes") {
      continue
    }

    $name = [string]$property.Name
    $value = [string]$property.Value
    $escapedValue = $value.Replace('\', '\\').Replace('"', '\"')
    $pattern = "($([regex]::Escape($name))\s*:\s*)"".*?"""
    $replacement = '$1"' + $escapedValue + '"'
    $source = [regex]::Replace($source, $pattern, $replacement)
  }
}

$banner = @(
  "// LOCAL DEV BUILD",
  "// Generated from easy_sms_proxy.user.js + easy_sms_proxy.secrets.local.json (optional overrides)",
  "// Do not commit this file."
) -join "`r`n"

$output = $banner + "`r`n" + $source
Set-Content -LiteralPath $OutputPath -Value $output -Encoding UTF8

if ($CopyToClipboard) {
  Set-Clipboard -Value $output
  Write-Host "Generated and copied to clipboard: $OutputPath"
}
else {
  Write-Host "Generated local userscript: $OutputPath"
}
