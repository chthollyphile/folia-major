const { execFileSync } = require('node:child_process');
const { existsSync, readdirSync } = require('node:fs');
const path = require('node:path');

// electron/soda/clientPath.cjs
//
// 找汽水音乐客户端装在哪。默认位置之外的安装（换盘、绿色版、自定义目录）靠这几层：
//   1. 环境变量 FOLIA_SODA_CLIENT_DIR（目录本身，或 SodaMusic.exe 所在目录，或含版本号的上一级）
//   2. 正在运行的 SodaMusic.exe 的路径（进程自己最清楚）
//   3. 注册表的卸载项（安装器一般会写 InstallLocation / DisplayIcon）
//   4. 几个常见默认位置
// 结果按进程缓存；找不到返回空数组，调用方自己决定怎么提示。

const EXE_NAME = 'SodaMusic.exe';
const MODULE_RELATIVE = path.join('resources', 'app.asar.unpacked', 'bdms.node');

let cachedRoots = null;

const runPowerShell = (script) => {
    try {
        const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            timeout: 10000,
            windowsHide: true,
        });
        return String(out || '').trim();
    } catch {
        return '';
    }
};

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * 在一个候选根目录里找 bdms.node，返回 { modulePath, version }。
 * 兼容三种布局：
 *   <root>/resources/app.asar.unpacked/bdms.node
 *   <root>/<版本>/resources/app.asar.unpacked/bdms.node
 *   以上两种之外，再往下找两层（有的安装器会把 app.asar.unpacked 放在别处）
 */
const locateIn = (dir) => {
    if (!dir || !existsSync(dir)) return null;
    const direct = path.join(dir, MODULE_RELATIVE);
    if (existsSync(direct)) return { modulePath: direct, version: '' };
    let children = [];
    try {
        children = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
        return null;
    }
    // 版本目录优先，按数字排，取最新
    const versions = children.filter((name) => SEMVER.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) {
        const candidate = path.join(dir, version, MODULE_RELATIVE);
        if (existsSync(candidate)) return { modulePath: candidate, version };
    }
    // 其他名字的目录：只再找一层，别扫整个磁盘
    for (const name of children) {
        const candidate = path.join(dir, name, MODULE_RELATIVE);
        if (existsSync(candidate)) return { modulePath: candidate, version: SEMVER.test(name) ? name : '' };
    }
    return null;
};

const hasBdms = (dir) => Boolean(locateIn(dir));

const expandRoot = (candidate) => {
    const dir = String(candidate || '').trim();
    if (!dir) return [];
    // 给的可能是 exe 本身，也可能是 exe 所在目录。
    const base = dir.toLowerCase().endsWith('.exe') ? path.dirname(dir) : dir;
    return [base, path.dirname(base)];
};

const fromEnv = () => expandRoot(process.env.FOLIA_SODA_CLIENT_DIR);

const fromRunningProcess = () => {
    const exe = runPowerShell(
        `Get-Process -Name SodaMusic -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path`,
    );
    return expandRoot(exe);
};

const fromRegistry = () => {
    const raw = runPowerShell([
        `$keys = @(`,
        `  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',`,
        `  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',`,
        `  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'`,
        `)`,
        `Get-ItemProperty $keys -ErrorAction SilentlyContinue`,
        `  | Where-Object { $_.DisplayName -match 'Soda|汽水' }`,
        `  | ForEach-Object { $_.InstallLocation; $_.DisplayIcon }`,
        `  | Where-Object { $_ }`,
    ].join(' '));
    return raw.split(/\r?\n/).flatMap((line) => expandRoot(line.replace(/^"|"$/g, '').replace(/,\d+$/, '')));
};

const fromDefaults = () => [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Soda Music'),
    path.join(process.env.LOCALAPPDATA || '', 'Soda Music'),
    path.join(process.env.PROGRAMFILES || '', 'Soda Music'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Soda Music'),
];

/** 可能装着客户端的目录，按可信度排序、去重、只留确实有 bdms.node 的。 */
function findClientRoots() {
    if (cachedRoots) return cachedRoots;
    const seen = new Set();
    const roots = [];
    for (const dir of [...fromEnv(), ...fromRunningProcess(), ...fromRegistry(), ...fromDefaults()]) {
        if (!dir || seen.has(dir)) continue;
        seen.add(dir);
        if (hasBdms(dir)) roots.push(dir);
    }
    cachedRoots = roots;
    return roots;
}

/** 客户端数据目录（cookie 库那边用）：默认两个之外，再看进程有没有带 --user-data-dir。 */
function findUserDataDirs() {
    const dirs = [];
    const push = (dir) => {
        const value = String(dir || '').trim();
        if (value && !dirs.includes(value)) dirs.push(value);
    };
    const commandLine = runPowerShell(
        `Get-CimInstance Win32_Process -Filter "Name='SodaMusic.exe'" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty CommandLine`,
    );
    const explicit = /--user-data-dir=(?:"([^"]+)"|(\S+))/i.exec(commandLine);
    if (explicit) push(explicit[1] || explicit[2]);
    push(process.env.FOLIA_SODA_USER_DATA_DIR);
    push(path.join(process.env.APPDATA || '', 'SodaMusic'));
    push(path.join(process.env.APPDATA || '', 'luna_pc'));
    push(path.join(process.env.LOCALAPPDATA || '', 'SodaMusic'));
    return dirs.filter((dir) => existsSync(dir));
}

/** 找到的 bdms.node 与它所属的版本号（拿不到就是空串）。 */
let cachedModule = null;
function findBdmsModule() {
    if (cachedModule) return cachedModule;
    const envDir = String(process.env.FOLIA_SODA_CLIENT_DIR || '').trim();
    if (envDir) {
        const fromEnv = locateIn(envDir.toLowerCase().endsWith('.exe') ? path.dirname(envDir) : envDir);
        if (fromEnv) { cachedModule = fromEnv; return cachedModule; }
    }
    for (const root of findClientRoots()) {
        const found = locateIn(root);
        if (found) { cachedModule = found; return cachedModule; }
    }
    cachedModule = { modulePath: '', version: '' };
    return cachedModule;
}

module.exports = { findClientRoots, findUserDataDirs, findBdmsModule, hasBdms, EXE_NAME };
