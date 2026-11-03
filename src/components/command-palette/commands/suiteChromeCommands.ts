import type { LibrarySuiteChromeActionMeta } from '../../../library/core/suite/suiteChrome.contract';
import { createSuiteChromeCommand } from '../commandFactories';
import type { CommandPaletteCommand } from '../types';

// src/components/command-palette/commands/suiteChromeCommands.ts
// library suite 的外观动作（B2）→ 命令。和别的 group 文件不同，这里没有写死的命令：动作声明在各 suite 的 manifest
// （chromeActions）里，而命令文件不 import library 的 registry（它会把默认 suite 的整套组件拉进命令面板的模块图）。
// 所以这里只给纯函数，由宿主（src/library/app/installLibrarySuiteChromeCommands）在启动时把 registry 里可用的
// suite 交进来，经 commandRegistry 的 setSuiteChromeCommands 装进命令列表；契约测试用同一个函数静态枚举。

/** 生成命令只需要 manifest 的这两项（LibrarySuiteManifest 结构上满足）。 */
export type SuiteChromeDeclaration = {
    readonly id: string;
    readonly chromeActions?: readonly LibrarySuiteChromeActionMeta[];
};

/** 每套 suite 的每条外观动作一条命令，按 suite 顺序、声明顺序。 */
export const buildSuiteChromeCommands = (suites: readonly SuiteChromeDeclaration[]): CommandPaletteCommand[] => (
    suites.flatMap(suite => (suite.chromeActions ?? []).map(action => createSuiteChromeCommand(suite.id, action)))
);
