# Folia Sync Server installer for Windows PowerShell / PowerShell 7.

$ErrorActionPreference = 'Stop'

function Write-Section {
    param([string]$Text)
    Write-Host $Text -ForegroundColor Cyan
}

function Write-Step {
    param([string]$Text)
    Write-Host "[*] $Text" -ForegroundColor Cyan
}

function Write-WarnLine {
    param([string]$Text)
    Write-Host "[!] $Text" -ForegroundColor Yellow
}

function Write-ErrorLine {
    param([string]$Text)
    Write-Host "[!] $Text" -ForegroundColor Red
}

function Write-SuccessLine {
    param([string]$Text)
    Write-Host $Text -ForegroundColor Green
}

function Write-SyncTokenReminder {
    param([string]$Token)
    if (-not [string]::IsNullOrWhiteSpace($Token)) {
        Write-Section "=========================================="
        Write-WarnLine "请注意：Folia 客户端连接密码 (SYNC_TOKEN) 为："
        Write-SuccessLine "[!] $Token"
        Write-ErrorLine "这是你在 Folia 客户端中连接同步服务端所需的密码。"
        Write-ErrorLine "由于安全原因，这是最后一次在此显示，请务必妥善保存！"
        Write-Section "=========================================="
    }
}

function Test-CommandExists {
    param([string]$CommandName)
    return [bool](Get-Command $CommandName -ErrorAction SilentlyContinue)
}

function Invoke-Tool {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [string[]]$ArgumentList = @()
    )

    $command = @($FilePath) + $ArgumentList
    Write-Step ("执行: " + ($command -join ' '))
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "命令执行失败: $($command -join ' ')"
    }
}

