param([ValidateSet('Probe','Listen','Speak','File','Generate')][string]$Mode='Probe',[string]$AudioFile='')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false)
try {
 Add-Type -AssemblyName System.Speech
 Add-Type -AssemblyName System.Web.Extensions
 $source=@'
using System;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Threading;
using System.Linq;
using System.Web.Script.Serialization;

public static class SpeakingSpeechBridge {
    private static readonly object Gate = new object();
    private static void Emit(object value) {
        lock (Gate) { Console.WriteLine(new JavaScriptSerializer().Serialize(value)); Console.Out.Flush(); }
    }
    private static void ConfigureVoice(SpeechSynthesizer synth) {
        var voice = synth.GetInstalledVoices().FirstOrDefault(v => v.Enabled && v.VoiceInfo.Culture.TwoLetterISOLanguageName == "en");
        if (voice != null) synth.SelectVoice(voice.VoiceInfo.Name);
        synth.Rate = -1;
    }
    public static void Run(string mode, string audioFile) {
        try {
            var recognizerInfo = SpeechRecognitionEngine.InstalledRecognizers().OrderByDescending(r => r.Culture.Name == "en-US").FirstOrDefault(r => r.Culture.TwoLetterISOLanguageName == "en");
            if (mode == "Probe") {
                using (var synth = new SpeechSynthesizer()) {
                    bool canSpeak = synth.GetInstalledVoices().Any(v => v.Enabled && v.VoiceInfo.Culture.TwoLetterISOLanguageName == "en");
                    Emit(new { type = "info", available = recognizerInfo != null, culture = recognizerInfo == null ? "" : recognizerInfo.Culture.Name, canSpeak = canSpeak });
                }
                return;
            }
            if (mode == "Speak" || mode == "Generate") {
                using (var synth = new SpeechSynthesizer()) {
                    ConfigureVoice(synth);
                    if (mode == "Generate") synth.SetOutputToWaveFile(audioFile, new System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, System.Speech.AudioFormat.AudioBitsPerSample.Sixteen, System.Speech.AudioFormat.AudioChannel.Mono)); else synth.SetOutputToDefaultAudioDevice();
                    Emit(new { type = "speaking" });
                    synth.Speak(Console.In.ReadToEnd());
                    Emit(new { type = "speak-ended" });
                }
                return;
            }
            if (recognizerInfo == null) { Emit(new { type = "error", code = "no-english-recognizer" }); return; }
            using (var engine = new SpeechRecognitionEngine(recognizerInfo))
            using (var completed = new ManualResetEvent(false)) {
                engine.LoadGrammar(new DictationGrammar());
                engine.EndSilenceTimeout = TimeSpan.FromMilliseconds(900);
                engine.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(1300);
                engine.InitialSilenceTimeout = TimeSpan.Zero;
                engine.SpeechHypothesized += delegate(object sender, SpeechHypothesizedEventArgs args) { Emit(new { type = "partial", text = args.Result.Text }); };
                engine.SpeechRecognized += delegate(object sender, SpeechRecognizedEventArgs args) { Emit(new { type = "final", text = args.Result.Text, confidence = args.Result.Confidence }); };
                engine.SpeechRecognitionRejected += delegate { Emit(new { type = "unclear" }); };
                engine.RecognizeCompleted += delegate { completed.Set(); };
                if (mode == "File") {
                    engine.SetInputToWaveFile(audioFile);
                    engine.RecognizeAsync(RecognizeMode.Multiple);
                    if (!completed.WaitOne(TimeSpan.FromSeconds(45))) engine.RecognizeAsyncCancel();
                } else {
                    engine.SetInputToDefaultAudioDevice();
                    engine.RecognizeAsync(RecognizeMode.Multiple);
                    Emit(new { type = "listening" });
                    // stdin stays open for an explicit Stop command from the main process.
                    Console.ReadLine();
                    engine.RecognizeAsyncStop();
                    if (!completed.WaitOne(TimeSpan.FromSeconds(4))) engine.RecognizeAsyncCancel();
                }
                Emit(new { type = "stopped" });
            }
        } catch { Emit(new { type = "error", code = "speech-device-error" }); }
    }
}
'@
 $references=@([System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location,[System.Web.Script.Serialization.JavaScriptSerializer].Assembly.Location,'System.dll','System.Core.dll')
 Add-Type -TypeDefinition $source -ReferencedAssemblies $references
 [SpeakingSpeechBridge]::Run($Mode,$AudioFile)
} catch {
 [Console]::WriteLine('{"type":"error","code":"speech-unavailable"}')
 exit 1
}
