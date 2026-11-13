// Stand-in "script editor" for AdvanceMap's スクリプトを開く buttons.
// It only appends its command line to ScriptEditorStub.log next to the exe and exits.
using System;
using System.IO;
class P {
    static void Main(string[] a) {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        File.AppendAllText(Path.Combine(dir, "ScriptEditorStub.log"),
            DateTime.Now.ToString("s") + "\t" + Environment.CommandLine + Environment.NewLine);
    }
}
