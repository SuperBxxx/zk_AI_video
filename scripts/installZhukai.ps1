# 旁路安装脚本（纯 PowerShell 版）
#
# 为什么有这个脚本：本机 NSIS 安装包无法运行 —— 引导层要把自身解压到 TEMP 再从那里
# 启动子进程，这一步在本机被挡住，报 "Error writing temporary file"。该错误连
# 37 KB 的最小 NSIS 包也会出现，与安装包内容无关。
#
# 本脚本用 PowerShell 等价复现安装程序做的事，不依赖 NSIS 引导层。
#
# 复刻依据 apps/desktop/installer/installer.nsi 与 initializeInstall.ts：
#   1. 建立安装目录
#   2. 解压 app tar 到 安装目录\app
#   3. 写 zhukai.ini
#   4. 运行应用自带 initializeInstall.js
#   5. 写注册表（卸载信息 + zhukai:// 协议）
#   6. 建桌面与开始菜单快捷方式
#
# 与安装包的差异：不含 WebView2 检测/安装（本机已装 154.0.4258.53）；
# 不生成 NSIS 卸载器，改用应用自带 uninstall.exe。

$ErrorActionPreference = 'Stop'

$projectDir = 'E:\ai_video\zk-video'
$tarZst     = Join-Path $projectDir 'build\desktop\artifacts\stable-win-x64-zhukai.tar.zst'
$bundledInit = Join-Path $projectDir 'build\desktop\nsis\initializeInstall.js'
$plainTar   = Join-Path $projectDir '.tmp-build\app-install.tar'

$identifier = 'local.zhukai.desktop'
$appName    = '住凯AI视频'
$version    = '2.0.0'

$installDir = Join-Path $env:LOCALAPPDATA "$identifier\stable"
$appDir     = Join-Path $installDir 'app'
$desktopDir = [Environment]::GetFolderPath('Desktop')
$programsDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'

Write-Host "安装目录: $installDir"

# --- 1. 建立目录 ---
Write-Host "`n[1] 建立安装目录"
if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force }
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
Write-Host "  $installDir"

# --- 2. 解压 ---
Write-Host "`n[2] 解压应用压缩包"
$bunExe = 'E:\ai_video\bun-runtime\bun-windows-x64\bun.exe'
if (-not (Test-Path $bunExe)) {
  $bunExe = (Get-Command bun -ErrorAction SilentlyContinue).Source
}
if (-not $bunExe) { throw '找不到 bun.exe，无法解 zstd。请确认 E:\ai_video\bun-runtime 存在。' }

$zstSize = [math]::Round((Get-Item $tarZst).Length / 1MB, 1)
$zstdScript = 'const fs=require("fs");fs.writeFileSync(process.argv[1],Bun.zstdDecompressSync(fs.readFileSync(process.argv[2])))'
& $bunExe -e $zstdScript $plainTar $tarZst
if ($LASTEXITCODE -ne 0) { throw "zstd 解压失败($LASTEXITCODE)" }
Write-Host "  zstd → tar: $zstSize MB → $([math]::Round((Get-Item $plainTar).Length/1MB,1)) MB"

# 系统 tar.exe 不支持 zstd，但支持纯 tar
$tarExe = Join-Path $env:WINDIR 'System32\tar.exe'
& $tarExe -xf $plainTar -C $appDir --strip-components=1
if ($LASTEXITCODE -ne 0) { throw "tar 解压失败($LASTEXITCODE)" }
Remove-Item $plainTar -Force -ErrorAction SilentlyContinue
Write-Host "  已解压到 $appDir"

# --- 3. zhukai.ini ---
Write-Host "`n[3] 写入安装标识"
$ini = "[application]`r`nidentifier=$identifier`r`ninstallDirectory=$installDir`r`n"
[System.IO.File]::WriteAllText((Join-Path $installDir 'zhukai.ini'), $ini, [System.Text.Encoding]::GetEncoding(28591))
Write-Host "  zhukai.ini"

