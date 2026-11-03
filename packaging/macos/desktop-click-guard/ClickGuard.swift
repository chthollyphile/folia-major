// packaging/macos/desktop-click-guard/ClickGuard.swift
// libfolia_click_guard.dylib: macOS wallpaper mode with Stage Manager on (issue #698).
//
// Folia's wallpaper sits below the Finder icons, so a click on it is a click on Finder's desktop,
// and with Stage Manager on that sends the stage aside. Folia's own listen-only tap still forwards
// the click into the wallpaper (electron/wallpaper/macWallpaperController.cjs); this library only
// keeps Finder from getting it: an active session tap swallows a left-button gesture (down, drags,
// up) that starts on the bare desktop inside the wallpaper's region. Everything else passes
// untouched: clicks on desktop icons and their names, on any window, outside the region, and any
// right button. Measured on macOS 15.3 with Stage Manager on: a swallowed desktop click leaves the
// stage alone, an unswallowed one sends it aside (2026-10-19).
//
// Loaded into Folia's main process through koffi (electron/wallpaper/macDesktopClickGuard.cjs), so
// the Accessibility grant an active tap needs is Folia's own: macOS judged a helper process Folia
// spawned by the helper's own identity, untrusted (measured 2026-10-19). Unlike PR #709 (a tap in a
// koffi worker calling back into JavaScript), the tap lives on its own native thread with its own
// run loop and decides in native code: no JavaScript on the click path. stop() disables and
// removes the tap and ends the thread; the system drops it with the process anyway.
// Fail-open: when a check cannot answer (window list or Accessibility query failing or slow), the
// click passes to Finder as it would without this library.
//
// C entry points (all callable from any thread):
//   int32 folia_click_guard_start(void)   0 running, 3 no Accessibility grant, 4 tap not created
//   void  folia_click_guard_set_region(double x, double y, double w, double h)  global top-left points
//   void  folia_click_guard_clear_region(void)
//   void  folia_click_guard_stop(void)
//   bool  folia_click_guard_trusted(void)          AXIsProcessTrusted
//   void  folia_click_guard_request_access(void)   shows macOS' Accessibility prompt for Folia

import Cocoa

// Shared state, behind `GuardState.lock`. A library has no top-level code, so it lives in one place.
private enum GuardState {
    static let lock = NSLock()
    static var region: CGRect? // the wallpaper's frame; nil passes everything
    static var tapThread: Thread?
    static var tapRunLoop: CFRunLoop?
    static var tapPort: CFMachPort?
    static var tapSource: CFRunLoopSource?
    static var swallowing = false // touched on the tap thread only
    static var iconCells: [CGRect] = []
    static var finderPid: pid_t = 0 // set by refreshIconCells
    static var dockPid: pid_t = 0 // looked up by onDock
    static var iconTimer: DispatchSourceTimer?
    static let desktopLayer = Int(CGWindowLevelForKey(.desktopIconWindow))
    // Where WindowServer lists Folia's own simple-full-screen wallpaper presentation (the
    // controller's FULLSCREEN_PRESENTATION_LAYER).
    static let presentationLayer = 101

    static func currentRegion() -> CGRect? { lock.lock(); defer { lock.unlock() }; return region }
}

private func bundleId(of pid: pid_t) -> String? { NSRunningApplication(processIdentifier: pid)?.bundleIdentifier }

private func displayFrame(containing p: CGPoint) -> CGRect? {
    var ids = [CGDirectDisplayID](repeating: 0, count: 8)
    var count: UInt32 = 0
    guard CGGetDisplaysWithPoint(p, 8, &ids, &count) == .success, count > 0 else { return nil }
    return CGDisplayBounds(ids[0])
}

private func spansDisplay(_ b: CGRect, _ frame: CGRect?) -> Bool {
    guard let f = frame else { return true }
    let slop: CGFloat = 4
    return b.minX <= f.minX + slop && b.minY <= f.minY + slop && b.maxX >= f.maxX - slop && b.maxY >= f.maxY - slop
}

// Is the topmost surface under the point the bare desktop (Finder's or Stage Manager's full-display
// desktop window)? Same rules as isDesktopPoint in macWallpaperController.cjs: transparent surfaces
// at desktop-adjacent layers and the Dock's full-display tracking surface do not count as covering.
// Folia's own windows above the desktop (its click catchers) do cover: Folia handles those clicks.
private func bareDesktopUnder(_ p: CGPoint) -> Bool {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else { return false }
    let frame = displayFrame(containing: p)
    for w in list {
        guard let layer = w[kCGWindowLayer as String] as? Int, layer >= GuardState.desktopLayer else { continue }
        guard let bd = w[kCGWindowBounds as String] as? NSDictionary,
              let b = CGRect(dictionaryRepresentation: bd), b.contains(p) else { continue }
        let alpha = w[kCGWindowAlpha as String] as? Double ?? 1
        if layer < 0 && alpha <= 0 { continue }
        let pid = pid_t(w[kCGWindowOwnerPID as String] as? Int ?? 0)
        // Folia's own wallpaper in its simple-full-screen presentation spans the display; it is the
        // wallpaper, not a window over it (same skip as the controller's isDesktopPoint).
        if pid == getpid() && layer >= GuardState.presentationLayer { continue }
        if layer == GuardState.desktopLayer { return spansDisplay(b, frame) }
        if layer <= 20 && spansDisplay(b, frame) && bundleId(of: pid) == "com.apple.dock" { continue }
        return false // an app window, the Dock, a widget or one of Folia's own catchers
    }
    return false
}

