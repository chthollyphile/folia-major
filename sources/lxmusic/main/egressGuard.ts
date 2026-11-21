// sources/lxmusic/main/egressGuard.ts
// 受控出口的地址判定：一个主机名或一个解析出的 IP 是不是本机、内网或别的不该让第三方脚本碰到的去处。
// 纯函数，不联网、不读系统，egress.ts 在解析之后、连接之前拿它判，每一跳跳转都重新判。
//
// 没有拦 198.18.0.0/15：它是基准测试保留段，不通向本机或局域网；代理软件的 fake-ip 模式（TUN）把所有域名都
// 解析到这一段，拦了它这类环境下一个请求都发不出去。那种环境下解析结果只是代理的占位地址，按 IP 的判定
// 看不到真实去处，只剩下面主机名字面那一层（README 的「隔离」一节写了这一条）。

/** 一个去处被拦的原因；null 是放行。 */
export type EgressBlockReason =
    | 'loopback' | 'private' | 'link-local' | 'carrier-nat' | 'unspecified' | 'multicast' | 'reserved'
    | 'local-name' | 'invalid-address'
    // 下面三个是出口（egress.ts）按这台机器的情况加的：本机网卡自己的地址、网卡所在的在链子网、不许连的端口。
    | 'own-address' | 'on-link' | 'port';

const IPV4_PART = /^(?:0|[1-9]\d{0,2})$/;

/** 点分十进制的 IPv4 的四个字节；不是这种写法回 null（URL 解析器已经把十六进制、八进制、整数写法都化成它）。 */
export const parseIpv4 = (text: string): number[] | null => {
    const parts = text.split('.');
    if (parts.length !== 4) return null;
    const bytes = parts.map(part => (IPV4_PART.test(part) ? Number(part) : NaN));
    return bytes.every(byte => byte >= 0 && byte <= 255) ? bytes : null;
};

/** IPv6 的十六个字节（认 `::` 和末尾内嵌的 IPv4）；带区域标识（`%eth0`）或写错的回 null。 */
export const parseIpv6 = (text: string): number[] | null => {
    if (!/^[0-9a-fA-F:.]+$/.test(text) || !text.includes(':')) return null;
    let groups = text;
    let tail: number[] = [];
    const lastColon = text.lastIndexOf(':');
    if (text.includes('.')) {
        const v4 = parseIpv4(text.slice(lastColon + 1));
        if (!v4) return null;
        tail = v4;
        groups = text.slice(0, lastColon + 1);
        // `::1.2.3.4` 去掉 IPv4 之后剩 `::`，`1::1.2.3.4` 剩 `1::`，`1:2:3:4:5:6:1.2.3.4` 剩 `1:…:6:`。
        if (!groups.endsWith('::')) groups = groups.slice(0, -1);
    }
    const halves = groups.split('::');
    if (halves.length > 2) return null;
    const words = (part: string): number[] | null => {
        if (part === '') return [];
        const out: number[] = [];
        for (const piece of part.split(':')) {
            if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
            const value = parseInt(piece, 16);
            out.push(value >> 8, value & 0xff);
        }
        return out;
    };
    const head = words(halves[0]);
    const rest = halves.length === 2 ? words(halves[1]) : [];
    if (!head || !rest) return null;
    const fixed = head.length + rest.length + tail.length;
    if (halves.length === 2) {
        // `::` 至少代表一组零。
        if (fixed > 14) return null;
        return [...head, ...new Array<number>(16 - fixed).fill(0), ...rest, ...tail];
    }
    return fixed === 16 ? [...head, ...tail] : null;
};

const ipv4Reason = (bytes: readonly number[]): EgressBlockReason | null => {
    const [a, b, c] = bytes;
    if (a === 0) return 'unspecified';                              // 0.0.0.0/8：「本机」
    if (a === 127) return 'loopback';                               // 127.0.0.0/8
    if (a === 10) return 'private';                                 // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return 'private';          // 172.16.0.0/12
    if (a === 192 && b === 168) return 'private';                   // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return 'carrier-nat';     // 100.64.0.0/10（运营商 NAT、Tailscale）
    if (a === 169 && b === 254) return 'link-local';                // 169.254.0.0/16（含云元数据 169.254.169.254）
    if (a === 192 && b === 0 && c === 0) return 'reserved';         // 192.0.0.0/24
    if (a === 192 && b === 0 && c === 2) return 'reserved';         // 文档用
    if (a === 198 && b === 51 && c === 100) return 'reserved';      // 文档用
    if (a === 203 && b === 0 && c === 113) return 'reserved';       // 文档用
    if (a >= 224 && a <= 239) return 'multicast';                   // 224.0.0.0/4
    if (a >= 240) return 'reserved';                                // 240.0.0.0/4，含广播
    return null;
};

