// dev/dedicatus/checks/foreignCredentials.mjs
// D611：不读取、不解密别的应用在本机保存的 cookie、会话或密钥，也不加载别的应用自带的原生模块（#725：那是窃密软件的行为，
// 任何形式都不允许进仓库）。只看这次新增的行；合法地处理自家 safeStorage 不会命中这些词。命中由维护者确认后处理。

/** 新增的代码里出现这些写法就报。 */
export const FOREIGN_CREDENTIAL_PATTERNS = [
    { pattern: /CryptUnprotectData|ProtectedData\s*\]?\s*::\s*Unprotect|\bUnprotect\s*\(/, what: 'Windows DPAPI 解密' },
    { pattern: /\bos_crypt\b|encrypted_key/, what: 'Chromium 系浏览器的 cookie 加密密钥' },
    { pattern: /['"`]Local State['"`]/, what: 'Chromium 系浏览器的 Local State 文件' },
    { pattern: /(Google[\\/]+Chrome|Microsoft[\\/]+Edge|BraveSoftware|Mozilla[\\/]+Firefox|NetEase[\\/]+CloudMusic|Tencent[\\/]+QQMusic|KuGou)[\\/]+.*(User Data|Cookies|Network|Profiles)/i, what: '别的应用的数据目录' },
    { pattern: /require\(\s*['"`][^'"`]*(Program Files|AppData)[^'"`]*\.node['"`]\s*\)/i, what: '加载别的应用自带的原生模块' },
];

/**
 * 除了这个检查自己的文件（dev/dedicatus/）、测试和文档，全仓都查：原生代码（native/）、模组、脚本、工作流也一样
 * （#725：任何形式都不允许进仓库）。
 */
const UNCHECKED = /^(dev\/dedicatus|test|docs|plan)\/|\.md$/;

/**
 * @param {import('../diff.mjs').FileDiff[]} files parseDiff 的结果
 */
export function checkForeignCredentials(files) {
    const findings = [];
    for (const file of files) {
        if (!file.newPath || UNCHECKED.test(file.newPath)) continue;
        for (const entry of file.added) {
            const hit = FOREIGN_CREDENTIAL_PATTERNS.find(({ pattern }) => pattern.test(entry.text));
            if (!hit) continue;
            findings.push({
                code: 'D611',
                file: file.newPath,
                line: entry.newLine,
                message: `疑似读取别的应用的凭据（${hit.what}）：这类代码不允许进仓库（#725），确有误报请维护者确认`,
                key: `D611:${file.newPath}:${entry.newLine}`,
            });
        }
    }
    return findings;
}
