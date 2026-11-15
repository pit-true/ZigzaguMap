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
# - -Actions に自動操作のアクション ID（`view.treeThumbnails` など。`,` 区切り）を渡すと、ROM を開いたあとに実行してから測る。
#   -Zoom に 3〜8 を渡すと、マップタブを Ctrl＋ホイールでその倍率にしてから切り替える（Phase4 #315・#316 のオンのときの増え方を測る）。
# - -Stages に場面の名前（`,` 区切り。`all` で全部）を渡すと、索引を作った後に次の場面を足して測る（Phase4 の仕上げ #318）:
#     zoom8      … マップタブを Ctrl＋ホイールで 8 倍にした後（測ったあと 1 倍に戻す）
#     assist     … マップ作成補助の窓を開いて閉じた後
#     transplant … 別の ROM からの取り込み（移植）の窓を開いて閉じた後
#     pointers   … ポインタ一覧を開き、3.0 のヘッダーの参照元を探して閉じた後
#     triple     … 3.0 の主タイルセットのブロック 0x010 を 3 層にした（メモリの上だけ。出力しない）3.0 を表示した状態
#     autopen    … 自動ペンで 3.0 に 1 回ドラッグして描いた後（メモリの上だけ。出力しない）
# - -BlockStats を付けると、ブロックエディタを開いた後に 表示 > 使用回数・未使用のブロック・未使用のタイル（#395）をオンにして数えた後も測る。
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
  [string]$Actions = "",
  [int]$Zoom = 0,
  [string]$Stages = "",
  [switch]$BlockStats,
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

