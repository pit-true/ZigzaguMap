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
#     autopen    … オートペンで 3.0 に 1 回ドラッグして描いた後（メモリの上だけ。出力しない）
#   Phase5 の仕上げ（#406）で足したもの:
#     tools       … 描く道具（塗りつぶし・マジック塗り・マップシフト・直線・スマートパス）を 3.0 で使い、全部戻した後（メモリの上だけ）
#     export      … 3.0 を 12 回描いてから、ファイル > マップの画像を書き出す... で PNG（このマップと接続している全マップ）と
#                   タイムラプスの GIF を一時フォルダに書き、窓を閉じて描いたものを戻した後
#     userscripts … -Project のフォルダの zigzagumap-scripts\ に docs/userscripts の例（grass.js・count.js）を置いて有効にし、
#                   count.js の操作で全マップを数えた後（-Project が要る。写しを渡す。最後に置いたファイルと zigzagumap.json を元に戻す）
#   `all` は Phase4 の 6 つと Phase5 の tools・export（userscripts は -Project があるときだけ足す）。
#   Phase6（#454）: playback … -PlaybackLabel のラベルを 3.0 で 4 倍で最後まで再生した後（再生中）と、再生を終えた後（-Project が要る。all には入らない）。
#   Phase6 の仕上げ（#493）で足したもの（all には入らない）:
#     timeofday  … 時間帯を朝・夕・夜・昼の順に切り替えた後
#     tileimport … ブロックエディタから「画像からタイルを取り込む」の窓を開いて閉じ、ブロックエディタも閉じた後
#     heavy      … いちばん重い組み合わせ。-HeavyMap（既定 3.6、人物の多いマップ）で、表示 > 人物を動かす・タイルアニメ・
#                   人物の移動範囲と視界をオンにし、仮の主人公と連れ歩きを置き、夜にして、人 0 のスクリプトを 4 倍で最後まで
#                   再生した後（再生中）と、再生を止めて全部を戻した後。CPU（exe と WebView2 の合計、論理コア 1 つ = 100%）も
#                   「どれもオフ」「人物を動かすだけ」「仮の主人公も」「全部オフに戻した後」で -CpuSeconds 秒ずつ測る（-Project が要る）
#   Phase7 の仕上げ（#534）で足したもの（all には入らない。phase7 で 6 つ全部）:
#     minimap  … 表示 > ミニマップ（#542 から別ウィンドウ）を開いた状態、タウンマップも出した状態、両方を戻して閉じた後
#     connection … ツール > マップコネクション（#561 から別ウィンドウ）を開いた状態と、閉じた後（all・phase7 には入らない）
#     brush    … 鉛筆のブラシを 9・円にして 3.0 に描き、戻してブラシも 1・正方形に戻した後（メモリの上だけ）
#     pathdraw … 道をなぞる窓を主人公で開き、10 歩なぞった状態と、窓を閉じた後（-Project が要る）
#     search   … スクリプトエディタの全ファイル検索で「msgbox」を探した状態と、エディタを閉じた後（-Project が要る）
#     mcp      … 設定 > MCP の窓口 > MCP の窓口を開く をオンにした状態と、オフに戻した後
#     gifanim  … 3.0 のタイルアニメの GIF を一時フォルダに書き出し、窓を閉じた後
# - -BlockStats を付けると、ブロックエディタを開いた後に 表示 > 使用回数・未使用のブロック・未使用のタイル（#395）をオンにして数えた後も測る。
# - -WildSearch を付けると、ブロックエディタを開く前に ツール > 野生ポケモンの検索…（#398）でポッポを探した後と、窓を閉じた後も測る。
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
  [switch]$WildSearch,
  # -Stages playback で再生するラベル（-Project のスクリプト）
  [string]$PlaybackLabel = "TwoOpponentBattleShowMessage",
  # -Stages heavy で使うマップ（"バンク.番号"。既定はタマムシシティ、人物 14 人）と、CPU を測る秒数
  [string]$HeavyMap = "3.6",
  [int]$CpuSeconds = 10,
  # 調べる用: WebView2 に足す引数（環境変数 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS で渡す。アプリが渡す引数に足される）
  [string]$BrowserArgs = ""
)
$ErrorActionPreference = "Stop"

