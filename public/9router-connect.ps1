param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("claude", "codex", "opencode", "omp")]
  [string]$Tool,

  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,

  [string]$Model = "",

  [string]$ApiKey = "",

  [string]$SmolModel = "",

  [string]$SlowModel = "",

  [string]$PlanModel = "",

  [string]$ModelRolesJson = "",
  [string]$ModelRolesBase64 = "",

  [string]$SubagentModelsJson = "",
  [string[]]$Models = @(),

  [switch]$NoPrompt
)

$ErrorActionPreference = "Stop"

function Read-SecretText {
  param([string]$Prompt)

  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Backup-ConfigFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
  $backupPath = "$Path.9router-backup-$stamp"
  Copy-Item -LiteralPath $Path -Destination $backupPath
  "Backup: $backupPath"
}

function Read-JsonObject {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return [PSCustomObject]@{}
  }

  $content = [IO.File]::ReadAllText($Path)
  if ([string]::IsNullOrWhiteSpace($content)) {
    return [PSCustomObject]@{}
  }

  try {
    $value = $content | ConvertFrom-Json
  } catch {
    throw "Cannot safely update invalid JSON in ${Path}: $($_.Exception.Message)"
  }

  if ($null -eq $value -or $value -isnot [PSCustomObject]) {
    throw "Expected a JSON object in $Path"
  }
  return $value
}

function Set-ObjectProperty {
  param($Object, [string]$Name, $Value)

  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) {
    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
  } else {
    $property.Value = $Value
  }
}

function Write-JsonObject {
  param([string]$Path, $Value)

  $directory = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  $utf8 = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($Path, (($Value | ConvertTo-Json -Depth 20) + [Environment]::NewLine), $utf8)
}

$BaseUrl = $BaseUrl.TrimEnd("/")
if (-not $BaseUrl.EndsWith("/v1")) {
  $BaseUrl = "$BaseUrl/v1"
}

$uri = [Uri]$BaseUrl
if ($uri.Scheme -notin @("http", "https")) {
  throw "The 9Router URL must start with http:// or https://"
}
if ($uri.Scheme -eq "http" -and $uri.Host -notin @("localhost", "127.0.0.1", "::1")) {
  if ($NoPrompt) {
    throw "This remote endpoint uses HTTP and may expose your API key. Configure HTTPS on the remote 9Router server."
  }
  $answer = Read-Host "This remote endpoint uses HTTP and may expose your API key. Continue? [y/N]"
  if ($answer -notmatch "^[Yy]$") {
    throw "Cancelled. Configure HTTPS on the remote 9Router server."
  }
}

if ([string]::IsNullOrWhiteSpace($ApiKey)) {
  if ($NoPrompt) {
    throw "API key cannot be empty"
  }
  $ApiKey = Read-SecretText "9Router API key"
}
if ([string]::IsNullOrWhiteSpace($ApiKey)) {
  throw "API key cannot be empty"
}
if ([string]::IsNullOrWhiteSpace($Model) -and -not $NoPrompt) {
  $Model = Read-Host "9Router model or combo ID"
}

# Mirror the dashboard Apply behavior: when no model is configured, write the
# connection without model fields instead of prompting for one.
$catalogModelIds = @()
$catalogModelsMap = @{}
if (-not [string]::IsNullOrWhiteSpace($ApiKey)) {
  try {
    $headers = @{ Authorization = "Bearer $ApiKey" }
    $catalog = Invoke-RestMethod -Uri "$BaseUrl/models" -Headers $headers -Method Get
    if ($null -ne $catalog.data) {
      foreach ($item in $catalog.data) {
        if (-not [string]::IsNullOrWhiteSpace($item.id)) {
          $catalogModelIds += $item.id
          $catalogModelsMap[$item.id] = $item
        }
      }
    }
    if (-not [string]::IsNullOrWhiteSpace($Model) -and $catalogModelIds.Count -gt 0 -and $Model -notin $catalogModelIds) {
      throw "Model '$Model' was not returned by /v1/models"
    }
  } catch {
    if (-not [string]::IsNullOrWhiteSpace($Model) -and $_.Exception.Message -match "was not returned by /v1/models") {
      throw $_.Exception.Message
    }
  }
}

$HomeDir = if (-not [string]::IsNullOrWhiteSpace($env:NINEROUTER_HOME)) { $env:NINEROUTER_HOME } else { $HOME }

