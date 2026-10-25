// src/types/sceneIds.ts
// 场景 id 的规矩和内建场景清单。store、导入导出只需要判断「这个字符串是不是合法场景 id」时用这里，
// 不 import 场景名单（components/scenes/registry.ts 会拉进全部内建场景的清单）。
//
// 三种来源三种写法，第三方永远盖不掉内建场景：
//   内建    `cinema`          小写字母开头，只有字母和数字；目录 src/components/scenes/<id>/entry.ts
//   模组    `mod:<模组>:<id>`  由模组加载器加前缀
//   数据包  `pkg:<id>`        由数据包加载器加前缀
// 名单初始化时核对这份清单和目录里的 entry.ts 一致（assertBuiltinSceneList），漏了就启动报错。

export const BUILTIN_SCENE_IDS = ['cinema'] as const satisfies readonly string[];

export type BuiltinSceneId = (typeof BUILTIN_SCENE_IDS)[number];

// scenes/ 下的这些目录不是场景（宿主、工具箱、设置……），不能拿来当内建场景 id。
export const RESERVED_SCENE_DIR_NAMES: readonly string[] = ['engine', 'kit', 'packages', 'settings', 'editor'];

const BUILTIN_ID = /^[a-z][a-zA-Z0-9]*$/;
const PART = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export type SceneIdKind = 'builtin' | 'mod' | 'pkg';

/** Which of the three sources an id is written for, or null when it is no scene id at all. */
export const sceneIdKind = (id: unknown): SceneIdKind | null => {
    if (typeof id !== 'string') return null;
    if (id.startsWith('mod:')) {
        const parts = id.slice(4).split(':');
        return parts.length === 2 && parts.every(part => PART.test(part)) ? 'mod' : null;
    }
    if (id.startsWith('pkg:')) {
        return PART.test(id.slice(4)) ? 'pkg' : null;
    }
    return BUILTIN_ID.test(id) && !RESERVED_SCENE_DIR_NAMES.includes(id) ? 'builtin' : null;
};

export const isSceneId = (id: unknown): id is string => sceneIdKind(id) !== null;

const BUILTIN_SCENE_SET: ReadonlySet<string> = new Set(BUILTIN_SCENE_IDS);

export const isBuiltinSceneId = (id: unknown): id is BuiltinSceneId =>
    typeof id === 'string' && BUILTIN_SCENE_SET.has(id);

/** The registry's start-up check: the entry folders it found against the list above. */
export const assertBuiltinSceneList = (discovered: readonly string[], declared: readonly string[] = BUILTIN_SCENE_IDS): void => {
    const missing = discovered.filter(id => !declared.includes(id));
    const stale = declared.filter(id => !discovered.includes(id));
    if (missing.length === 0 && stale.length === 0) return;
    throw new Error(
        '[SceneRegistry] src/types/sceneIds.ts 的 BUILTIN_SCENE_IDS 与 scenes/*/entry.ts 不一致：'
        + `${missing.length > 0 ? ` 缺少 ${missing.join(', ')}；` : ''}`
        + `${stale.length > 0 ? ` 多出 ${stale.join(', ')}；` : ''}`,
    );
};