function Wait-Window([string]$label, [bool]$present = $true) {
  for ($i = 0; $i -lt 150; $i++) {
    $w = @(Call @{ cmd = "windows" } | Where-Object { $_.label -eq $label -and ($_.ready -or -not $present) })
    if (($w.Count -gt 0) -eq $present) { return }
    Start-Sleep -Milliseconds 100
  }
  throw "ウィンドウ $label が" + $(if ($present) { "開きません" } else { "閉じません" })
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
      foreach ($a in ($Actions -split "," | Where-Object { $_ })) { Call @{ cmd = "action"; id = $a.Trim() } | Out-Null }
      for ($z = 1; $z -lt $Zoom; $z++) { Call @{ cmd = "zoom.wheel"; cell = @(10, 10); delta = -1 } | Out-Null }
      if ($Actions -match "treeThumbnails") { Call @{ cmd = "thumbs.state"; wait = $true } | Out-Null }
      $results += Get-Snapshot "ROM を開いた後（3.0）" $proc.Id
      $maps = @(@(3, 1), @(3, 3), @(3, 19), @(4, 1), @(1, 1), @(3, 37), @(3, 45), @(3, 50), @(5, 0), @(3, 0))
      $ms = @()
      foreach ($m in $maps) { $ms += (Call @{ cmd = "selectMap"; bank = $m[0]; map = $m[1] }).switchMs }
      Write-Host ("マップ切り替え（ms）: " + (($ms | ForEach-Object { [math]::Round($_, 1) }) -join ", "))
      $timing = [pscustomobject]@{ readyMs = $readyMs; switchMs = @($ms | ForEach-Object { [math]::Round($_, 1) }) }
      $results += Get-Snapshot "マップを 10 枚切り替えた後" $proc.Id
      # イベントタブを開くと、使われている番号の索引（Phase3 #227）を作る。作り終えてから測る
      Call @{ cmd = "tab"; name = "event" } | Out-Null
      Call @{ cmd = "usage.state"; wait = $true } | Out-Null
      $results += Get-Snapshot "イベントタブで索引を作った後" $proc.Id
      Call @{ cmd = "tab"; name = "map" } | Out-Null
      $extra = @($Stages -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
      if ($extra -contains "all") { $extra = @("zoom8", "assist", "transplant", "pointers", "triple", "autopen") }
      foreach ($st in $extra) {
        switch ($st) {
          "zoom8" {
            for ($z = 1; $z -lt 8; $z++) { Call @{ cmd = "zoom.wheel"; tab = "map"; cell = @(10, 10); delta = -1 } | Out-Null }
            $results += Get-Snapshot "Ctrl＋ホイールで 8 倍にした後" $proc.Id
            for ($z = 1; $z -lt 8; $z++) { Call @{ cmd = "zoom.wheel"; tab = "map"; cell = @(10, 10); delta = 1 } | Out-Null }
          }
          "assist" {
            Call @{ cmd = "action"; id = "tools.mapAssist" } | Out-Null
            Wait-Window "map-assist"
            Start-Sleep -Seconds 2
            Call @{ cmd = "close"; window = "map-assist" } | Out-Null
            Wait-Window "map-assist" $false
            $results += Get-Snapshot "マップ作成補助の窓を開いて閉じた後" $proc.Id
          }
          "transplant" {
            Call @{ cmd = "action"; id = "tools.transplant" } | Out-Null
            Wait-Window "transplant"
            Start-Sleep -Seconds 2
            Call @{ cmd = "close"; window = "transplant" } | Out-Null
            Wait-Window "transplant" $false
            $results += Get-Snapshot "取り込み（移植）の窓を開いて閉じた後" $proc.Id
          }
          "pointers" {
            Call @{ cmd = "selectMap"; bank = 3; map = 0 } | Out-Null
            Call @{ cmd = "action"; id = "tools.pointers" } | Out-Null
            $ps = Call @{ cmd = "pointers.state" }
            Call @{ cmd = "pointers.search"; address = ($ps.rows[0].value - 0x08000000) } | Out-Null
            Call @{ cmd = "click"; id = "pointers.close" } | Out-Null
            $results += Get-Snapshot "ポインタの検索の後" $proc.Id
          }
          "triple" {
            Call @{ cmd = "selectMap"; bank = 3; map = 0 } | Out-Null
            $m = (Call @{ cmd = "state" }).map
            $info = Call @{ cmd = "blockInfo"; block = 16 }
            $attr = ([int64]$info.attribute -band 0x0FFFFFFF) -bor 0x30000000
            Call @{ cmd = "command"; name = "setBlock"; args = @{ tileset = $m.primaryTileset; secondary = $false; block = 16; attribute = $attr } } | Out-Null
            $results += Get-Snapshot "トリプルレイヤーのマップを表示した状態" $proc.Id
          }
          "autopen" {
            Call @{ cmd = "selectMap"; bank = 3; map = 0 } | Out-Null
            Call @{ cmd = "autopen.set"; active = $true; size = 3 } | Out-Null
            Call @{ cmd = "selectBlock"; block = 0x12B } | Out-Null
            Call @{ cmd = "mouse"; target = "map"; action = "drag"; cell = @(9, 13); to = @(13, 13); steps = 2 } | Out-Null
            Call @{ cmd = "autopen.set"; active = $false } | Out-Null
            $results += Get-Snapshot "オートペンを使った後" $proc.Id
          }
          default { throw "知らない場面です: $st" }
        }
      }
      Call @{ cmd = "action"; id = "tools.blockEditor" } | Out-Null
      for ($i = 0; $i -lt 100; $i++) {
        $w = Call @{ cmd = "windows" }
        if (@($w | Where-Object { $_.label -eq "block-editor" -and $_.ready }).Count -gt 0) { break }
        Start-Sleep -Milliseconds 100
      }
      $results += Get-Snapshot "別ウィンドウ（ブロックエディタ）を開いた後" $proc.Id
      if ($BlockStats) {
        # ブロックエディタの 表示 > 使用回数・未使用のブロック・未使用のタイル（#395）をオンにして数えた後
        foreach ($id in @("view.usage", "view.unusedBlocks", "view.unusedTiles")) { Call @{ cmd = "action"; id = $id; window = "block-editor" } | Out-Null }
        for ($i = 0; $i -lt 300; $i++) {
          $st = Call @{ cmd = "state"; window = "block-editor" }
          if ($st.stats.counted -and $null -ne $st.stats.unusedTiles) { break }
          Start-Sleep -Milliseconds 100
        }
        $results += Get-Snapshot "ブロックエディタで使用回数と未使用の印を出した後" $proc.Id
      }
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