function Call($obj) {
  $body = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 10 -Compress))
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

function Get-Cpu([string]$label, [int]$root) {
  # 落ち着くまで待ってから、exe と子孫の CPU 時間の増え方を測る（論理コア 1 つを使い切ると 100%）
  Start-Sleep -Seconds 3
  $ids = @(Tree $root | ForEach-Object { [int]$_.ProcessId })
  $t0 = 0.0; foreach ($i in $ids) { try { $t0 += (Get-Process -Id $i).TotalProcessorTime.TotalMilliseconds } catch {} }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  Start-Sleep -Seconds $CpuSeconds
  $t1 = 0.0; foreach ($i in $ids) { try { $t1 += (Get-Process -Id $i).TotalProcessorTime.TotalMilliseconds } catch {} }
  $pct = [math]::Round(100 * ($t1 - $t0) / $sw.ElapsedMilliseconds, 1)
  Write-Host ("== CPU {0}: {1}%" -f $label, $pct)
  return [pscustomobject]@{ stage = "CPU " + $label; cpu = $pct }
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
      if ($extra -contains "all") {
        # all の後ろに書いた場面（Phase6 の timeofday など）は、all の場面に続けて測る
        $rest = @($extra | Where-Object { $_ -ne "all" })
        $extra = @("zoom8", "assist", "transplant", "pointers", "triple", "autopen", "tools", "export")
        if ($Project) { $extra += "userscripts" }
        $extra += $rest
      }
      if ($extra -contains "phase7") {
        $extra = @($extra | Where-Object { $_ -ne "phase7" }) + @("minimap", "brush", "pathdraw", "search", "mcp", "gifanim")
      }
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
          "tools" {
            Call @{ cmd = "selectMap"; bank = 3; map = 0 } | Out-Null
            $h0 = (Call @{ cmd = "editHistory.state" }).position
            Call @{ cmd = "selectBlock"; block = 0x0D } | Out-Null
            Call @{ cmd = "tool.set"; tool = "fill" } | Out-Null
            Call @{ cmd = "mouse"; target = "map"; action = "click"; cell = @(10, 10) } | Out-Null
            Call @{ cmd = "mouse"; target = "map"; action = "click"; cell = @(10, 10); ctrl = $true } | Out-Null
            Call @{ cmd = "tool.set"; tool = "shift" } | Out-Null
            Call @{ cmd = "mouse"; target = "map"; action = "drag"; cell = @(5, 5); to = @(9, 7); steps = 4 } | Out-Null
            Call @{ cmd = "tool.set"; tool = "pencil" } | Out-Null
            Call @{ cmd = "mouse"; target = "map"; action = "drag"; cell = @(2, 2); to = @(12, 3); steps = 6; shift = $true } | Out-Null
            Call @{ cmd = "mouse"; target = "map"; action = "drag"; ctrl = $true; button = "right"; cell = @(0, 0); to = @(2, 2) } | Out-Null
            Call @{ cmd = "tool.set"; smartPath = $true } | Out-Null
            Call @{ cmd = "mouse"; target = "map"; action = "drag"; cell = @(4, 12); to = @(10, 12); steps = 4 } | Out-Null
            Call @{ cmd = "tool.set"; smartPath = $false } | Out-Null
            Call @{ cmd = "editHistory.goTo"; position = $h0 } | Out-Null
            $results += Get-Snapshot "描く道具を使って戻した後" $proc.Id
          }
          "export" {
            Call @{ cmd = "selectMap"; bank = 3; map = 0 } | Out-Null
            $h0 = (Call @{ cmd = "editHistory.state" }).position
            for ($i = 0; $i -lt 12; $i++) {
              $cells = @(); for ($dy = 0; $dy -lt 4; $dy++) { $cells += @{ x = 2 + $i; y = 2 + $dy; block = 0x10 + $i } }
              Call @{ cmd = "command"; name = "paintBlocks"; args = @{ bank = 3; map = 0; cells = $cells } } | Out-Null
            }
            $dir = Join-Path $profile "export"
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            Call @{ cmd = "action"; id = "image.export" } | Out-Null
            Call @{ cmd = "mapExport.state" } | Out-Null
            Call @{ cmd = "queuePath"; path = (Join-Path $dir "map.png") } | Out-Null
            Call @{ cmd = "mapExport.run"; action = "save" } | Out-Null
            Call @{ cmd = "setField"; id = "mapExport.rangeWhole"; value = $true } | Out-Null
            Call @{ cmd = "mapExport.state" } | Out-Null
            Call @{ cmd = "queuePath"; path = (Join-Path $dir "whole.png") } | Out-Null
            Call @{ cmd = "mapExport.run"; action = "save" } | Out-Null
            Call @{ cmd = "setField"; id = "mapExport.rangeMap"; value = $true } | Out-Null
            Call @{ cmd = "queuePath"; path = (Join-Path $dir "timelapse.gif") } | Out-Null
            Call @{ cmd = "mapExport.run"; action = "timelapse" } | Out-Null
            Call @{ cmd = "dialog"; press = "close" } | Out-Null
            Call @{ cmd = "editHistory.goTo"; position = $h0 } | Out-Null
            $results += Get-Snapshot "画像とタイムラプスを書き出した後" $proc.Id
          }
          "playback" {
            if (-not $Project) { throw "playback には -Project が要ります" }
            Call @{ cmd = "selectMap"; bank = 3; map = 0 } | Out-Null
            Call @{ cmd = "tab"; name = "event" } | Out-Null
            Call @{ cmd = "playback.start"; label = $PlaybackLabel } | Out-Null
            Call @{ cmd = "playback.speed"; value = 4 } | Out-Null
            Call @{ cmd = "playback.play" } | Out-Null
            for ($i = 0; $i -lt 300; $i++) {
              $st = Call @{ cmd = "playback.state" }
              if (-not $st.playing) {
                if ($st.frame -ge $st.lastFrame) { break }
                Call @{ cmd = "playback.play" } | Out-Null  # 文で止まったら続きへ
              }
              Start-Sleep -Milliseconds 100
            }
            $results += Get-Snapshot "スクリプトを最後まで再生した後（再生中）" $proc.Id
            Call @{ cmd = "playback.stop" } | Out-Null
            Call @{ cmd = "tab"; name = "map" } | Out-Null
            $results += Get-Snapshot "再生を終えた後" $proc.Id
          }
          "timeofday" {
            foreach ($t in @("morning", "evening", "night", "day")) { Call @{ cmd = "view.timeOfDay"; time = $t; wait = $true } | Out-Null }
            $results += Get-Snapshot "時間帯を朝・夕・夜・昼と切り替えた後" $proc.Id
          }
          "tileimport" {
            Call @{ cmd = "action"; id = "tools.blockEditor" } | Out-Null
            Wait-Window "block-editor"
            Call @{ cmd = "action"; id = "tiles.importImage"; window = "block-editor" } | Out-Null
            Wait-Window "tile-import"
            Call @{ cmd = "close"; window = "tile-import" } | Out-Null
            Wait-Window "tile-import" $false
            Call @{ cmd = "close"; window = "block-editor" } | Out-Null
            Wait-Window "block-editor" $false
            $results += Get-Snapshot "画像の取り込みの窓を開いて閉じた後" $proc.Id
          }
          "heavy" {
            if (-not $Project) { throw "heavy には -Project が要ります" }
            $best = $HeavyMap.Trim() -split "\."
            Call @{ cmd = "selectMap"; bank = [int]$best[0]; map = [int]$best[1] } | Out-Null
            Call @{ cmd = "tab"; name = "event" } | Out-Null
            $bestCount = 0
            for ($i = 0; $i -lt 50; $i++) {
              $ev = (Call @{ cmd = "event.state" }).events
              if ($ev) { $bestCount = @($ev.persons).Count; break }
              Start-Sleep -Milliseconds 100
            }
            Write-Host ("重い組み合わせのマップ: {0}.{1}（人物 {2}）" -f $best[0], $best[1], $bestCount)
            Call @{ cmd = "selectMap"; bank = [int]$best[0]; map = [int]$best[1] } | Out-Null
            Call @{ cmd = "tab"; name = "map" } | Out-Null
            $results += Get-Cpu "どれもオフ" $proc.Id
            Call @{ cmd = "action"; id = "view.npcMotion" } | Out-Null
            $results += Get-Cpu "人物を動かすだけ" $proc.Id
            Call @{ cmd = "action"; id = "view.tileAnimation" } | Out-Null
            Call @{ cmd = "action"; id = "view.npcRanges" } | Out-Null
            $c = Call @{ cmd = "cells" }
            Call @{ cmd = "preview.player"; enabled = $true; player = @{ x = [int][math]::Floor($c.width / 2); y = [int][math]::Floor($c.height / 2); facing = "down" } } | Out-Null
            try { $fs = Call @{ cmd = "follower.set"; enabled = $true }; Write-Host ("連れ歩き: enabled={0} reason={1}" -f $fs.enabled, $fs.status.reason) } catch { Write-Host "連れ歩きを置けません: $_" }
            Call @{ cmd = "view.timeOfDay"; time = "night"; wait = $true } | Out-Null
            $results += Get-Cpu "全部オン（仮の主人公・連れ歩き・夜）" $proc.Id
            Call @{ cmd = "tab"; name = "event" } | Out-Null
            # 人物の多い順に、スクリプトを再生できる人を探す（ROM のアドレスのままのスクリプトも再生できる）
            $started = $false
            for ($pi = 0; $pi -lt [math]::Max($bestCount, 20) -and -not $started; $pi++) {
              try { Call @{ cmd = "playback.start"; kind = "person"; index = $pi } | Out-Null; $started = $true; Write-Host "再生する人: $pi" } catch {}
            }
            if (-not $started) { throw "再生できる人がいません" }
            $results += [pscustomobject]@{ stage = "重い組み合わせのマップ"; map = "$($best[0]).$($best[1])"; persons = $bestCount; follower = $fs.enabled }
            Call @{ cmd = "playback.speed"; value = 4 } | Out-Null
            Call @{ cmd = "playback.play" } | Out-Null
            for ($i = 0; $i -lt 300; $i++) {
              $st = Call @{ cmd = "playback.state" }
              if (-not $st.playing) {
                if ($st.frame -ge $st.lastFrame) { break }
                Call @{ cmd = "playback.play" } | Out-Null
              }
              Start-Sleep -Milliseconds 100
            }
            $results += Get-Snapshot "重い組み合わせで再生した後（再生中）" $proc.Id
            Call @{ cmd = "playback.stop" } | Out-Null
            Call @{ cmd = "tab"; name = "map" } | Out-Null
            try { Call @{ cmd = "follower.set"; enabled = $false } | Out-Null } catch {}
            Call @{ cmd = "preview.player"; enabled = $false } | Out-Null
            foreach ($a in @("view.npcMotion", "view.tileAnimation", "view.npcRanges")) { Call @{ cmd = "action"; id = $a } | Out-Null }
            Call @{ cmd = "view.timeOfDay"; time = "day"; wait = $true } | Out-Null
            $results += Get-Snapshot "止めて全部を戻した後" $proc.Id
            $results += Get-Cpu "全部オフに戻した後" $proc.Id
          }
          "userscripts" {
            if (-not $Project) { throw "userscripts には -Project が要ります" }
            $sdir = Join-Path $Project "zigzagumap-scripts"
            $config = Join-Path $Project "zigzagumap.json"
            $hadDir = Test-Path $sdir
            $configBefore = if (Test-Path $config) { [IO.File]::ReadAllBytes($config) } else { $null }
            $placed = @()
            try {
              New-Item -ItemType Directory -Path $sdir -Force | Out-Null
              foreach ($n in @("grass.js", "count.js")) {
                $to = Join-Path $sdir $n
                if (-not (Test-Path $to)) { Copy-Item (Join-Path $PSScriptRoot "..\docs\userscripts\$n") $to; $placed += $to }
              }
              Call @{ cmd = "userScripts.reload" } | Out-Null
              Call @{ cmd = "action"; id = "scripts.manage" } | Out-Null
              foreach ($n in @("grass.js", "count.js")) { Call @{ cmd = "setField"; id = "userScripts.enable.$n"; value = $true } | Out-Null }
              $us = Call @{ cmd = "userScripts.state"; wait = $true }
              if (@($us.actions | Where-Object { $_.id -eq "countBlocks" }).Count -gt 0) {
                Call @{ cmd = "userScripts.run"; action = "countBlocks"; wait = $false } | Out-Null
                # 入力の窓（数えるブロック番号）に 00D で答え、ログに結果が出るまで待つ
                for ($i = 0; $i -lt 50; $i++) {
                  try { Call @{ cmd = "dialog"; input = "00D"; press = "ok" } | Out-Null; break } catch { Start-Sleep -Milliseconds 100 }
                }
                for ($i = 0; $i -lt 600; $i++) {
                  $us = Call @{ cmd = "userScripts.state" }
                  if (@($us.logs | Where-Object { $_.text -match "ブロック 00D は" }).Count -gt 0) { break }
                  Start-Sleep -Milliseconds 200
                }
              }
              try { Call @{ cmd = "dialog"; press = "close" } | Out-Null } catch {}
              $results += Get-Snapshot "スクリプトを有効にした後" $proc.Id
            } finally {
              try { Call @{ cmd = "userScripts.stop" } | Out-Null } catch {}
              foreach ($f in $placed) { Remove-Item -Force $f -ErrorAction SilentlyContinue }
              if (-not $hadDir) { Remove-Item -Recurse -Force $sdir -ErrorAction SilentlyContinue }
              if ($null -ne $configBefore) { [IO.File]::WriteAllBytes($config, $configBefore) } elseif (Test-Path $config) { Remove-Item -Force $config }
            }
          }
          "minimap" {
            Call @{ cmd = "selectMap"; bank = 3; map = 0 } | Out-Null
            Call @{ cmd = "action"; id = "view.minimap" } | Out-Null
            # #542 から別ウィンドウ（minimap.state に ready がある）。前の小窓の exe と同じ場面で測れるようにする
            $mm = Call @{ cmd = "minimap.state"; rebuild = $true }
            $separate = $null -ne $mm.PSObject.Properties["ready"]
            if ($separate) { Wait-Window "minimap" }
            $results += Get-Snapshot "ミニマップを開いた状態" $proc.Id
            Call @{ cmd = "minimap.town"; on = $true } | Out-Null
            $results += Get-Snapshot "ミニマップ（タウンマップも）を開いた状態" $proc.Id
            Call @{ cmd = "minimap.town"; on = $false } | Out-Null
            Call @{ cmd = "action"; id = "view.minimap" } | Out-Null
            if ($separate) { Wait-Window "minimap" $false }
            $results += Get-Snapshot "ミニマップを閉じた後" $proc.Id
          }
          "connection" {
            # コネクションマネージャー（#561 から別ウィンドウ。connection.state があれば別ウィンドウ）
            Call @{ cmd = "selectMap"; bank = 3; map = 0 } | Out-Null
            $separate = $true
            try { Call @{ cmd = "connection.state" } | Out-Null } catch { $separate = $false }
            Call @{ cmd = "action"; id = "tools.connections" } | Out-Null
            if ($separate) { Wait-Window "connection" }
            Start-Sleep -Seconds 1
            $results += Get-Snapshot "コネクションマネージャーを開いた状態" $proc.Id
            if ($separate) { Call @{ cmd = "close"; window = "connection" } | Out-Null; Wait-Window "connection" $false }
            else { Call @{ cmd = "dialog"; press = "close" } | Out-Null }
            $results += Get-Snapshot "コネクションマネージャーを閉じた後" $proc.Id
          }
          "brush" {
            Call @{ cmd = "selectMap"; bank = 3; map = 0 } | Out-Null
            $h0 = (Call @{ cmd = "editHistory.state" }).position
            Call @{ cmd = "tool.set"; tool = "pencil"; brushSize = 9; brushShape = "circle" } | Out-Null
            Call @{ cmd = "selectBlock"; block = 0x0D } | Out-Null
            Call @{ cmd = "mouse"; target = "map"; action = "drag"; cell = @(4, 4); to = @(16, 14); steps = 8 } | Out-Null
            Call @{ cmd = "editHistory.goTo"; position = $h0 } | Out-Null
            Call @{ cmd = "tool.set"; brushSize = 1; brushShape = "square" } | Out-Null
            $results += Get-Snapshot "大きいブラシで描いて戻した後" $proc.Id
          }
          "pathdraw" {
            if (-not $Project) { throw "pathdraw には -Project が要ります" }
            Call @{ cmd = "selectMap"; bank = 3; map = 0 } | Out-Null
            Call @{ cmd = "tab"; name = "event" } | Out-Null
            Call @{ cmd = "pathDraw.open"; start = @{ x = 10; y = 10; facing = "down" } } | Out-Null
            foreach ($d in @("down", "down", "right", "right", "right", "up", "up", "left", "left", "down")) { Call @{ cmd = "pathDraw.step"; direction = $d } | Out-Null }
            $results += Get-Snapshot "道をなぞる窓で 10 歩なぞった状態" $proc.Id
            Call @{ cmd = "pathDraw.close" } | Out-Null
            Call @{ cmd = "tab"; name = "map" } | Out-Null
            $results += Get-Snapshot "道をなぞる窓を閉じた後" $proc.Id
          }
          "search" {
            if (-not $Project) { throw "search には -Project が要ります" }
            $first = Get-ChildItem -Path (Join-Path $Project "assembly\overworld_scripts") -Filter *.s | Sort-Object Name | Select-Object -First 1
            Call @{ cmd = "script.open"; path = ("assembly/overworld_scripts/" + $first.Name) } | Out-Null
            Wait-Window "script-editor"
            $found = Call @{ cmd = "search.project"; window = "script-editor"; text = "msgbox" }
            Write-Host ("全ファイル検索: {0} 件、{1} ファイルを {2} ms" -f $found.count, $found.scanned, [math]::Round($found.ms))
            $results += Get-Snapshot "全ファイル検索をした状態（スクリプトエディタを開いたまま）" $proc.Id
            Call @{ cmd = "close"; window = "script-editor" } | Out-Null
            Wait-Window "script-editor" $false
            $results += Get-Snapshot "全ファイル検索をしてスクリプトエディタを閉じた後" $proc.Id
          }
          "mcp" {
            Call @{ cmd = "action"; id = "mcp.bridge" } | Out-Null
            $results += Get-Snapshot "MCP の窓口をオンにした状態" $proc.Id
            Call @{ cmd = "action"; id = "mcp.bridge" } | Out-Null
            $results += Get-Snapshot "MCP の窓口をオフに戻した後" $proc.Id
          }
          "gifanim" {
            Call @{ cmd = "selectMap"; bank = 3; map = 0 } | Out-Null
            $dir = Join-Path $profile "export"
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            Call @{ cmd = "action"; id = "image.export" } | Out-Null
            Call @{ cmd = "mapExport.state" } | Out-Null
            Call @{ cmd = "queuePath"; path = (Join-Path $dir "anim.gif") } | Out-Null
            $gif = Call @{ cmd = "mapExport.run"; action = "gif-anim" }
            if ($gif) { Write-Host ("タイルアニメの GIF: {0} コマ、{1} バイト" -f $gif.frames, $gif.bytes) }
            Call @{ cmd = "dialog"; press = "close" } | Out-Null
            $results += Get-Snapshot "タイルアニメの GIF を書き出した後" $proc.Id
          }
          default { throw "知らない場面です: $st" }
        }
      }
      if ($WildSearch) {
        # ツール > 野生ポケモンの検索…（#398）でポッポを探した後と、窓を閉じた後
        Call @{ cmd = "action"; id = "tools.wildSearch" } | Out-Null
        Start-Sleep -Milliseconds 500
        Call @{ cmd = "setField"; id = "wild.search.species"; value = 16 } | Out-Null
        Call @{ cmd = "click"; id = "wild.search.run" } | Out-Null
        for ($i = 0; $i -lt 300; $i++) {
          $f = Call @{ cmd = "getField"; id = "wild.search.info" }
          if ($f.value -match "枠|ありません") { break }
          Start-Sleep -Milliseconds 100
        }
        $results += Get-Snapshot "野生ポケモンの検索の後" $proc.Id
        Call @{ cmd = "dialog"; press = "close" } | Out-Null
        $results += Get-Snapshot "野生ポケモンの検索の窓を閉じた後" $proc.Id
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
