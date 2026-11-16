# 安装器只补齐 MySQL 8.0 所需的 VC++ x64 v14 运行库，Java/MySQL/Electron 已随包提供。
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-VcRuntime {
    # 32 位 NSIS 可能调用 32 位 PowerShell，因此显式查看 64 位注册表视图。
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
    try {
        foreach ($name in @('SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64', 'SOFTWARE\Wow6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64')) {
            $key = $base.OpenSubKey($name)
            if ($null -eq $key) { continue }
            try {
                $installed = $key.GetValue('Installed', 0)
                $versionText = [string]$key.GetValue('Version', '') -replace '^v', ''
                $version = $null
                if ($installed -eq 1 -and [version]::TryParse($versionText, [ref]$version) -and $version -ge [version]'14.29.30133') { return $true }
            } finally { $key.Close() }
        }
        return $false
    } finally { $base.Close() }
}

if (Test-VcRuntime) {
    Write-Output 'VC++ x64 v14 运行库已安装，无需下载。'
    exit 0
}

$download = Join-Path ([IO.Path]::GetTempPath()) ('sany-vc-redist-' + [guid]::NewGuid().ToString('N') + '.exe')
try {
    # aka.ms 是微软官方维护的最新版固定入口；版本会变化，使用数字签名校验发布者。
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri 'https://aka.ms/vc14/vc_redist.x64.exe' -OutFile $download -MaximumRedirection 5 -TimeoutSec 120
    $info = Get-Item -LiteralPath $download
    if ($info.Length -lt 1MB -or $info.Length -gt 100MB) { throw '下载文件大小异常。' }
    $signature = Get-AuthenticodeSignature -LiteralPath $download
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or
        $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') {
        throw '文件未通过 Microsoft 数字签名校验。'
    }
    Write-Output '缺少 VC++ x64 v14 运行库，已验证微软签名，正在安装。'
    $process = Start-Process -FilePath $download -ArgumentList '/install', '/quiet', '/norestart' -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -notin @(0, 3010, 1638) -or -not (Test-VcRuntime)) {
        throw ('VC++ 运行库安装失败，退出码 ' + $process.ExitCode + '。')
    }
    if ($process.ExitCode -eq 3010) { exit 10 }
    exit 0
} catch {
    Write-Error ('VC++ x64 运行库自动下载或安装失败：' + $_.Exception.Message + ' 请检查网络与管理员权限。')
    exit 1
} finally {
    # 清理仅由本脚本创建的临时文件；文件被安全软件短暂占用时不覆盖安装结果。
    if (Test-Path -LiteralPath $download) {
        try { Remove-Item -LiteralPath $download -Force } catch { }
    }
}
