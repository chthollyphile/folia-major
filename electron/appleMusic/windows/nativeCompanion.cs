using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

// Windows-only host for the same bounded stdin/stdout controls as the macOS system-WebView helper.
namespace Folia.AppleMusic
{
    internal sealed class NativeCompanion : ApplicationContext
    {
        internal readonly JsonLineProtocol Protocol = new JsonLineProtocol();
        internal readonly List<WebViewHost> Windows = new List<WebViewHost>();
        internal bool WantsWindowsVisible { get; private set; }
        private readonly string profile;
        private FileStream profileLock;
        private WebViewHost main;
        private bool closing;
        private int queued;

        internal NativeCompanion(string path) { profile = path; }
        internal async Task Start()
        {
            try
            {
                Directory.CreateDirectory(profile);
                profileLock = new FileStream(Path.Combine(profile, "native.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
                main = new WebViewHost(this, true);
                Windows.Add(main);
                // Install the WinForms UI synchronization context before the first awaited WebView2 call.
                var handle = main.Handle;
                var options = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required");
                // Null browserExecutableFolder selects the installed Evergreen runtime, not a bundled Fixed Runtime.
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(profile, "WebView2"), options);
                await main.Initialize(environment);
                Protocol.Send(new { @event = "diagnostic", code = "environment-ready" });
                main.Core.Navigate("https://music.apple.com/");
                _ = Task.Run(() => Protocol.Read(Queue, () => Post(Stop)));
                Protocol.Send(new { @event = "started", engine = "WebView2" });
            }
            catch
            {
                Protocol.Send(new { @event = "diagnostic", code = "environment-failed" });
                Protocol.Send(new { @event = "runtime-unavailable" });
                Stop();
            }
        }
        private void Post(Action action)
        {
            if (!closing && main != null && !main.IsDisposed) main.BeginInvoke(action);
        }
        private void Queue(Dictionary<string, object> request)
        {
            if (request == null) return;
            if (System.Threading.Interlocked.Increment(ref queued) > 24) { Post(Stop); return; }
            Post(async () =>
            {
                try { await Handle(request); }
                finally { System.Threading.Interlocked.Decrement(ref queued); }
            });
        }
        // Native controls never accept filesystem operations, host objects, credentials or arbitrary destinations.
        private async Task Handle(Dictionary<string, object> request)
        {
            var id = JsonLineProtocol.Text(request, "id");
            if (id == null || !Regex.IsMatch(id, "^[a-zA-Z0-9_-]{1,64}$")) return;
            try
            {
                switch (JsonLineProtocol.Text(request, "operation"))
                {
                    case "show":
                        Protocol.Send(new { @event = "diagnostic", code = "show" });
                        WantsWindowsVisible = true;
                        foreach (var window in Windows.ToArray()) { window.ShowInTaskbar = true; window.Show(); window.Activate(); }
                        Protocol.Reply(id, new { }); break;
                    case "hide":
                        Protocol.Send(new { @event = "diagnostic", code = "hide" });
                        WantsWindowsVisible = false;
                        foreach (var window in Windows.ToArray()) { window.Hide(); window.ShowInTaskbar = false; }
                        Protocol.Reply(id, new { }); break;
                    case "navigate":
                        await main.Navigate(id, JsonLineProtocol.Text(request, "url")); break;
                    case "evaluate":
                        await main.Evaluate(id, JsonLineProtocol.Text(request, "expression")); break;
                    case "clear":
                        if (!main.Ready || main.Core.Source != "about:blank") { Protocol.Reply(id, error: "invalid-request"); break; }
                        foreach (var popup in Windows.Where(window => window != main).ToArray()) popup.Close();
                        await main.Core.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.AllProfile);
                        Protocol.Reply(id, new { }); break;
                    default: Protocol.Reply(id, error: "invalid-request"); break;
                }
            }
            catch { Protocol.Reply(id, error: "request-failed"); }
        }
        internal void Closed(WebViewHost window)
        {
            Windows.Remove(window);
            if (window == main) Stop();
        }
        internal void Stop()
        {
            if (closing) return;
            closing = true;
            try
            {
                foreach (var window in Windows.ToArray()) { try { window.Dispose(); } catch { } }
                Windows.Clear();
            }
            finally { profileLock?.Dispose(); ExitThread(); }
        }
        [STAThread]
        private static void Main(string[] arguments)
        {
            var profile = arguments.FirstOrDefault(value => value.StartsWith("--profile=", StringComparison.Ordinal))?.Substring(10);
            if (string.IsNullOrWhiteSpace(profile) || !Path.IsPathRooted(profile)) return;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var context = new NativeCompanion(profile);
            EventHandler firstIdle = null;
            firstIdle = async (_, __) => { Application.Idle -= firstIdle; await context.Start(); };
            Application.Idle += firstIdle;
            Application.Run(context);
        }
    }
}