const ipv6Reason = (bytes: readonly number[]): EgressBlockReason | null => {
    const zero = (from: number, to: number) => bytes.slice(from, to).every(byte => byte === 0);
    const embedded = (at: number) => ipv4Reason(bytes.slice(at, at + 4));
    if (zero(0, 16)) return 'unspecified';                                          // ::
    if (zero(0, 15) && bytes[15] === 1) return 'loopback';                          // ::1
    // 里面包着一个 IPv4 的几种写法：按包着的那个地址判，判不出问题也不放（它们本身不该出现在公网去处里）。
    if (zero(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return embedded(12) ?? null;   // ::ffff:a.b.c.d
    if (zero(0, 12)) return embedded(12) ?? 'reserved';                             // ::a.b.c.d（已废弃）
    if (zero(0, 8) && bytes[8] === 0xff && bytes[9] === 0xff && zero(10, 12)) return embedded(12) ?? 'reserved'; // ::ffff:0:a.b.c.d
    if (bytes[0] === 0 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
        // 64:ff9b::/96（NAT64）按包着的 IPv4 判；64:ff9b:1::/48（本地用的 NAT64）一律拦。
        return zero(4, 12) ? embedded(12) : 'reserved';
    }
    if (bytes[0] === 0x20 && bytes[1] === 0x02) return embedded(2);                 // 2002::/16（6to4）
    if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0 && bytes[3] === 0) return 'reserved';     // 2001::/32（Teredo）
    if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return 'reserved'; // 文档用
    if (bytes[0] === 0x01 && bytes[1] === 0 && zero(2, 8)) return 'reserved';       // 100::/64（丢弃）
    if ((bytes[0] & 0xfe) === 0xfc) return 'private';                               // fc00::/7（ULA）
    if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return 'link-local';       // fe80::/10
    if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return 'private';          // fec0::/10（旧的站点本地）
    if (bytes[0] === 0xff) return 'multicast';                                      // ff00::/8
    return null;
};

/** 一个 IP（解析出来的，或者地址里直接写的）被拦的原因；不是 IP、带区域标识的算 `invalid-address`。 */
export const addressBlockReason = (address: string): EgressBlockReason | null => {
    const text = address.trim().replace(/^\[|\]$/g, '');
    const v4 = parseIpv4(text);
    if (v4) return ipv4Reason(v4);
    const v6 = parseIpv6(text);
    if (v6) return ipv6Reason(v6);
    return 'invalid-address';
};

/** 字面上就是 IP 的主机名（`[::1]`、`127.0.0.1`）。 */
export const isIpLiteral = (hostname: string): boolean => {
    const text = hostname.replace(/^\[|\]$/g, '');
    return parseIpv4(text) !== null || parseIpv6(text) !== null || text.includes('%');
};

// 只在本机或局域网里有意义的名字：解析之前就拦，解析结果是什么都不看。
const LOCAL_SUFFIXES = ['.localhost', '.local', '.localdomain', '.internal', '.intranet', '.lan', '.home', '.corp', '.home.arpa'];

/**
 * 一个主机名（URL 解析器给的，已经小写、IPv4 的怪写法已经化成点分十进制）字面上被拦的原因；null 是还要看它
 * 解析出什么。没有点的单段名字（`router`、`nas`）是局域网里的机器名，也拦。
 */
export const hostnameBlockReason = (hostname: string): EgressBlockReason | null => {
    const name = hostname.trim().toLowerCase().replace(/\.+$/, '');
    if (!name) return 'invalid-address';
    if (isIpLiteral(name)) return addressBlockReason(name);
    if (name === 'localhost' || LOCAL_SUFFIXES.some(suffix => name.endsWith(suffix))) return 'local-name';
    if (!name.includes('.')) return 'local-name';
    return null;
};