if ($Tool -eq "claude") {
  $path = Join-Path $HomeDir ".claude\settings.json"
  $config = Read-JsonObject $path
  Backup-ConfigFile $path
  $envConfig = $config.PSObject.Properties["env"].Value
  if ($null -eq $envConfig) {
    $envConfig = [PSCustomObject]@{}
    Set-ObjectProperty $config "env" $envConfig
  }
  Set-ObjectProperty $envConfig "ANTHROPIC_BASE_URL" $BaseUrl
  Set-ObjectProperty $envConfig "ANTHROPIC_AUTH_TOKEN" $ApiKey
  if (-not [string]::IsNullOrWhiteSpace($Model)) {
    Set-ObjectProperty $envConfig "ANTHROPIC_DEFAULT_OPUS_MODEL" $Model
    Set-ObjectProperty $envConfig "ANTHROPIC_DEFAULT_SONNET_MODEL" $Model
    Set-ObjectProperty $envConfig "ANTHROPIC_DEFAULT_HAIKU_MODEL" $Model
  }
  Set-ObjectProperty $envConfig "API_TIMEOUT_MS" "600000"
  Set-ObjectProperty $config "hasCompletedOnboarding" $true
  Write-JsonObject $path $config
}
elseif ($Tool -eq "opencode") {
  $path = Join-Path $HomeDir ".config\opencode\opencode.json"
  $config = Read-JsonObject $path
  Backup-ConfigFile $path

  $providers = $config.PSObject.Properties["provider"].Value
  if ($null -eq $providers) {
    $providers = [PSCustomObject]@{}
    Set-ObjectProperty $config "provider" $providers
  }
  $provider = $providers.PSObject.Properties["9router"].Value
  if ($null -eq $provider) {
    $provider = [PSCustomObject]@{}
    Set-ObjectProperty $providers "9router" $provider
  }
  Set-ObjectProperty $provider "npm" "@ai-sdk/openai-compatible"

  $options = $provider.PSObject.Properties["options"].Value
  if ($null -eq $options) { $options = [PSCustomObject]@{} }
  Set-ObjectProperty $options "baseURL" $BaseUrl
  Set-ObjectProperty $options "apiKey" $ApiKey
  Set-ObjectProperty $provider "options" $options

  if (-not [string]::IsNullOrWhiteSpace($Model)) {
    $models = $provider.PSObject.Properties["models"].Value
    if ($null -eq $models) { $models = [PSCustomObject]@{} }
    $modelConfig = [PSCustomObject]@{
      name = $Model
      modalities = [PSCustomObject]@{ input = @("text", "image"); output = @("text") }
    }
    Set-ObjectProperty $models $Model $modelConfig
    Set-ObjectProperty $provider "models" $models
    Set-ObjectProperty $config "model" "9router/$Model"
  }
  Write-JsonObject $path $config
}
elseif ($Tool -eq "omp") {
  $directory = Join-Path $HomeDir ".omp\agent"
  $modelsPath = Join-Path $directory "models.yml"
  $configPath = Join-Path $directory "config.yml"
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  Backup-ConfigFile $modelsPath
  Backup-ConfigFile $configPath

  $defaultModel = if (-not [string]::IsNullOrWhiteSpace($Model)) { $Model.Trim() } else { "claude-sonnet-4-6" }
  $parsedRoles = $null
  if (-not [string]::IsNullOrWhiteSpace($ModelRolesBase64)) {
    try {
      $bytes = [Convert]::FromBase64String($ModelRolesBase64.Trim())
      $ModelRolesJson = [System.Text.Encoding]::UTF8.GetString($bytes)
    } catch {}
  }
  if (-not [string]::IsNullOrWhiteSpace($ModelRolesJson)) {
    try {
      $parsedRoles = $ModelRolesJson | ConvertFrom-Json
    } catch {}
  }
  if ($null -ne $parsedRoles) {
    foreach ($prop in $parsedRoles.PSObject.Properties) {
      if ($prop.Name.Trim() -eq "default" -and -not [string]::IsNullOrWhiteSpace($prop.Value)) {
        $cleanDef = [string]($prop.Value) -replace "^9router/", ""
        if (-not [string]::IsNullOrWhiteSpace($cleanDef)) {
          $defaultModel = $cleanDef.Trim()
        }
      }
    }
  }
  $allModelIds = New-Object System.Collections.Generic.List[string]
  $allModelIds.Add($defaultModel)

  if ($null -ne $parsedRoles) {
    foreach ($prop in $parsedRoles.PSObject.Properties) {
      if (-not [string]::IsNullOrWhiteSpace($prop.Value)) {
        $cleanRoleVal = [string]($prop.Value) -replace "^9router/", ""
        if (-not [string]::IsNullOrWhiteSpace($cleanRoleVal)) {
          $allModelIds.Add($cleanRoleVal.Trim())
        }
      }
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($SmolModel) -and $SmolModel.Trim()) {
    $allModelIds.Add($SmolModel.Trim())
  }
  if (-not [string]::IsNullOrWhiteSpace($SlowModel) -and $SlowModel.Trim()) {
    $allModelIds.Add($SlowModel.Trim())
  }
  if (-not [string]::IsNullOrWhiteSpace($PlanModel) -and $PlanModel.Trim()) {
    $allModelIds.Add($PlanModel.Trim())
  }
  if ($null -ne $Models -and $Models.Count -gt 0) {
    foreach ($m in $Models) {
      if (-not [string]::IsNullOrWhiteSpace($m)) {
        $allModelIds.Add($m.Trim())
      }
    }
  }

  # NOTE: catalog models are fetched above only for capability metadata
  # (context window / max tokens / vision / reasoning). They are NOT added
  # to models.yml — only models the user explicitly configured are written.

  $uniqueModelIds = New-Object System.Collections.Generic.List[string]
  foreach ($mid in $allModelIds) {
    if (-not $uniqueModelIds.Contains($mid)) {
      $uniqueModelIds.Add($mid)
    }
  }

  $escapedUrl = $BaseUrl.Replace("\", "\\").Replace('"', '\"')
  $escapedKey = $ApiKey.Replace("\", "\\").Replace('"', '\"')

  $modelEntries = New-Object System.Collections.Generic.List[string]
  foreach ($mid in $uniqueModelIds) {
    $escMid = $mid.Replace("\", "\\").Replace('"', '\"')
    $catModel = $catalogModelsMap[$mid]
    $ctx = 200000
    $maxTokens = 8192
    $reasoning = $true
    $hasVision = $true

    if ($null -ne $catModel) {
      if ($null -ne $catModel.context_length -and [int]$catModel.context_length -gt 0) {
        $ctx = [int]$catModel.context_length
      } elseif ($null -ne $catModel.capabilities -and $null -ne $catModel.capabilities.contextWindow -and [int]$catModel.capabilities.contextWindow -gt 0) {
        $ctx = [int]$catModel.capabilities.contextWindow
      }
      if ($null -ne $catModel.max_completion_tokens -and [int]$catModel.max_completion_tokens -gt 0) {
        $maxTokens = [Math]::Min([int]$catModel.max_completion_tokens, 32768)
      } elseif ($null -ne $catModel.capabilities -and $null -ne $catModel.capabilities.maxOutput -and [int]$catModel.capabilities.maxOutput -gt 0) {
        $maxTokens = [Math]::Min([int]$catModel.capabilities.maxOutput, 32768)
      }
      if ($null -ne $catModel.capabilities -and $null -ne $catModel.capabilities.reasoning) {
        $reasoning = [bool]$catModel.capabilities.reasoning
      }
      if ($null -ne $catModel.capabilities -and $null -ne $catModel.capabilities.vision) {
        $hasVision = [bool]$catModel.capabilities.vision
      }
    }

    $inputBlock = if ($hasVision) {
      "        input:`r`n          - `"text`"`r`n          - `"image`""
    } else {
      "        input:`r`n          - `"text`""
    }

    $reasoningStr = if ($reasoning) { "true" } else { "false" }

    $modelEntries.Add(@"
      - id: "$escMid"
        name: "$escMid"
        contextWindow: $ctx
        maxTokens: $maxTokens
        reasoning: $reasoningStr
$inputBlock
"@)
  }
  $modelsYamlString = $modelEntries -join "`r`n"

  $nineRouterBlock = @"
  9router:
    baseUrl: "$escapedUrl"
    apiKey: "$escapedKey"
    api: "openai-completions"
    models:
$modelsYamlString
"@

  $escDefault = $defaultModel.Replace("\", "\\").Replace('"', '\"')
  $escSmol = if (-not [string]::IsNullOrWhiteSpace($SmolModel)) { $SmolModel.Trim().Replace("\", "\\").Replace('"', '\"') } else { $escDefault }
  $escSlow = if (-not [string]::IsNullOrWhiteSpace($SlowModel)) { $SlowModel.Trim().Replace("\", "\\").Replace('"', '\"') } else { $escDefault }
  $escPlan = if (-not [string]::IsNullOrWhiteSpace($PlanModel)) { $PlanModel.Trim().Replace("\", "\\").Replace('"', '\"') } else { "" }
  $roleLines = New-Object System.Collections.Generic.List[string]
  $roleLines.Add("modelRoles:")
  if ($null -ne $parsedRoles) {
    foreach ($prop in $parsedRoles.PSObject.Properties) {
      if (-not [string]::IsNullOrWhiteSpace($prop.Value)) {
        $rName = $prop.Name.Trim()
        $rVal = [string]($prop.Value) -replace "^9router/", ""
        $escVal = $rVal.Trim().Replace("\", "\\").Replace('"', '\"')
        $roleLines.Add("  ${rName}: `"9router/$escVal`"")
      }
    }
  } else {
    $roleLines.Add("  default: `"9router/$escDefault`"")
    $roleLines.Add("  smol: `"9router/$escSmol`"")
    $roleLines.Add("  slow: `"9router/$escSlow`"")
    if (-not [string]::IsNullOrWhiteSpace($escPlan)) {
      $roleLines.Add("  plan: `"9router/$escPlan`"")
    }
  }
  $rolesBlock = $roleLines -join "`r`n"

  $subagentLines = New-Object System.Collections.Generic.List[string]
  if ($null -ne $subagents) {
    foreach ($prop in $subagents.PSObject.Properties) {
      if (-not [string]::IsNullOrWhiteSpace($prop.Value)) {
        $agentName = $prop.Name.Trim()
        $agentVal = [string]($prop.Value)
        $agentVal = $agentVal -replace "^9router/", ""
        $escAgentVal = $agentVal.Trim().Replace("\", "\\").Replace('"', '\"')
        $subagentLines.Add("  ${agentName}: `"9router/$escAgentVal`"")
      }
    }
  }

  $subagentsBlock = ""
  if ($subagentLines.Count -gt 0) {
    $subagentsBlock = "task.agentModelOverrides:`r`n" + ($subagentLines -join "`r`n")
  }

  $modelsContent = if (Test-Path -LiteralPath $modelsPath) { [IO.File]::ReadAllText($modelsPath) } else { "" }
  $trimmedModels = $modelsContent.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmedModels) -or $trimmedModels -eq "{}" -or $trimmedModels -eq "null" -or $trimmedModels -eq "providers:" -or $trimmedModels -eq "providers: {}") {
    $newModelsContent = "providers:`r`n$nineRouterBlock`r`n"
  } else {
    $cleanedModels = [Regex]::Replace($modelsContent, "(?m)^\s*\{\}\s*$", "")
    $cleanedModels = [Regex]::Replace($cleanedModels, "(?ms)^\s\s9router:\s*.*?(?=^\s\s[a-zA-Z0-9_-]+:|^[a-zA-Z0-9_-]+:|\z)", "")
    if ($cleanedModels -match "(?m)^providers:\s*$") {
      $newModelsContent = [Regex]::Replace($cleanedModels, "(?m)^providers:\s*$", "providers:`r`n$nineRouterBlock", 1).Trim() + "`r`n"
    } else {
      $newModelsContent = "providers:`r`n$nineRouterBlock`r`n"
    }
  }

  $configContent = if (Test-Path -LiteralPath $configPath) { [IO.File]::ReadAllText($configPath) } else { "" }
  $trimmedCfg = $configContent.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmedCfg) -or $trimmedCfg -eq "{}" -or $trimmedCfg -eq "null") {
    $blocks = New-Object System.Collections.Generic.List[string]
    $blocks.Add($rolesBlock)
    if ($subagentsBlock) {
      $blocks.Add($subagentsBlock)
    }
    $newConfigContent = ($blocks -join "`r`n`r`n") + "`r`n"
  } else {
    $cleanedCfg = [Regex]::Replace($configContent, "(?m)^\s*\{\}\s*$", "")
    $cleanedCfg = [Regex]::Replace($cleanedCfg, "(?ms)^modelRoles:\s*.*?(?=^[a-zA-Z0-9_.-]+:|\z)", "").Trim()
    $cleanedCfg = [Regex]::Replace($cleanedCfg, "(?ms)^task\.agentModelOverrides:\s*.*?(?=^[a-zA-Z0-9_.-]+:|\z)", "").Trim()
    $blocks = New-Object System.Collections.Generic.List[string]
    $blocks.Add($rolesBlock)
    if ($subagentsBlock) {
      $blocks.Add($subagentsBlock)
    }
    if (-not [string]::IsNullOrWhiteSpace($cleanedCfg)) {
      $blocks.Add($cleanedCfg)
    }
    $newConfigContent = ($blocks -join "`r`n`r`n") + "`r`n"
  }

  $utf8 = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($modelsPath, $newModelsContent.TrimEnd() + [Environment]::NewLine, $utf8)
  [IO.File]::WriteAllText($configPath, $newConfigContent.TrimEnd() + [Environment]::NewLine, $utf8)
  $path = $modelsPath
}
else {
  $directory = Join-Path $HomeDir ".codex"
  $configPath = Join-Path $directory "config.toml"
  $authPath = Join-Path $directory "auth.json"
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  Backup-ConfigFile $configPath
  Backup-ConfigFile $authPath

  $content = if (Test-Path -LiteralPath $configPath) { [IO.File]::ReadAllText($configPath) } else { "" }
  $content = [Regex]::Replace($content, "(?m)^\s*(model|model_provider)\s*=.*(?:\r?\n)?", "")
  $content = [Regex]::Replace($content, "(?ms)^\s*\[(model_providers\.9router|agents\.subagent)\]\s*.*?(?=^\s*\[|\z)", "")
  $hasModel = -not [string]::IsNullOrWhiteSpace($Model)
  $escapedModel = if ($hasModel) { $Model.Replace("\", "\\").Replace('"', '\"') } else { "" }
  $escapedUrl = $BaseUrl.Replace("\", "\\").Replace('"', '\"')
  $parts = New-Object System.Collections.ArrayList
  if ($hasModel) {
    [void]$parts.Add("model = `"$escapedModel`"")
    [void]$parts.Add("model_provider = `"9router`"")
    [void]$parts.Add("")
  }
  if (-not [string]::IsNullOrWhiteSpace($content)) {
    [void]$parts.Add($content.Trim())
  }
  [void]$parts.Add("")
  [void]$parts.Add("[model_providers.9router]")
  [void]$parts.Add("name = `"9Router`"")
  [void]$parts.Add("base_url = `"$escapedUrl`"")
  [void]$parts.Add("wire_api = `"responses`"")
  if ($hasModel) {
    [void]$parts.Add("")
    [void]$parts.Add("[agents.subagent]")
    [void]$parts.Add("model = `"$escapedModel`"")
  }
  $utf8 = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($configPath, ($parts -join [Environment]::NewLine) + [Environment]::NewLine, $utf8)

  $auth = Read-JsonObject $authPath
  Set-ObjectProperty $auth "OPENAI_API_KEY" $ApiKey
  Set-ObjectProperty $auth "auth_mode" "apikey"
  Write-JsonObject $authPath $auth
  $path = $configPath
}
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "             9Router Configuration Summary" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Tool:            " -NoNewline; Write-Host $Tool -ForegroundColor Yellow
Write-Host "Endpoint:        " -NoNewline; Write-Host $BaseUrl -ForegroundColor Green
Write-Host "Config Path:     " -NoNewline; Write-Host $path -ForegroundColor Gray
if ($Tool -eq "omp") {
  Write-Host "Config Roles:    " -NoNewline; Write-Host $configPath -ForegroundColor Gray
  Write-Host ""
  if ($null -ne $parsedRoles) {
    foreach ($prop in $parsedRoles.PSObject.Properties) {
      if (-not [string]::IsNullOrWhiteSpace($prop.Value)) {
        $rName = $prop.Name.Trim()
        $rVal = [string]($prop.Value) -replace "^9router/", ""
        Write-Host "  $($rName.PadRight(16)): " -NoNewline; Write-Host $rVal -ForegroundColor White
      }
    }
  } else {
    Write-Host "  Primary/Default: " -NoNewline; Write-Host $defaultModel -ForegroundColor White
    if (-not [string]::IsNullOrWhiteSpace($SmolModel)) {
      Write-Host "  Smol (Fast):     " -NoNewline; Write-Host $SmolModel -ForegroundColor White
    }
    if (-not [string]::IsNullOrWhiteSpace($SlowModel)) {
      Write-Host "  Slow (Reasoning):" -NoNewline; Write-Host $SlowModel -ForegroundColor White
    }
    if (-not [string]::IsNullOrWhiteSpace($PlanModel)) {
      Write-Host "  Plan:            " -NoNewline; Write-Host $PlanModel -ForegroundColor White
    }
  }
  if ($null -ne $subagents) {
    Write-Host ""
    Write-Host "--- Subagent Overrides ---" -ForegroundColor Cyan
    foreach ($prop in $subagents.PSObject.Properties) {
      if (-not [string]::IsNullOrWhiteSpace($prop.Value)) {
        $agentName = $prop.Name.Trim()
        $agentVal = [string]($prop.Value)
        Write-Host "  $($agentName.PadRight(16)): " -NoNewline; Write-Host $agentVal -ForegroundColor White
      }
    }
  }
  if ($uniqueModelIds.Count -gt 0) {
    Write-Host ""
    Write-Host "--- Configured Models ($($uniqueModelIds.Count)) ---" -ForegroundColor Cyan
    foreach ($mid in $uniqueModelIds) {
      $catModel = $catalogModelsMap[$mid]
      $ctx = 200000
      $maxTokens = 8192
      if ($null -ne $catModel) {
        if ($null -ne $catModel.context_length -and [int]$catModel.context_length -gt 0) {
          $ctx = [int]$catModel.context_length
        } elseif ($null -ne $catModel.capabilities -and $null -ne $catModel.capabilities.contextWindow -and [int]$catModel.capabilities.contextWindow -gt 0) {
          $ctx = [int]$catModel.capabilities.contextWindow
        }
        if ($null -ne $catModel.max_completion_tokens -and [int]$catModel.max_completion_tokens -gt 0) {
          $maxTokens = [Math]::Min([int]$catModel.max_completion_tokens, 32768)
        } elseif ($null -ne $catModel.capabilities -and $null -ne $catModel.capabilities.maxOutput -and [int]$catModel.capabilities.maxOutput -gt 0) {
          $maxTokens = [Math]::Min([int]$catModel.capabilities.maxOutput, 32768)
        }
      }
      $ctxK = [Math]::Round($ctx / 1000)
      $isPrimary = if ($mid -eq $defaultModel) { " (primary)" } else { "" }
      Write-Host "  * " -NoNewline -ForegroundColor DarkGray
      Write-Host "$mid" -NoNewline -ForegroundColor White
      Write-Host "$isPrimary" -NoNewline -ForegroundColor Yellow
      Write-Host " [${ctxK}k ctx, ${maxTokens} max out]" -ForegroundColor DarkCyan
    }
  }
} elseif ($Tool -eq "claude") {
  Write-Host ""
  Write-Host "--- Claude Code Configuration ---" -ForegroundColor Cyan
  if (-not [string]::IsNullOrWhiteSpace($Model)) {
    Write-Host "  Default Model:   " -NoNewline; Write-Host $Model -ForegroundColor White
    Write-Host "  Mapped Roles:    " -NoNewline; Write-Host "Opus, Sonnet, Haiku -> $Model" -ForegroundColor Gray
  } else {
    Write-Host "  Model Routing:   " -NoNewline; Write-Host "Using Claude default model tier" -ForegroundColor Gray
  }
  Write-Host "  Timeout:         " -NoNewline; Write-Host "600,000 ms (10 min)" -ForegroundColor Gray
} elseif ($Tool -eq "opencode") {
  Write-Host ""
  Write-Host "--- OpenCode Configuration ---" -ForegroundColor Cyan
  if (-not [string]::IsNullOrWhiteSpace($Model)) {
    Write-Host "  Active Model:    " -NoNewline; Write-Host "9router/$Model" -ForegroundColor White
  }
  if ($null -ne $Models -and $Models.Count -gt 0) {
    Write-Host "  Registered:      " -NoNewline; Write-Host ($Models -join ", ") -ForegroundColor Gray
  }
} elseif ($Tool -eq "codex") {
  Write-Host ""
  Write-Host "--- Codex Configuration ---" -ForegroundColor Cyan
  Write-Host "  Auth Path:       " -NoNewline; Write-Host $authPath -ForegroundColor Gray
  if (-not [string]::IsNullOrWhiteSpace($Model)) {
    Write-Host "  Primary Model:   " -NoNewline; Write-Host $Model -ForegroundColor White
    Write-Host "  Subagent Model:  " -NoNewline; Write-Host $Model -ForegroundColor White
  }
  Write-Host "  Wire API:        " -NoNewline; Write-Host "responses" -ForegroundColor Gray
}
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Status: Successfully configured!" -ForegroundColor Green
Write-Host ""
