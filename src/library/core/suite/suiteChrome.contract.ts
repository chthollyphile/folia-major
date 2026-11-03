// src/library/core/suite/suiteChrome.contract.ts
// suite 外观动作（suite-chrome，B2）的契约：suite 自己的外观操作（bravais 的缝等级、面板、定位正在播放……）不是
// core 的资料动作，没有 surface 可挂，只出现在命令面板里。元数据静态声明在 manifest 的 chromeActions 上（命令
// 文案的契约测试可以静态枚举），运行时 suite 只注册「此刻能不能做」与「怎么做」（core/suite 的
// useLibrarySuiteChromeRegistration）。动作只描述做什么，不碰 DOM。这里只有类型。

/**
 * manifest 里的一条外观动作（静态）。命令 id 为 `<suiteId>-<id>`（core/suite/suiteChrome 的 libraryChromeCommandId）。
 * 文案与命令面板其它命令同一约定：正式文案在 en / zh-CN / in 三份 locale 的 `commandPalette.commands.<命令 id>`
 * （title + description），这里的 title / description 只是缺译时的英文回退。
 */
export type LibrarySuiteChromeActionMeta = {
    /** suite 内唯一，小写 kebab-case（建索引时校验）。 */
    readonly id: string;
    readonly title: string;
    readonly description: string;
    /**
     * 英文与中文触发词。拼音由构建期从中文生成（dev/pinyin/commandPinyinPlugin 扫描 suites/<id>/entry.ts 与
     * chromeActions.ts 里的中文字面量），不要手写拼音；也不要照抄标题（命令契约测试都会检查）。
     */
    readonly keywords: readonly string[];
    /**
     * 执行模式（`:`）的按键。与同时可用的命令保持无前缀冲突，冲突在命令装入时抛错。suite-chrome 只在首页视图成立，
     * 与 lattice / player-surface 的命令互斥，可以复用它们的键（例如 Lattice 的 `c`）；不同 suite 的外观动作互斥，
     * 也可以复用彼此的键。危险、不可撤销或需要确认的动作不给。
     */
    readonly executeShortcut?: string;
};

/** 一条外观动作的运行时实现（suite 每次渲染给最新的闭包，绑定经 latest-ref 读取）。 */
export type LibrarySuiteChromeHandler = {
    /** 此刻能不能做（命令面板每次打开都重新问）。 */
    isAvailable: () => boolean;
    run: () => void;
};

/** 动作 id → 实现。没给实现的动作在命令面板里不可用。 */
export type LibrarySuiteChromeHandlers = Readonly<Record<string, LibrarySuiteChromeHandler>>;

/**
 * 命令面板读到的句柄（core/suite 的 useLibrarySuiteChromeStore）：哪套 suite 的外观此刻在前台，以及按动作 id
 * 问可用性、执行。方法读注册方最近一次渲染的 handlers；没有实现的动作 isAvailable 为 false、run 返回 false。
 */
export type LibrarySuiteChromeHandle = {
    /** 注册方所属 suite 的 id（LibrarySuiteId；这里不 import ./suite，免得两份契约互相引用）。 */
    readonly suiteId: string;
    isAvailable: (actionId: string) => boolean;
    /** 能做就执行并返回 true；没有实现或此刻不可用返回 false。 */
    run: (actionId: string) => boolean;
};
