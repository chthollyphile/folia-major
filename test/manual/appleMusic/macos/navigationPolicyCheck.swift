import Foundation

// Exercise the actual native navigation predicate without opening a browser or reading a session.
@main
struct NavigationPolicyCheck {
    static func main() {
        let allowed = ["https://music.apple.com/cn/", "https://account.apple.com/", "https://idmsa.apple.com/", "https://appleid.apple.com/", "https://authorize.music.apple.com/", "https://music.apple.com:443/"]
        let rejected = ["http://music.apple.com/", "https://music.apple.com.evil.test/", "https://evil.test/?music.apple.com", "https://user:password@music.apple.com/", "https://music.apple.com:444/", "file:///tmp/test.html", "javascript:alert(1)", "about:blank"]
        for address in allowed { precondition(NativeNavigationPolicy.allows(URL(string: address)), "Expected allowed host") }
        for address in rejected { precondition(!NativeNavigationPolicy.allows(URL(string: address)), "Expected blocked navigation") }
        precondition(!NativeNavigationPolicy.allows(nil))
        print("PASS: 15 native navigation policy cases")
    }
}
