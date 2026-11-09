// dev/dedicatus/checks/foliumApi.mjs
// D513：同一个 Folium 大版本里，非实验性接口只加不改（#440、#429、#567）。拿 diff 看生成的 mods/folium.d.ts：
// 稳定部分有删除或改写的行、而大版本（electron/modSystem/foliumShared.json 的 version.major）没变，报 error；
// 稳定部分有新增的行、而小版本没变，也报 error（新增稳定接口要升 minor）。注释的改动不算；实验部分
// （“---- Experimental”一节，以及文档注释带实验标记的声明或成员，见 experimentalLines）不受限。

export const FOLIUM_TYPES = 'mods/folium.d.ts';
export const FOLIUM_VERSION_FILE = 'electron/modSystem/foliumShared.json';

const isComment = text => /^\s*(\/\/|\/\*|\*)/.test(text) || text.trim() === '';

/** 文档注释里的实验标记：EXPERIMENTAL，或者 “(experimental, `omni.hooks`)” 这样的括注；只是提到 experimental 这个词的不算。 */
const EXPERIMENTAL_MARK = /EXPERIMENTAL|\(experimental\b/;

/**
 * 每一行是不是实验部分：在 Experimental 一节里；或者属于一条文档注释带实验标记的声明或成员，
 * 从那段注释一直到它结束（同一层的 `;`、`,`、`}` 结尾）；或者在这样一条声明的花括号里面（里面的成员各有自己的
 * 文档注释也一样）。
 * @param {string} text
 * @returns {boolean[]} 下标从 1 起（第 0 项不用）
 */
export function experimentalLines(text) {
    const flags = [false];
    /** 每一层花括号是不是实验的；第 0 层是文件顶层。 */
    const scopes = [false];
    let section = false;
    let inDoc = false;
    let docIsExperimental = false;
    let pending = false;
    let member = false;
    let memberDepth = 1;
    for (const line of text.split('\n')) {
        if (/^\/\/ -{8,} /.test(line)) {
            section = /Experimental/i.test(line);
            pending = false;
            member = false;
        }
        if (/^\s*\/\*\*/.test(line)) {
            inDoc = true;
            docIsExperimental = false;
        }
        if (inDoc) {
            if (EXPERIMENTAL_MARK.test(line)) docIsExperimental = true;
            flags.push(section || scopes.at(-1) || docIsExperimental);
            if (/\*\//.test(line)) {
                inDoc = false;
                pending = docIsExperimental;
                member = false;
            }
            continue;
        }
        const code = line.replace(/\/\/.*$/, '').replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");
        if (code.trim() === '') {
            flags.push(section || scopes.at(-1));
            if (line.trim() === '') {
                pending = false;
                member = false;
            }
            continue;
        }
        if (pending) {
            member = true;
            memberDepth = scopes.length;
            pending = false;
        }
        const experimental = section || scopes.at(-1) || member;
        flags.push(experimental);
        for (const char of code) {
            if (char === '{') scopes.push(experimental);
            else if (char === '}' && scopes.length > 1) scopes.pop();
        }
        if (member && scopes.length <= memberDepth && /[;,}]\s*$/.test(code)) member = false;
    }
    return flags;
}

/**
 * @param {import('../diff.mjs').FileDiff[]} files
 * @param {{ readBase: (file: string) => string | null, readCurrent: (file: string) => string | null }} read
 */
export function checkFoliumApi(files, { readBase, readCurrent }) {
    const diff = files.find(file => file.newPath === FOLIUM_TYPES || file.oldPath === FOLIUM_TYPES);
    if (!diff) return [];
    const before = readBase(FOLIUM_TYPES);
    const after = readCurrent(FOLIUM_TYPES);
    if (before === null || after === null) return [];
    const oldFlags = experimentalLines(before);
    const newFlags = experimentalLines(after);
    const removed = diff.removed.filter(entry => !isComment(entry.text) && !oldFlags[entry.oldLine]);
    const added = diff.added.filter(entry => !isComment(entry.text) && !newFlags[entry.newLine]);
    // 改一行在 diff 里是一删一加：成对的算“改动”，只报一次（按删除行）
    const removedTexts = new Set(removed.map(entry => entry.text.trim()));
    const addedOnly = added.filter(entry => !removedTexts.has(entry.text.trim()));

    const versionOf = text => {
        try {
            return JSON.parse(text ?? '').version ?? null;
        } catch {
            return null;
        }
    };
    const oldVersion = versionOf(readBase(FOLIUM_VERSION_FILE));
    const newVersion = versionOf(readCurrent(FOLIUM_VERSION_FILE));
    if (!oldVersion || !newVersion) return [];
    const majorBumped = newVersion.major > oldVersion.major;
    const minorBumped = majorBumped || newVersion.minor > oldVersion.minor;

    const findings = [];
    if (removed.length > 0 && !majorBumped) {
        findings.push(...removed.slice(0, 10).map(entry => ({
            code: 'D513',
            file: FOLIUM_TYPES,
            line: entry.newLine || undefined,
            message: `Folium ${oldVersion.major}.x 的稳定接口被删改：${entry.text.trim().slice(0, 80)}（只加不改；确要改，先改成实验接口，或升大版本）`,
            key: `D513:removed:${entry.text.trim()}`,
        })));
    }
    if (addedOnly.length > 0 && !minorBumped) {
        findings.push({
            code: 'D513',
            file: FOLIUM_TYPES,
            line: addedOnly[0].newLine,
            message: `新增了 ${addedOnly.length} 行稳定接口，但 Folium 小版本没升（${FOLIUM_VERSION_FILE} 的 version.minor）`,
            key: 'D513:added',
        });
    }
    return findings;
}
