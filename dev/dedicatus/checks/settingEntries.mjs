import { REGISTRY_FILE, isRecorded, lostEntries, parseRegistry } from '../settingEntries.mjs';
// dev/dedicatus/checks/settingEntries.mjs
// D515、D516：和比较基点比，设置入口登记表（dev/dedicatus/settingEntries.json）里少了的入口。登记表和“位置”的说法见
// dev/dedicatus/settingEntries.mjs。D515 在 `npm run dedicatus` 里跑（有比较基点时）；D516 要 PR 描述，只在 CI 的
// pr-setting-entries workflow 里跑（dev/dedicatus/prSettingEntries.mjs）。

/**
 * 基点和现在的登记表比出来的、少了的入口。基点上还没有登记表（这条规则加进来之前）返回空。
 * @param {{ readBase: (file: string) => string | null, readCurrent: (file: string) => string | null, renameMap?: Map<string, string> }} io
 */
export function settingEntryLosses({ readBase, readCurrent, renameMap = new Map() }) {
    const baseText = readBase(REGISTRY_FILE);
    const currentText = readCurrent(REGISTRY_FILE);
    if (baseText === null || currentText === null) return { lost: [], current: null };
    const current = parseRegistry(currentText);
    return { lost: lostEntries(parseRegistry(baseText), current, renameMap), current };
}

/** 设置函数的名字（「store 文件名.设置函数」的后半）。 */
const setterOf = entry => entry.slice(entry.indexOf('.') + 1);

/** D515：少了的入口没有 removed 记录。 */
export function checkSettingEntries(io) {
    const { lost, current } = settingEntryLosses(io);
    if (!current) return [];
    return lost.filter(loss => !isRecorded(current, loss)).map(({ entry, place, files }) => ({
        code: 'D515',
        file: REGISTRY_FILE,
        message: `设置入口被拿掉了：${entry} 在「${place}」一处都不剩了（原来在 ${files.join('、')}）。这是用户看得见的变化，要是用户的决定：`
            + `在 ${REGISTRY_FILE} 的 removed 里加一条 { "entry": "${entry}", "place": "${place}", "why": "谁定的、为什么", "date": "YYYY-MM-DD" }，PR 描述里也写明；不是有意拿掉的就把入口加回来`,
        key: `D515:${entry}@${place}`,
    }));
}

/** 描述里有没有这个名字（前后不连着别的标识符字符：setLook 不算提到了 setLookPreset）。 */
const mentions = (body, name) => new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(body);

/** D516：少了的入口，PR 描述里没提到那个设置函数的名字（几个 store 有同名的设置函数时，写全「store 文件名.设置函数」更清楚，但只写名字也算）。 */
export function checkSettingEntriesInPrBody(io, prBody) {
    const { lost } = settingEntryLosses(io);
    const body = prBody ?? '';
    return lost.filter(({ entry }) => !mentions(body, setterOf(entry))).map(({ entry, place }) => ({
        code: 'D516',
        file: REGISTRY_FILE,
        message: `这个 PR 拿掉了设置入口 ${entry}（「${place}」），PR 描述里要写明（提到 ${setterOf(entry)} 这个名字）：拿掉了什么、谁定的、为什么。改好描述后这项检查会自己重跑`,
        key: `D516:${entry}@${place}`,
    }));
}
