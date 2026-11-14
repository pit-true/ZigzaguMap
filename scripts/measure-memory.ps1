# ZigzaguMap の待機時メモリを測る（issue #108）。WebView2 の各プロセスを含めた内訳を、決まった場面ごとに出す。
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\measure-memory.ps1 -Exe <zigzagumap.exe> -Rom <素の BPRJ> [-Out result.json]
#
# - exe を `--automation <ポート> --profile <一時フォルダ>` で起動し（通常の設定には触れない。画面外・非アクティブ）、
#   自動操作の入口で操作しながら、各場面のあと 10 秒待ってから測る（JavaScript のヒープは GC されるまで縮まないため。-Settle で変えられる）。
# - 場面: 起動直後 / ROM を開いた後（3.0 を表示）/ マップを 10 枚切り替えた後 / 別ウィンドウ（ブロックエディタ）を開いた後 / 閉じた後
#   -Project（CFRU-JP のフォルダ。写しを渡す。読むだけで書き込まない）を付けると、ROM と一緒に開き、
#   続けてスクリプトエディタを開いた後 / 閉じた後 も測る（開くファイルは -ScriptFile、省略で assembly\overworld_scripts の最初の .s）
# - 測る値（MB = 1024*1024 バイト）:
#     private  … プライベート（コミット）バイト。Process.PrivateMemorySize64
#     ws       … ワーキングセット。Process.WorkingSet64（共有ページを含むので、合計は実際より大きく出る）
#     pws      … 専用ワーキングセット（タスクマネージャーの「メモリ」の列と同じ）。Win32_PerfFormattedData_PerfProc_Process.WorkingSetPrivate
#   目標（150MB 以下）は「専用ワーキングセットの合計」で判定する（利用者がタスクマネージャーで見る値で、共有ページを二重に数えない）。
# - 対象: exe と、その子孫（WebView2 のブラウザ・レンダラー・GPU・ユーティリティ・crashpad）。種類はコマンドラインの --type= で分ける。
# - -Baseline を付けると、-Exe に渡した「WebView2 の空のウィンドウだけを開く Tauri アプリ」（tools/webview-baseline）の値を測る
#   （下限の比較用。-BrowserArgs をそのアプリの WebView2 に渡す）。
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$Rom = "",
  [string]$Project = "",
  [string]$ScriptFile = "",
  [int]$Port = 17995,
  [int]$Settle = 10,
  [string]$Out = "",
  [switch]$Baseline,
  # 調べる用: WebView2 に足す引数（環境変数 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS で渡す。アプリが渡す引数に足される）
  [string]$BrowserArgs = ""
)
$ErrorActionPreference = "Stop"

function Call($obj) {
  $body = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress))
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -Method Post -Body $body -ContentType "application/json" -UseBasicParsing -TimeoutSec 120
  $j = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json
  if (-not $j.ok) { throw "自動操作の入口がエラーを返しました: $($j.error)" }
  return $j.result
}

function Tree([int]$root) {
  $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine
  $ids = New-Object System.Collections.Generic.List[int]
  $ids.Add($root)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($p in $all) {
      if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { $ids.Add([int]$p.ProcessId); $changed = $true }
    }
  }
  return $all | Where-Object { $ids.Contains([int]$_.ProcessId) }
}

function Kind($p, [int]$root) {
  if ($p.ProcessId -eq $root) { return "app" }
  if ($p.CommandLine -match "--type=([a-z-]+)") {
    $t = $Matches[1]
    if ($t -eq "gpu-process") { return "gpu" }
    if ($t -eq "utility" -and $p.CommandLine -match "--utility-sub-type=([\w.]+)") { return "utility(" + ($Matches[1] -replace "^.*\.", "") + ")" }
    return $t
  }
  if ($p.Name -like "msedgewebview2*") { return "browser" }
  return $p.Name
}

function Get-Snapshot([string]$label, [int]$root) {
  Start-Sleep -Seconds $Settle
  $procs = Tree $root
  $perf = @{}
  Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Property IDProcess, WorkingSetPrivate | ForEach-Object { $perf[[int]$_.IDProcess] = [double]$_.WorkingSetPrivate }
  $rows = foreach ($p in $procs) {
    try { $gp = Get-Process -Id $p.ProcessId } catch { continue }
    [pscustomobject]@{
      kind    = Kind $p $root
      pid     = [int]$p.ProcessId
      private = [math]::Round($gp.PrivateMemorySize64 / 1MB, 1)
      ws      = [math]::Round($gp.WorkingSet64 / 1MB, 1)
      pws     = [math]::Round(($perf[[int]$p.ProcessId]) / 1MB, 1)
    }
  }
  $rows = $rows | Sort-Object kind, pid
  $sum = [pscustomobject]@{
    private = [math]::Round(($rows | Measure-Object private -Sum).Sum, 1)
    ws      = [math]::Round(($rows | Measure-Object ws -Sum).Sum, 1)
    pws     = [math]::Round(($rows | Measure-Object pws -Sum).Sum, 1)
  }
  Write-Host ""
  Write-Host ("== {0}  合計: 専用WS {1} MB / プライベート {2} MB / WS {3} MB（{4} プロセス）" -f $label, $sum.pws, $sum.private, $sum.ws, @($rows).Count)
  $rows | Format-Table kind, pid, pws, private, ws -AutoSize | Out-String -Width 200 | Write-Host
  $heap = $null
  if (-not $Baseline) { try { $heap = (Call @{ cmd = "state" }).jsHeap } catch {} }
  if ($heap) { Write-Host ("  JavaScript のヒープ（メイン）: 使用 {0} MB / 確保 {1} MB" -f $heap.used, $heap.total) }
  $browser = $procs | Where-Object { $_.Name -like "msedgewebview2*" -and $_.CommandLine -notmatch "--type=" } | Select-Object -First 1
  return [pscustomobject]@{ stage = $label; total = $sum; processes = @($rows); jsHeap = $heap; browserCommandLine = $browser.CommandLine }
}