private func axAttr(_ e: AXUIElement, _ name: String) -> CFTypeRef? {
    var v: CFTypeRef?
    return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil
}

private func axFrame(_ e: AXUIElement) -> CGRect? {
    // Checked casts only: this runs inside Folia, so a trap here would take the app down.
    guard let pv = axAttr(e, kAXPositionAttribute), CFGetTypeID(pv) == AXValueGetTypeID(),
          let sv = axAttr(e, kAXSizeAttribute), CFGetTypeID(sv) == AXValueGetTypeID() else { return nil }
    var p = CGPoint.zero, s = CGSize.zero
    guard AXValueGetValue(unsafeBitCast(pv, to: AXValue.self), .cgPoint, &p),
          AXValueGetValue(unsafeBitCast(sv, to: AXValue.self), .cgSize, &s) else { return nil }
    return CGRect(origin: p, size: s)
}

// Finder's desktop is an AXScrollArea spanning a display, holding an AXGroup of AXImage icons (the
// image's frame only). The name below an icon selects it too, so each cell grows to take it in.
private func refreshIconCells() {
    guard let finder = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.finder").first else { return }
    let app = AXUIElementCreateApplication(finder.processIdentifier)
    AXUIElementSetMessagingTimeout(app, 0.3)
    GuardState.lock.lock(); GuardState.finderPid = finder.processIdentifier; GuardState.lock.unlock()
    var cells: [CGRect] = []
    for child in (axAttr(app, kAXChildrenAttribute) as? [AXUIElement]) ?? [] {
        guard axAttr(child, kAXRoleAttribute) as? String == kAXScrollAreaRole else { continue }
        for group in (axAttr(child, kAXChildrenAttribute) as? [AXUIElement]) ?? [] {
            for icon in (axAttr(group, kAXChildrenAttribute) as? [AXUIElement]) ?? [] {
                guard let f = axFrame(icon) else { continue }
                cells.append(CGRect(x: f.minX - 24, y: f.minY - 4, width: f.width + 48, height: f.height + 48))
            }
        }
    }
    GuardState.lock.lock(); GuardState.iconCells = cells; GuardState.lock.unlock()
}

private func onIcon(_ p: CGPoint) -> Bool {
    GuardState.lock.lock(); let cells = GuardState.iconCells; let finderPid = GuardState.finderPid; GuardState.lock.unlock()
    if cells.contains(where: { $0.contains(p) }) { return true }
    // The cells may be a moment old (an icon just moved or appeared): ask Finder directly. The
    // short timeout goes on Finder's element and the hit element only: on the system-wide element
    // it would become the whole process's default.
    guard finderPid > 0 else { return true } // no answer: let Finder have the click
    let finder = AXUIElementCreateApplication(finderPid)
    AXUIElementSetMessagingTimeout(finder, 0.05)
    var element: AXUIElement?
    guard AXUIElementCopyElementAtPosition(finder, Float(p.x), Float(p.y), &element) == .success, let e = element else {
        return true
    }
    AXUIElementSetMessagingTimeout(e, 0.05)
    let role = axAttr(e, kAXRoleAttribute) as? String
    return role != kAXGroupRole && role != kAXScrollAreaRole
}

// Is the point on the Dock? The Dock is listed as one full-display surface in every state, so the
// window list cannot place its bar; its own Accessibility hit test can (an AXDockItem or the
// AXList on the bar; off the bar it answers no value). Measured 2026-10-19: a click on a Dock icon
// otherwise read as bare desktop and was swallowed whenever only that surface was listed.
private func onDock(_ p: CGPoint) -> Bool {
    GuardState.lock.lock(); var dockPid = GuardState.dockPid; GuardState.lock.unlock()
    if dockPid <= 0 {
        guard let dock = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dock").first else { return false }
        dockPid = dock.processIdentifier
        GuardState.lock.lock(); GuardState.dockPid = dockPid; GuardState.lock.unlock()
    }
    let dock = AXUIElementCreateApplication(dockPid)
    AXUIElementSetMessagingTimeout(dock, 0.05)
    var element: AXUIElement?
    switch AXUIElementCopyElementAtPosition(dock, Float(p.x), Float(p.y), &element) {
    case .success: return element != nil
    case .noValue: return false
    case .invalidUIElement, .cannotComplete:
        // The Dock restarted (a new pid) or did not answer in time: look it up again next time,
        // and let this click through.
        GuardState.lock.lock(); GuardState.dockPid = 0; GuardState.lock.unlock()
        return true
    default: return true
    }
}

