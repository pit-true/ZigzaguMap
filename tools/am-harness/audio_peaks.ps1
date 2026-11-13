# 既定の再生デバイスの音声セッションごとの音量のピークを、決めた時間のあいだ読み続け、最大値を JSON で出す。
# 効果音が鳴ったか（どのプロセスが鳴らしたか）を確かめるためのもので、音の設定は何も変えない（読むだけ）。
#   powershell -NoProfile -ExecutionPolicy Bypass -File audio_peaks.ps1 -Seconds 30 [-Out peaks.json] [-StopFile <パス>]
#   -StopFile を付けると、そのファイルができた時点で止める（-Seconds は上限。比較テストの全シナリオの間など）。
param([double]$Seconds = 10, [int]$IntervalMs = 20, [string]$Out = "", [string]$StopFile = "")

Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace ZzmAudio {
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int NotImpl1();
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  }
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int NotImpl1(); int NotImpl2();
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e);
  }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int n);
    [PreserveSig] int GetSession(int i, out IAudioSessionControl2 s);
  }
  [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int s);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string n);
    int SetDisplayName(string a, ref Guid b);
    int GetIconPath(out IntPtr p);
    int SetIconPath(string a, ref Guid b);
    int GetGroupingParam(out Guid g);
    int SetGroupingParam(ref Guid a, ref Guid b);
    int RegisterAudioSessionNotification(IntPtr a);
    int UnregisterAudioSessionNotification(IntPtr a);
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s);
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s);
    [PreserveSig] int GetProcessId(out uint pid);
    [PreserveSig] int IsSystemSoundsSession();
  }
  [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioMeterInformation {
    [PreserveSig] int GetPeakValue(out float peak);
  }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}

  public static class Meter {
    public static Dictionary<string, double> Watch(double seconds, int intervalMs, string stopFile) {
      var result = new Dictionary<string, double>();
      var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      IMMDevice dev;
      if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0) throw new Exception("再生デバイスがありません");
      var iid = typeof(IAudioSessionManager2).GUID;
      object o;
      dev.Activate(ref iid, 23, IntPtr.Zero, out o);
      var mgr = (IAudioSessionManager2)o;
      var end = DateTime.Now.AddSeconds(seconds);
      while (DateTime.Now < end && !(stopFile.Length > 0 && System.IO.File.Exists(stopFile))) {
        IAudioSessionEnumerator e;
        mgr.GetSessionEnumerator(out e);
        int n; e.GetCount(out n);
        for (int i = 0; i < n; i++) {
          IAudioSessionControl2 s; e.GetSession(i, out s);
          uint pid; s.GetProcessId(out pid);
          bool sys = s.IsSystemSoundsSession() == 0;
          var meter = (IAudioMeterInformation)s;
          float peak; meter.GetPeakValue(out peak);
          string key = sys ? "system-sounds" : ("pid:" + pid);
          double prev;
          if (!result.TryGetValue(key, out prev) || peak > prev) result[key] = peak;
        }
        System.Threading.Thread.Sleep(intervalMs);
      }
      return result;
    }
  }
}
"@

$r = [ZzmAudio.Meter]::Watch($Seconds, $IntervalMs, $StopFile)
$json = ($r.GetEnumerator() | ForEach-Object { '"{0}": {1}' -f $_.Key, $_.Value.ToString([Globalization.CultureInfo]::InvariantCulture) }) -join ", "
$json = "{" + $json + "}"
if ($Out) { [IO.File]::WriteAllText($Out, $json) } else { $json }
