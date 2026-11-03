import type { LibrarySuiteChromeActionMeta } from './suiteChrome.contract';

// src/library/core/suite/suiteChrome.ts
// suite 外观动作（B2）的纯规则：命令 id 的拼法与 manifest 声明的校验。命令面板的工厂、契约测试与建索引共用这里，
// 「`<suiteId>-<动作 id>`」只写在一处。

/** 外观动作 id：小写 kebab-case（拼进命令 id 与 i18n key，不能带点、空格或大写）。 */
const CHROME_ACTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 外观动作在命令面板里的命令 id。 */
export const libraryChromeCommandId = (suiteId: string, actionId: string): string => `${suiteId}-${actionId}`;

/**
 * 校验一套 suite 声明的外观动作，有问题就抛错（建索引时调用，与未知动作一样在启动时暴露）：
 * id 必须是 kebab-case 且在 suite 内唯一，标题、描述不能为空，执行键给了就不能是空白。
 * 跨 suite、与静态命令之间的 id 唯一与执行键冲突由命令面板装入命令时检查（它才看得到全部命令）。
 */
export const assertLibrarySuiteChromeActions = (
    suiteId: string,
    actions: readonly LibrarySuiteChromeActionMeta[] | undefined,
): void => {
    const seen = new Set<string>();
    for (const action of actions ?? []) {
        if (!CHROME_ACTION_ID.test(action.id)) {
            throw new Error(`[LibrarySuites] Suite "${suiteId}" declares chrome action "${action.id}"; ids must be lowercase kebab-case`);
        }
        if (seen.has(action.id)) {
            throw new Error(`[LibrarySuites] Suite "${suiteId}" declares chrome action "${action.id}" twice`);
        }
        seen.add(action.id);
        if (!action.title.trim() || !action.description.trim()) {
            throw new Error(`[LibrarySuites] Suite "${suiteId}" chrome action "${action.id}" needs a fallback title and description`);
        }
        if (action.executeShortcut !== undefined && !action.executeShortcut.trim()) {
            throw new Error(`[LibrarySuites] Suite "${suiteId}" chrome action "${action.id}" declares an empty executeShortcut`);
        }
    }
};
