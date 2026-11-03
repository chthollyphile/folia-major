using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// WebView2 owns the page/session; page messages may resolve issued evaluations but cannot run native controls.
namespace Folia.AppleMusic
{
    internal sealed class WebViewHost : Form
    {
        private sealed class Evaluation
        {
            internal string Nonce;
            internal int Generation;
        }
        private readonly NativeCompanion owner;
        private readonly bool isMain;
        private readonly WebView2 browser = new WebView2 { Dock = DockStyle.Fill };
        private readonly Dictionary<string, Evaluation> evaluations = new Dictionary<string, Evaluation>();
        private int generation;
        private ulong activeNavigation;
        private ulong controlledNavigation;
        private string navigationRequest;
        private TaskCompletionSource<bool> navigationDone;
        private bool replacing;
        internal bool Ready { get; private set; }
        internal CoreWebView2 Core => browser.CoreWebView2;

        internal WebViewHost(NativeCompanion runtime, bool main)
        {
            owner = runtime; isMain = main;
            Text = "Folia Apple Music";
            ClientSize = new Size(1120, 760);
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.CenterScreen;
            Controls.Add(browser);
            FormClosed += (_, __) => owner.Closed(this);
        }
        internal async Task Initialize(CoreWebView2Environment environment)
        {
            // Force HWND creation without showing either the main window or a taskbar button.
            var windowHandle = Handle;
            var browserHandle = browser.Handle;
            await browser.EnsureCoreWebView2Async(environment);
            Core.Settings.AreHostObjectsAllowed = false;
            Core.Settings.AreDevToolsEnabled = false;
            Core.Settings.IsStatusBarEnabled = false;
            Core.Settings.IsWebMessageEnabled = true;
            Core.NavigationStarting += NavigationStarting;
            Core.NavigationCompleted += NavigationCompleted;
            Core.NewWindowRequested += NewWindow;
            Core.WindowCloseRequested += (_, __) => Close();
            Core.ProcessFailed += (_, __) => { owner.Protocol.Send(new { @event = "diagnostic", code = "process-failed" }); owner.Stop(); };
            if (isMain) Core.WebMessageReceived += PageMessage;
        }
        private void Document()
        {
            if (isMain) owner.Protocol.Send(new { @event = "document", generation, ready = Ready, url = NavigationPolicy.SafeLocation(Core.Source) });
        }
        private void NavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs args)
        {
            if (!NavigationPolicy.Allows(args.Uri, true)) { args.Cancel = true; return; }
            activeNavigation = args.NavigationId;
            if (navigationRequest != null && controlledNavigation == 0) controlledNavigation = args.NavigationId;
            replacing = false;
            Ready = false;
            generation++;
            Document();
            foreach (var id in evaluations.Keys.ToArray()) owner.Protocol.Reply(id, error: "stale-document");
            evaluations.Clear();
        }
        private void NavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs args)
        {
            if (args.NavigationId != activeNavigation || (replacing && args.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled)) return;
            Ready = args.IsSuccess;
            Document();
            if (navigationRequest != null && args.NavigationId == controlledNavigation)
            {
                owner.Protocol.Reply(navigationRequest, new { }, args.IsSuccess ? null : "navigation-failed");
                navigationRequest = null;
                controlledNavigation = 0;
                navigationDone?.TrySetResult(args.IsSuccess);
                navigationDone = null;
            }
            if (!args.IsSuccess) { owner.Protocol.Send(new { @event = "diagnostic", code = "navigation-failed" }); owner.Stop(); }
        }
        internal Task Navigate(string id, string address)
        {
            if (!NavigationPolicy.Allows(address, true) || navigationRequest != null)
            {
                owner.Protocol.Reply(id, error: "invalid-request");
                return Task.CompletedTask;
            }
            replacing = true;
            Core.Stop();
            navigationRequest = id;
            controlledNavigation = 0;
            navigationDone = new TaskCompletionSource<bool>();
            var task = navigationDone.Task;
            try { Core.Navigate(address); }
            catch
            {
                navigationRequest = null; navigationDone = null;
                owner.Protocol.Reply(id, error: "navigation-failed");
                return Task.CompletedTask;
            }
            return task;
        }
        internal async Task Evaluate(string id, string expression)
        {
            if (!Ready || !NavigationPolicy.IsMusicOrigin(Core.Source) || expression == null || Encoding.UTF8.GetByteCount(expression) > 100 * 1024)
            {
                owner.Protocol.Reply(id, error: "not-ready"); return;
            }
            if (evaluations.Count >= 24) { owner.Protocol.Reply(id, error: "busy"); return; }
            var bytes = new byte[16];
            using (var random = RandomNumberGenerator.Create()) random.GetBytes(bytes);
            var nonce = BitConverter.ToString(bytes).Replace("-", "");
            evaluations[id] = new Evaluation { Nonce = nonce, Generation = generation };
            var encode = new Func<object, string>(owner.Protocol.Encode);
            // ExecuteScriptAsync does not await JS promises. A nonce-bound result message resolves only this request.
            var script = "(async()=>{const p={channel:'folia-evaluation',id:" + encode(id) + ",nonce:" + encode(nonce) + "};"
                + "try{p.result=await (0,eval)(" + encode(expression) + ");p.completed=true;}catch{p.completed=false;}"
                + "window.chrome.webview.postMessage(p);})()";
            try { await Core.ExecuteScriptAsync(script); }
            catch
            {
                if (evaluations.Remove(id)) owner.Protocol.Reply(id, error: "evaluation-failed");
            }
        }
        private void PageMessage(object sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            if (!Ready || !NavigationPolicy.IsMusicOrigin(args.Source) || !NavigationPolicy.IsMusicOrigin(Core.Source)) return;
            try
            {
                if (args.WebMessageAsJson.Length > 8 * 1024 * 1024) return;
                var value = owner.Protocol.Decode(args.WebMessageAsJson);
                var id = JsonLineProtocol.Text(value, "id");
                if (JsonLineProtocol.Text(value, "channel") != "folia-evaluation" || id == null || !evaluations.TryGetValue(id, out var expected)
                    || expected.Generation != generation || JsonLineProtocol.Text(value, "nonce") != expected.Nonce) return;
                evaluations.Remove(id);
                if (value.TryGetValue("completed", out var completed) && completed is bool valid && valid)
                {
                    value.TryGetValue("result", out var result);
                    owner.Protocol.Reply(id, result);
                }
                else owner.Protocol.Reply(id, error: "evaluation-failed");
            }
            catch (ArgumentException) { }
        }
        // OAuth popups share the environment/profile and retain the same navigation restriction.
        private async void NewWindow(object sender, CoreWebView2NewWindowRequestedEventArgs args)
        {
            args.Handled = true;
            if (!NavigationPolicy.Allows(args.Uri, true) || !owner.WantsWindowsVisible || !owner.Windows.Any(window => window.Visible)) return;
            var deferral = args.GetDeferral();
            WebViewHost popup = null;
            try
            {
                popup = new WebViewHost(owner, false);
                owner.Windows.Add(popup);
                await popup.Initialize(Core.Environment);
                args.NewWindow = popup.Core;
                // A hide request may arrive while the popup is initializing.
                if (owner.WantsWindowsVisible) { popup.ShowInTaskbar = true; popup.Show(); popup.Activate(); }
            }
            catch { popup?.Close(); }
            finally { deferral.Complete(); }
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing) browser.Dispose();
            base.Dispose(disposing);
        }
    }
}
