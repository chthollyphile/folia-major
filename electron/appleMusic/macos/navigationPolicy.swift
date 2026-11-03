import Foundation

// Keep the system WebView on the music page and Apple's explicit sign-in hosts.
enum NativeNavigationPolicy {
    private static let hosts = ["music.apple.com", "account.apple.com", "appleid.apple.com", "idmsa.apple.com"]

    static func allows(_ url: URL?) -> Bool {
        guard let url, url.scheme == "https", url.user == nil, url.password == nil,
              url.port == nil || url.port == 443, let host = url.host?.lowercased() else { return false }
        return hosts.contains { host == $0 || host.hasSuffix("." + $0) }
    }
}