// Swallow the gesture if it starts on the bare desktop inside the wallpaper, off any icon.
// Ctrl-click is the secondary click: it passes, so the desktop's menu still opens.
private func shouldSwallow(_ event: CGEvent) -> Bool {
    let p = event.location
    guard let r = GuardState.currentRegion(), r.contains(p) else { return false }
    if event.flags.contains(.maskControl) { return false }
    guard bareDesktopUnder(p) else { return false }
    if onDock(p) { return false }
    return !onIcon(p)
}

private let tapCallback: CGEventTapCallBack = { _, type, event, _ in
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        GuardState.lock.lock(); let port = GuardState.tapPort; GuardState.lock.unlock()
        if let port = port { CGEvent.tapEnable(tap: port, enable: true) }
    case .leftMouseDown:
        GuardState.swallowing = shouldSwallow(event)
        if GuardState.swallowing { return nil }
    case .leftMouseDragged:
        if GuardState.swallowing { return nil }
    case .leftMouseUp:
        if GuardState.swallowing {
            GuardState.swallowing = false
            return nil
        }
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

@_cdecl("folia_click_guard_trusted")
public func foliaClickGuardTrusted() -> Bool { AXIsProcessTrusted() }

@_cdecl("folia_click_guard_request_access")
public func foliaClickGuardRequestAccess() {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
}

@_cdecl("folia_click_guard_set_region")
public func foliaClickGuardSetRegion(_ x: Double, _ y: Double, _ w: Double, _ h: Double) {
    GuardState.lock.lock(); GuardState.region = CGRect(x: x, y: y, width: w, height: h); GuardState.lock.unlock()
}

@_cdecl("folia_click_guard_clear_region")
public func foliaClickGuardClearRegion() {
    GuardState.lock.lock(); GuardState.region = nil; GuardState.lock.unlock()
}

@_cdecl("folia_click_guard_start")
public func foliaClickGuardStart() -> Int32 {
    GuardState.lock.lock()
    let running = GuardState.tapThread != nil
    GuardState.lock.unlock()
    if running { return 0 }
    guard AXIsProcessTrusted() else { return 3 }

    let mask: CGEventMask = (1 << CGEventType.leftMouseDown.rawValue)
        | (1 << CGEventType.leftMouseUp.rawValue)
        | (1 << CGEventType.leftMouseDragged.rawValue)
    // Tail of the session taps: Folia's listen-only tap (head-inserted) still sees the click first
    // and forwards it into the wallpaper; nothing after this tap (Finder) does.
    guard let port = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .defaultTap,
                                       eventsOfInterest: mask, callback: tapCallback, userInfo: nil) else {
        return 4
    }
    let source = CFMachPortCreateRunLoopSource(nil, port, 0)
    let ready = DispatchSemaphore(value: 0)
    let thread = Thread {
        let runLoop = CFRunLoopGetCurrent()
        GuardState.lock.lock(); GuardState.tapRunLoop = runLoop; GuardState.lock.unlock()
        CFRunLoopAddSource(runLoop, source, .commonModes)
        CGEvent.tapEnable(tap: port, enable: true)
        ready.signal()
        CFRunLoopRun() // until stop() stops it
    }
    thread.name = "folia-click-guard"
    thread.qualityOfService = .userInteractive
    GuardState.lock.lock()
    GuardState.tapThread = thread
    GuardState.tapPort = port
    GuardState.tapSource = source
    GuardState.lock.unlock()
    thread.start()
    ready.wait()

    // Icons move, appear and go rarely; a slow refresh off the event path keeps the cells current.
    // A full Finder read took ~239 ms (measured 2026-10-19), so it stays rare: onIcon's hit test
    // covers an icon the cells have not caught up with.
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
    timer.schedule(deadline: .now(), repeating: 12, leeway: .seconds(2))
    timer.setEventHandler { if GuardState.currentRegion() != nil { refreshIconCells() } }
    timer.resume()
    GuardState.lock.lock(); GuardState.iconTimer = timer; GuardState.lock.unlock()
    return 0
}

@_cdecl("folia_click_guard_stop")
public func foliaClickGuardStop() {
    GuardState.lock.lock()
    let port = GuardState.tapPort, source = GuardState.tapSource
    let runLoop = GuardState.tapRunLoop, timer = GuardState.iconTimer
    GuardState.tapPort = nil
    GuardState.tapSource = nil
    GuardState.tapRunLoop = nil
    GuardState.tapThread = nil
    GuardState.iconTimer = nil
    GuardState.iconCells = []
    GuardState.lock.unlock()
    timer?.cancel()
    if let port = port {
        CGEvent.tapEnable(tap: port, enable: false)
        if let runLoop = runLoop, let source = source { CFRunLoopRemoveSource(runLoop, source, .commonModes) }
        CFMachPortInvalidate(port)
    }
    if let runLoop = runLoop { CFRunLoopStop(runLoop) }
}