function Get-RandomHex {
    param([int]$ByteCount = 16)

    if (Test-CommandExists 'node') {
        $randomValue = & node -e "console.log(require('crypto').randomBytes($ByteCount).toString('hex'))"
        if ($LASTEXITCODE -eq 0 -and $randomValue) {
            return ($randomValue | Select-Object -First 1).Trim()
        }
    }

    $bytes = New-Object byte[] $ByteCount
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Ensure-NodeAndNpm {
    if (-not (Test-CommandExists 'node')) {
        throw "未检测到 Node.js，请先安装 Node.js 18+ 后重试。"
    }
    if (-not (Test-CommandExists 'npm')) {
        throw "未检测到 npm，请先安装 npm 后重试。"
    }
}

function Ensure-EnvFile {
    $envPath = Join-Path $PSScriptRoot '.env'
    if (Test-Path $envPath) {
        Write-WarnLine ".env 文件已存在，跳过创建。"
        return $null
    }

    Write-Section "=========================================="
    $syncToken = Read-Host "请输入用于客户端鉴权的 SYNC_TOKEN (建议>=8位)"
    if ([string]::IsNullOrWhiteSpace($syncToken)) {
        throw "SYNC_TOKEN 不能为空。"
    }

    $dashboardToken = Get-RandomHex
    @(
        "SYNC_TOKEN=$syncToken"
        "DASHBOARD_TOKEN=$dashboardToken"
        "PORT=3000"
        "DB_PATH=./folia-sync.db"
    ) | Set-Content -Path $envPath -Encoding UTF8

    Write-SuccessLine "[*] .env 文件创建成功。"
    Write-Section "=========================================="
    Write-WarnLine "系统已为你自动生成网页看板 DASHBOARD_TOKEN："
    Write-SuccessLine "[!] $dashboardToken"
    Write-ErrorLine "请务必妥善保存该 Token，你将需要它来访问网页看板。"
    Write-Section "=========================================="
    return $dashboardToken
}

function Ensure-Pm2 {
    if (Test-CommandExists 'pm2') {
        return
    }

    Write-Step "正在全局安装 PM2..."
    & npm install -g pm2
    if ($LASTEXITCODE -ne 0) {
        throw "PM2 安装失败，请以管理员身份重试，或手动执行 npm install -g pm2。"
    }
}

function Get-D1DatabaseId {
    # Create-first strategy matches the bash installer, then falls back to list for existing DBs.
    Write-Step "正在检查或创建 D1 数据库 'folia-sync' (可能要求跳转浏览器登录)..."
    $d1Output = (& npx wrangler d1 create folia-sync -c wrangler.toml 2>&1 | Out-String).Trim()
    if ($d1Output) {
        Write-Host $d1Output
    }

    if ($d1Output -match 'already exists') {
        Write-WarnLine "数据库 'folia-sync' 已存在。正在获取它的 ID..."
        $databaseListJson = & npx wrangler d1 list --json 2>$null
        if ($LASTEXITCODE -eq 0 -and $databaseListJson) {
            $databaseList = $databaseListJson | ConvertFrom-Json
            $match = $databaseList | Where-Object { $_.name -eq 'folia-sync' } | Select-Object -First 1
            if ($match -and $match.uuid) {
                return $match.uuid
            }
        }
    }

    $uuidMatch = [regex]::Match($d1Output, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')
    if ($uuidMatch.Success) {
        return $uuidMatch.Value
    }

    $manualId = Read-Host "无法自动提取 D1 database_id，请手动粘贴"
    if ([string]::IsNullOrWhiteSpace($manualId)) {
        throw "database_id 不能为空。"
    }
    return $manualId.Trim()
}

function New-WranglerLocalConfig {
    param([Parameter(Mandatory = $true)][string]$DatabaseId)

    $templatePath = Join-Path $PSScriptRoot 'wrangler.toml'
    $localPath = Join-Path $PSScriptRoot 'wrangler.local.toml'
    $template = Get-Content -Path $templatePath -Raw
    $template.Replace('replace-with-your-d1-database-id', $DatabaseId) | Set-Content -Path $localPath -Encoding UTF8
    return $localPath
}

function Set-CloudflareSecret {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$ConfigPath
    )

    $Value | & npx wrangler secret put $Name --config $ConfigPath
    if ($LASTEXITCODE -ne 0) {
        throw "注入 Secret 失败: $Name"
    }
}

function Deploy-NodeWithPm2 {
    Write-Step "开始进行 Node (PM2) 部署..."
    Ensure-NodeAndNpm
    Ensure-Pm2

    Invoke-Tool -FilePath 'npm' -ArgumentList @('install')
    Invoke-Tool -FilePath 'npm' -ArgumentList @('run', 'build:node')
    Ensure-EnvFile | Out-Null

    Write-Step "正在使用 PM2 启动服务..."
    & pm2 delete folia-sync-server 2>$null
    & pm2 start dist/node.js --name folia-sync-server
    if ($LASTEXITCODE -ne 0) {
        throw "PM2 启动失败。"
    }

    Write-Step "正在配置 PM2 日志轮转..."
    & pm2 install pm2-logrotate
    & pm2 set pm2-logrotate:max_size 10M
    & pm2 set pm2-logrotate:retain 3

    Write-Step "正在保存 PM2 进程列表..."
    & pm2 save
    if ($LASTEXITCODE -ne 0) {
        throw "PM2 保存进程列表失败。"
    }

    Write-SuccessLine "=========================================="
    Write-SuccessLine "    部署完成！"
    Write-SuccessLine "=========================================="
    Write-Section "你的同步服务端已在 3000 端口运行。"
    Write-Host "使用此命令查看日志： pm2 logs folia-sync-server"
    Write-Host "若要设置开机自启，请运行： pm2 startup"

    $envPath = Join-Path $PSScriptRoot '.env'
    $loadedSyncToken = ""
    if (Test-Path $envPath) {
        $envContent = Get-Content -Path $envPath
        foreach ($line in $envContent) {
            if ($line -match '^SYNC_TOKEN=(.*)$') {
                $loadedSyncToken = $matches[1]
                break
            }
        }
    }
    Write-SyncTokenReminder -Token $loadedSyncToken
}

function Deploy-Docker {
    Write-Step "开始进行 Docker 部署..."
    if (-not (Test-CommandExists 'docker')) {
        throw "未检测到 Docker 环境，请先手动安装 Docker Desktop。"
    }

    Ensure-EnvFile | Out-Null

    Write-Step "正在构建并启动 Docker 容器..."
    & docker compose version 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) {
        Invoke-Tool -FilePath 'docker' -ArgumentList @('compose', 'up', '-d', '--build')
    }
    elseif (Test-CommandExists 'docker-compose') {
        Invoke-Tool -FilePath 'docker-compose' -ArgumentList @('up', '-d', '--build')
    }
    else {
        throw "未检测到 docker compose 或 docker-compose。"
    }

    Write-SuccessLine "=========================================="
    Write-SuccessLine "    部署完成！"
    Write-SuccessLine "=========================================="
    Write-Section "你的同步服务端已映射到本地 13000 端口（容器内 3000）。"
    Write-Host "使用此命令查看日志： docker logs -f folia-sync"

    $envPath = Join-Path $PSScriptRoot '.env'
    $loadedSyncToken = ""
    if (Test-Path $envPath) {
        $envContent = Get-Content -Path $envPath
        foreach ($line in $envContent) {
            if ($line -match '^SYNC_TOKEN=(.*)$') {
                $loadedSyncToken = $matches[1]
                break
            }
        }
    }
    Write-SyncTokenReminder -Token $loadedSyncToken
}

