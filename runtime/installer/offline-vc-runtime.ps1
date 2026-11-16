param(
    [Parameter(Mandatory = $true)]
    [string]$RedistributablePath,
    [switch]$ValidateOnly
)

# Java、MySQL 和 Electron 均使用随应用携带的私有运行时；这里只补齐 MySQL 所需的 VC++ x64 v14。
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$expectedSha256 = '843068991DAAA1F73AD9F6239BCE4D0F6A07A51F18C37EA2A867E9BECA71295C'
$minimumVersion = [version]'14.29.30133'

function Get-VcRuntimeVersion {
    # 32 位 NSIS 可能调用 32 位 PowerShell，因此显式查看 64 位注册表视图。
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::LocalMachine,
        [Microsoft.Win32.RegistryView]::Registry64
    )
    try {
        foreach ($name in @(
            'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64',
            'SOFTWARE\Wow6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64'
        )) {
            $key = $base.OpenSubKey($name)
            if ($null -eq $key) { continue }
            try {
                if ($key.GetValue('Installed', 0) -ne 1) { continue }
                $versionText = [string]$key.GetValue('Version', '') -replace '^v', ''
                $version = $null
                if ([version]::TryParse($versionText, [ref]$version)) { return $version }
            } finally {
                $key.Close()
            }
        }
        return $null
    } finally {
        $base.Close()
    }
}

function Assert-Redistributable {
    if (-not (Test-Path -LiteralPath $RedistributablePath -PathType Leaf)) {
        throw '安装包内缺少 vc_redist.x64.exe。'
    }
    $item = Get-Item -LiteralPath $RedistributablePath
    if ($item.Length -lt 1MB -or $item.Length -gt 100MB) {
        throw '内置 VC++ 运行库文件大小异常。'
    }
    # 使用 Windows 自带 .NET 算法，不依赖可选的 PowerShell Utility 模块。
    $stream = [IO.File]::OpenRead($RedistributablePath)
    try {
        $sha256 = [Security.Cryptography.SHA256]::Create()
        try {
            $actualSha256 = [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '')
        } finally {
            $sha256.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
    if ($actualSha256 -ne $expectedSha256) {
        throw ('内置 VC++ 运行库 SHA-256 校验失败，实际值：' + $actualSha256)
    }
    # 显式导入 Windows PowerShell 自带模块，避免用户的 PowerShell 7 模块路径遮蔽系统模块。
    $windowsRoot = if ([string]::IsNullOrWhiteSpace($env:SystemRoot)) { 'C:\Windows' } else { $env:SystemRoot }
    $securityModule = Join-Path $windowsRoot `
        'System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
    Import-Module -Name $securityModule -Force -ErrorAction Stop
    $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $RedistributablePath
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or
        $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') {
        throw '内置 VC++ 运行库未通过 Microsoft 数字签名校验。'
    }
}

try {
    Assert-Redistributable
    if ($ValidateOnly) {
        Write-Output '内置 VC++ x64 v14 运行库文件、SHA-256 和 Microsoft 数字签名均有效。'
        exit 0
    }

    $installedVersion = Get-VcRuntimeVersion
    if ($null -ne $installedVersion -and $installedVersion -ge $minimumVersion) {
        Write-Output ('已检测到 VC++ x64 v14 运行库 ' + $installedVersion + '，无需重复安装。')
        exit 0
    }

    Write-Output '未检测到满足要求的 VC++ x64 v14 运行库，正在从离线安装包安装。'
    $process = Start-Process -FilePath $RedistributablePath -ArgumentList '/install', '/quiet', '/norestart' `
        -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -notin @(0, 1638, 1641, 3010)) {
        throw ('VC++ 运行库安装失败，退出码 ' + $process.ExitCode + '。')
    }
    $installedVersion = Get-VcRuntimeVersion
    if ($null -eq $installedVersion -or $installedVersion -lt $minimumVersion) {
        throw 'VC++ 运行库安装程序已退出，但注册表检测仍未达到最低版本要求。'
    }
    Write-Output ('VC++ x64 v14 运行库已配置完成，版本 ' + $installedVersion + '。')
    if ($process.ExitCode -in @(1641, 3010)) { exit 10 }
    exit 0
} catch {
    Write-Error ('VC++ x64 运行库离线检测或安装失败：' + $_.Exception.Message)
    exit 1
}
