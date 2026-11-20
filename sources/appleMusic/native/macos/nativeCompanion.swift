import AppKit
import Darwin
@preconcurrency import WebKit

// Native macOS host for the existing Apple Music companion protocol; credentials stay in WebKit.
@MainActor
final class NativeCompanion: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    private var windows: [NSWindow] = []
    private var webView: WKWebView!
    private var timer: Timer?
    private var pendingRead = false
    private var lastState = ""
    private var lastPosition = -1
    private var inputBuffer = Data()
    private var navigationRequest: (id: String, navigation: WKNavigation)?
    private var generation = 0
    private var documentReady = false
    private let probeMode = CommandLine.arguments.contains("--probe")
    private var lockDescriptor: Int32 = -1
    private let identifierPattern = "^[a-zA-Z0-9_-]{1,64}$"

    // Emit only fixed labels and sanitized playback facts, never URLs with queries or page exceptions.
    private func report(_ event: String, _ fields: [String: Any] = [:]) {
        var record = fields
        record["event"] = event
        guard JSONSerialization.isValidJSONObject(record), let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]),
              let line = String(data: data, encoding: .utf8) else { return }
        print((probeMode ? "[WKProbe] " : "") + line)
        fflush(stdout)
    }

    private func allowed(_ url: URL?) -> Bool {
        NativeNavigationPolicy.allows(url)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let configuration = WKWebViewConfiguration()
        if let profile = argument("--profile") {
            guard profile.hasPrefix("/") else { NSApp.terminate(nil); return }
            try? FileManager.default.createDirectory(atPath: profile, withIntermediateDirectories: true)
            lockDescriptor = open(profile + "/native.lock", O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
            guard lockDescriptor >= 0, flock(lockDescriptor, LOCK_EX | LOCK_NB) == 0 else {
                report("profile-in-use"); NSApp.terminate(nil); return
            }
        }
        // macOS 14+ named stores isolate this probe from Safari, Folia and the CastLabs companion.
        let storeID = argument("--store") ?? "7C054D2C-EA13-4D24-A65B-4735EA99FA26"
        guard let storeUUID = UUID(uuidString: storeID) else { NSApp.terminate(nil); return }
        configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: storeUUID)
        configuration.mediaTypesRequiringUserActionForPlayback = []
        webView = makeWebView(configuration)
        showWindow(webView, visible: probeMode)
        webView.load(URLRequest(url: URL(string: "https://music.apple.com/")!))
        // stdin is a bounded local control channel; no arbitrary JavaScript or filesystem operations.
        FileHandle.standardInput.readabilityHandler = { [weak self] handle in
            let bytes = handle.availableData
            if bytes.isEmpty {
                handle.readabilityHandler = nil
                Task { @MainActor [weak self] in if self?.probeMode == false { NSApp.terminate(nil) } }
                return
            }
            Task { @MainActor [weak self] in self?.receive(bytes) }
        }
        if probeMode { timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.readStatus() }
        }
        }
        report("started", ["engine": "WKWebView", "system": ProcessInfo.processInfo.operatingSystemVersionString])
    }

    private func makeWebView(_ configuration: WKWebViewConfiguration) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        return view
    }

    private func showWindow(_ view: WKWebView, visible: Bool = true) {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1120, height: 760),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Folia Apple Music"
        window.contentView = view
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()
        windows.append(window)
        if visible {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func webView(_ view: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let permitted = allowed(action.request.url) || action.request.url?.absoluteString == "about:blank"
        if !permitted { report("navigation-blocked", ["host": action.request.url?.host ?? "non-https"]) }
        decisionHandler(permitted ? .allow : .cancel)
    }

    // Authentication popups use WebKit's supplied related configuration and the same navigation policy.
    func webView(_ view: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard allowed(action.request.url) || action.request.url?.absoluteString == "about:blank" else {
            report("popup-blocked"); return nil
        }
        guard windows.contains(where: { $0.isVisible }) else { report("background-popup-blocked"); return nil }
        let popup = makeWebView(configuration)
        showWindow(popup)
        return popup
    }

    func webViewDidClose(_ view: WKWebView) {
        windows.first(where: { $0.contentView === view })?.close()
    }

    // Document generations let the parent discard in-flight results after a real navigation.
    func webView(_ view: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if view === webView { generation += 1; documentReady = false; reportDocument() }
    }

    private func reportDocument() {
        var location = "about:blank"
        if let url = webView.url, var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            parts.query = nil
            parts.fragment = nil
            parts.user = nil
            parts.password = nil
            location = parts.string ?? "about:blank"
        }
        report("document", ["generation": generation, "url": location, "ready": documentReady])
    }

    func webView(_ view: WKWebView, didFinish navigation: WKNavigation!) {
        guard view === webView else { return }
        documentReady = true
        reportDocument()
        if let request = navigationRequest, request.navigation === navigation { navigationRequest = nil; reply(request.id, data: [:]) }
        if probeMode { readStatus() }
    }

    func webView(_ view: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        navigationFailed(view, navigation: navigation, error: error)
    }

    func webView(_ view: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        navigationFailed(view, navigation: navigation, error: error)
    }

    private func navigationFailed(_ view: WKWebView, navigation: WKNavigation?, error: Error) {
        guard view === webView else { return }
        // A replacement load can cancel the previous navigation after the new one was queued.
        if (error as NSError).code == NSURLErrorCancelled { return }
        if let request = navigationRequest, request.navigation === navigation {
            navigationRequest = nil
            reply(request.id, error: "navigation-failed")
        }
        report("navigation-failed")
        // Let the parent restart a failed main document rather than leaving an endless not-ready page.
        NSApp.terminate(nil)
    }

    func webViewWebContentProcessDidTerminate(_ view: WKWebView) {
        report("web-process-terminated", ["main": view === webView])
        if view === webView { NSApp.terminate(nil) }
    }

    private func argument(_ key: String) -> String? {
        let prefix = key + "="
        return CommandLine.arguments.first(where: { $0.hasPrefix(prefix) }).map { String($0.dropFirst(prefix.count)) }
    }

    private func reply(_ id: String, data: Any? = nil, error: String? = nil) {
        var result: [String: Any] = ["id": id, "ok": error == nil]
        if let error { result["error"] = error }
        else { result["data"] = data ?? NSNull() }
        guard JSONSerialization.isValidJSONObject(result), let bytes = try? JSONSerialization.data(withJSONObject: result),
              let line = String(data: bytes, encoding: .utf8) else { return }
        print(line)
        fflush(stdout)
    }

    // Poll only non-sensitive facts from the music origin; no tokens, song titles, lyrics or response bodies.
    private func readStatus() {
        guard !pendingRead, webView.url?.host == "music.apple.com" else { return }
        pendingRead = true
        let script = """
        const mk = window.MusicKit?.getInstance?.();
        if (!mk) return {ready:false};
        const item = mk.nowPlayingItem;
        const audio = document.querySelector('audio,video');
        return {ready:true, authorized:mk.isAuthorized===true, playing:mk.isPlaying===true,
            state:Number.isInteger(mk.playbackState)?mk.playbackState:-1,
            time:Number.isFinite(mk.currentPlaybackTime)?Math.floor(mk.currentPlaybackTime):0,
            duration:Number.isFinite(item?.attributes?.durationInMillis)?Math.floor(item.attributes.durationInMillis/1000):0,
            hasTrack:!!item, mediaError:Number.isInteger(audio?.error?.code)?audio.error.code:0,
            eme:typeof navigator.requestMediaKeySystemAccess==='function',
            legacyFairPlay:!!(window.WebKitMediaKeys?.isTypeSupported?.('com.apple.fps.1_0','video/mp4'))};
        """
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.pendingRead = false }
            do {
                let value = try await self.webView.callAsyncJavaScript(script, arguments: [:], in: nil, contentWorld: .page)
                guard let facts = value as? [String: Any] else { return }
                let position = facts["time"] as? Int ?? -1
                var state = facts
                state.removeValue(forKey: "time")
                let key = String(data: (try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys])) ?? Data(), encoding: .utf8) ?? ""
                if key != self.lastState || (position != self.lastPosition && position % 5 == 0) {
                    self.report("playback", facts)
                    self.lastState = key
                    self.lastPosition = position
                }
            } catch {
                // Exceptions may contain remote data, so retain only the native error's numeric code.
                self.report("status-unavailable", ["code": (error as NSError).code])
            }
        }
    }

    // Only the parent-owned stdin can evaluate a script; Folia's renderer still sends validated operations.
    private func receive(_ bytes: Data) {
        inputBuffer.append(bytes)
        guard inputBuffer.count <= 1024 * 1024 else { NSApp.terminate(nil); return }
        while let newline = inputBuffer.firstIndex(of: 10) {
            let line = Data(inputBuffer[..<newline])
            inputBuffer.removeSubrange(...newline)
            guard line.count <= 128 * 1024, let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
                  let operation = object["operation"] as? String else { report("invalid-control"); continue }
            if probeMode && object["id"] == nil {
                switch operation {
                case "status": readStatus()
                case "hide": windows.forEach { $0.orderOut(nil) }; report("hidden")
                case "show": windows.forEach { $0.makeKeyAndOrderFront(nil) }; NSApp.activate(ignoringOtherApps: true); report("shown")
                case "quit": NSApp.terminate(nil)
                default: report("invalid-control")
                }
                continue
            }
            guard let id = object["id"] as? String, id.range(of: identifierPattern, options: .regularExpression) != nil else { continue }
            switch operation {
            case "show": windows.forEach { $0.makeKeyAndOrderFront(nil) }; NSApp.activate(ignoringOtherApps: true); reply(id, data: [:])
            case "hide": windows.forEach { $0.orderOut(nil) }; reply(id, data: [:])
            case "navigate":
                guard let address = object["url"] as? String, let url = URL(string: address),
                      allowed(url) || address == "about:blank", navigationRequest == nil else { reply(id, error: "invalid-request"); continue }
                webView.stopLoading()
                if let navigation = webView.load(URLRequest(url: url)) {
                    navigationRequest = (id, navigation)
                } else { reply(id, error: "navigation-failed") }
            case "evaluate":
                guard documentReady, webView.url?.scheme == "https", webView.url?.host == "music.apple.com",
                      let expression = object["expression"] as? String, expression.utf8.count <= 100 * 1024 else { reply(id, error: "not-ready"); continue }
                let document = generation
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    do {
                        let value = try await self.webView.callAsyncJavaScript("return await (0, eval)(expression);", arguments: ["expression": expression], in: nil, contentWorld: .page)
                        guard document == self.generation else { self.reply(id, error: "stale-document"); return }
                        self.reply(id, data: value)
                    } catch { self.reply(id, error: "evaluation-failed") }
                }
            case "clear":
                guard webView.url?.absoluteString == "about:blank" else { reply(id, error: "invalid-request"); continue }
                for popup in windows.dropFirst() { popup.close() }
                let store = webView.configuration.websiteDataStore
                store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: Date.distantPast) { [weak self] in
                    self?.reply(id, data: [:])
                }
            default: reply(id, error: "invalid-request")
            }
        }
    }

    func windowWillClose(_ notification: Notification) {
        guard let window = notification.object as? NSWindow else { return }
        if window.contentView === webView { NSApp.terminate(nil) }
        else { windows.removeAll { $0 === window } }
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        FileHandle.standardInput.readabilityHandler = nil
        if lockDescriptor >= 0 { flock(lockDescriptor, LOCK_UN); close(lockDescriptor) }
    }
}

@main
struct ProbeLauncher {
    @MainActor static func main() {
        let application = NSApplication.shared
        let delegate = NativeCompanion()
        application.delegate = delegate
        withExtendedLifetime(delegate) { application.run() }
    }
}