function Deploy-CloudflareWorkers {
    Write-Step "开始进行 Cloudflare Workers 部署..."
    Ensure-NodeAndNpm

    Invoke-Tool -FilePath 'npm' -ArgumentList @('install')

    $databaseId = Get-D1DatabaseId

    Write-Step "正在生成 wrangler.local.toml..."
    $configPath = New-WranglerLocalConfig -DatabaseId $databaseId

    Write-Section "=========================================="
    $syncToken = Read-Host "请输入用于客户端鉴权的 SYNC_TOKEN (至少8位)"
    if ([string]::IsNullOrWhiteSpace($syncToken)) {
        throw "SYNC_TOKEN 不能为空。"
    }

    Write-Step "正在将 SYNC_TOKEN 注入 Cloudflare 环境变量..."
    Set-CloudflareSecret -Name 'SYNC_TOKEN' -Value $syncToken.Trim() -ConfigPath $configPath

    Write-Step "正在自动生成并注入 DASHBOARD_TOKEN..."
    $dashboardToken = Get-RandomHex
    Set-CloudflareSecret -Name 'DASHBOARD_TOKEN' -Value $dashboardToken -ConfigPath $configPath

    Write-Step "正在向 Cloudflare 边缘网络部署代码..."
    Invoke-Tool -FilePath 'npm' -ArgumentList @('run', 'deploy:cf', '--', '--config', $configPath)

    Write-SuccessLine "=========================================="
    Write-SuccessLine "    部署完成！"
    Write-SuccessLine "=========================================="
    Write-Section "你的服务已成功部署至 Cloudflare Workers。"
    Write-Section "=========================================="
    Write-WarnLine "系统已为你自动生成网页看板 DASHBOARD_TOKEN："
    Write-SuccessLine "[!] $dashboardToken"
    Write-ErrorLine "请务必妥善保存该 Token，你将需要它来访问网页看板。"
    Write-Section "访问链接格式: https://<你的Worker域名>/?token=$dashboardToken"

    Write-SyncTokenReminder -Token $syncToken
}

Write-Section "=========================================="
Write-Section "       Folia 同步服务端安装向导"
Write-Section "=========================================="
Write-Host ''
Write-Host '请选择部署方式：'
Write-Host '  1) Node (PM2)' -ForegroundColor Yellow
Write-Host '  2) Docker' -ForegroundColor Yellow
Write-Host '  3) Cloudflare Workers' -ForegroundColor Yellow
$deployChoice = Read-Host '请输入选项 [1-3]'
Write-Host ''

switch ($deployChoice) {
    '1' { Deploy-NodeWithPm2 }
    '2' { Deploy-Docker }
    '3' { Deploy-CloudflareWorkers }
    default { throw '无效的选择。退出脚本。' }
}