$profile = Join-Path ([IO.Path]::GetTempPath()) ("zzm-measure-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $profile | Out-Null
$results = @()
$proc = $null
try {
  $argList = @("--automation", "$Port", "--profile", "`"$profile`"")
  if ($Baseline) { $argList = @("--profile", "`"$profile`"", "--args", "`"$BrowserArgs`"") }
  if ($BrowserArgs -and -not $Baseline) { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $BrowserArgs }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $proc = Start-Process -FilePath $Exe -ArgumentList $argList -PassThru
  if ($Baseline) {
    Start-Sleep -Seconds 3
    $results += Get-Snapshot "WebView2 の空のウィンドウ" $proc.Id
  } else {
    $ready = $false
    for ($i = 0; $i -lt 200 -and -not $ready; $i++) {
      try { Call @{ cmd = "state" } | Out-Null; $ready = $true } catch { Start-Sleep -Milliseconds 100 }
    }
    if (-not $ready) { throw "自動操作の入口が応答しません" }
    $readyMs = $sw.ElapsedMilliseconds
    Write-Host ("入口が応答するまで {0} ms" -f $readyMs)
    $results += Get-Snapshot "起動直後" $proc.Id
    if ($Rom) {
      if ($Project) { Call @{ cmd = "open"; rom = $Rom; project = $Project } | Out-Null } else { Call @{ cmd = "open"; rom = $Rom } | Out-Null }
      Call @{ cmd = "selectMap"; bank = 3; map = 0 } | Out-Null
      $results += Get-Snapshot "ROM を開いた後（3.0）" $proc.Id
      $maps = @(@(3, 1), @(3, 3), @(3, 19), @(4, 1), @(1, 1), @(3, 37), @(3, 45), @(3, 50), @(5, 0), @(3, 0))
      $ms = @()
      foreach ($m in $maps) { $ms += (Call @{ cmd = "selectMap"; bank = $m[0]; map = $m[1] }).switchMs }
      Write-Host ("マップ切り替え（ms）: " + (($ms | ForEach-Object { [math]::Round($_, 1) }) -join ", "))
      $timing = [pscustomobject]@{ readyMs = $readyMs; switchMs = @($ms | ForEach-Object { [math]::Round($_, 1) }) }
      $results += Get-Snapshot "マップを 10 枚切り替えた後" $proc.Id
      Call @{ cmd = "action"; id = "tools.blockEditor" } | Out-Null
      for ($i = 0; $i -lt 100; $i++) {
        $w = Call @{ cmd = "windows" }
        if (@($w | Where-Object { $_.label -eq "block-editor" -and $_.ready }).Count -gt 0) { break }
        Start-Sleep -Milliseconds 100
      }
      $results += Get-Snapshot "別ウィンドウ（ブロックエディタ）を開いた後" $proc.Id
      Call @{ cmd = "close"; window = "block-editor" } | Out-Null
      $results += Get-Snapshot "別ウィンドウを閉じた後" $proc.Id
      if ($Project) {
        if (-not $ScriptFile) {
          $first = Get-ChildItem -Path (Join-Path $Project "assembly\overworld_scripts") -Filter *.s | Sort-Object Name | Select-Object -First 1
          $ScriptFile = "assembly/overworld_scripts/" + $first.Name
        }
        Call @{ cmd = "script.open"; path = $ScriptFile } | Out-Null
        for ($i = 0; $i -lt 100; $i++) {
          $w = Call @{ cmd = "windows" }
          if (@($w | Where-Object { $_.label -eq "script-editor" -and $_.ready }).Count -gt 0) { break }
          Start-Sleep -Milliseconds 100
        }
        $results += Get-Snapshot "スクリプトエディタを開いた後" $proc.Id
        Call @{ cmd = "close"; window = "script-editor" } | Out-Null
        $results += Get-Snapshot "スクリプトエディタを閉じた後" $proc.Id
      }
    }
  }
} finally {
  if ($proc -and -not $proc.HasExited) {
    try { Call @{ cmd = "exit" } | Out-Null } catch {}
    if (-not $proc.WaitForExit(10000)) { & taskkill /T /F /PID $proc.Id | Out-Null }
  }
  Start-Sleep -Seconds 2
  Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue
}
if ($Out) { [pscustomobject]@{ browserArgs = $BrowserArgs; timing = $timing; stages = $results } | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $Out }