# --- 4. 校验 ---
Write-Host "`n[4] 校验关键文件"
$required = @(
  @{ p = 'bin\launcher.exe';                          label = '启动器' },
  @{ p = 'bin\bun.exe';                               label = '运行时' },
  @{ p = 'Resources\version.json';                    label = '版本信息' },
  @{ p = 'Resources\uninstall';                       label = '卸载助手' },
  @{ p = 'Resources\app\views\mainview\index.html';   label = '界面入口' }
)
$missing = 0
foreach ($r in $required) {
  $full = Join-Path $appDir $r.p
  $ok = Test-Path $full
  if (-not $ok) { $missing++ }
  $mark = if ($ok) { 'OK' } else { 'MISSING' }
  Write-Host ("  [{0,-7}] {1,-8} {2}" -f $mark, $r.label, $r.p)
}
if ($missing) { throw "缺少 $missing 个关键文件，中止。" }

# --- 5. initializeInstall.js ---
Write-Host "`n[5] 运行应用自带初始化脚本"
$appBun = Join-Path $appDir 'bin\bun.exe'
& $appBun $bundledInit $installDir $desktopDir $programsDir
$initRc = $LASTEXITCODE
Write-Host "  退出码: $initRc"
if ($initRc -ne 0) { throw '初始化脚本失败。' }

# --- 6. 注册表 ---
Write-Host "`n[6] 写入系统注册信息"
$unKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$identifier.stable"
$appIco = Join-Path $appDir 'Resources\app.ico'
New-Item -Path $unKey -Force | Out-Null
$regValues = @{
  'DisplayName'              = $appName
  'DisplayVersion'           = $version
  'InstallLocation'          = $installDir
  'toonflowInstallDirectory' = $installDir
  'DisplayIcon'              = $appIco
  'UninstallString'          = "`"$(Join-Path $installDir 'uninstall.exe')`""
  'QuietUninstallString'     = "`"$(Join-Path $installDir 'uninstall.exe')`" /S"
}
foreach ($k in $regValues.Keys) {
  New-ItemProperty -Path $unKey -Name $k -Value $regValues[$k] -PropertyType String -Force | Out-Null
}
New-Item -Path 'HKCU:\Software\Classes\zhukai' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\zhukai' -Name '(default)' -Value "URL:$appName Protocol"
Set-ItemProperty -Path 'HKCU:\Software\Classes\zhukai' -Name 'URL Protocol' -Value ''
New-Item -Path 'HKCU:\Software\Classes\zhukai\DefaultIcon' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\zhukai\DefaultIcon' -Name '(default)' -Value "`"$appIco`",0"
New-Item -Path 'HKCU:\Software\Classes\zhukai\shell\open\command' -Force | Out-Null
$protoExe = Join-Path $appDir 'Resources\app\protocolLauncher.exe'
Set-ItemProperty -Path 'HKCU:\Software\Classes\zhukai\shell\open\command' -Name '(default)' -Value "`"$protoExe`" `"%1`""
Write-Host "  已写入卸载信息与 zhukai:// 协议"

# --- 7. 快捷方式 ---
Write-Host "`n[7] 创建快捷方式"
$ws = New-Object -ComObject WScript.Shell
foreach ($dir in @($desktopDir, $programsDir)) {
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $lnkPath = Join-Path $dir "$appName.lnk"
  $lnk = $ws.CreateShortcut($lnkPath)
  $lnk.TargetPath = Join-Path $appDir 'bin\launcher.exe'
  $lnk.IconLocation = $appIco
  $lnk.WorkingDirectory = Join-Path $appDir 'bin'
  $lnk.Save()
  $ok = Test-Path $lnkPath
  Write-Host ("  [{0}] {1}" -f $(if ($ok) { 'OK' } else { 'FAIL' }), $lnkPath)
}

Write-Host "`n安装完成"
Write-Host "  启动器:     $(Join-Path $appDir 'bin\launcher.exe')"
Write-Host "  卸载程序:   $(Join-Path $installDir 'uninstall.exe')"
Write-Host "  桌面快捷方式: $(Join-Path $desktopDir "$appName.lnk")"
