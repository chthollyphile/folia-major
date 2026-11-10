using System;

// Keep WebView2 navigations on the same Apple host allowlist as the existing companion.
namespace Folia.AppleMusic
{
    internal static class NavigationPolicy
    {
        private static readonly string[] Hosts = { "music.apple.com", "account.apple.com", "appleid.apple.com", "idmsa.apple.com" };
        internal static bool Allows(string address, bool allowBlank = false)
        {
            if (allowBlank && address == "about:blank") return true;
            if (!Uri.TryCreate(address, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.UserInfo.Length != 0 || uri.Port != 443) return false;
            foreach (var host in Hosts)
                if (uri.Host.Equals(host, StringComparison.OrdinalIgnoreCase) || uri.Host.EndsWith("." + host, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }
        internal static bool IsMusicOrigin(string address) => Uri.TryCreate(address, UriKind.Absolute, out var uri)
            && uri.Scheme == "https" && uri.Host.Equals("music.apple.com", StringComparison.OrdinalIgnoreCase) && uri.Port == 443 && uri.UserInfo.Length == 0;
        internal static string SafeLocation(string address) => Uri.TryCreate(address, UriKind.Absolute, out var uri) && uri.Scheme == "https"
            ? uri.GetLeftPart(UriPartial.Path) : "about:blank";
    }
}
