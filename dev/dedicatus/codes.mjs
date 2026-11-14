// dev/dedicatus/codes.mjs
// Dedicatus 的代码登记表：每个代码的名字、级别和一句说明。检查脚本、ESLint 格式化器和以后的分诊机器人都从这里读，
// 代码一经发布不改含义、不复用，废弃的标 retired。用法与约定见 dev/dedicatus/README.md。

/**
 * 运行模式。report：照常输出，但退出码恒为 0（先观察误报）；enforce：有新的 error 就失败。
 * 环境变量 DEDICATUS_MODE 可以覆盖。
 */
export const DEFAULT_MODE = 'enforce';

/** @typedef {'error' | 'warning' | 'notice'} DedicatusLevel */
/** @typedef {{ name: string, level: DedicatusLevel, retired?: boolean }} DedicatusCode */

/** @type {Record<string, DedicatusCode>} */
export const CODES = {
    // 0xx：Dedicatus 自身
    D001: { name: '基线增长', level: 'error' },
    D002: { name: '基线过期', level: 'error' },
    D003: { name: '未知代码', level: 'error' },
    D004: { name: '配置无效', level: 'error' },

    // 1xx：分层方向
    D101: { name: 'store 依赖组件', level: 'error' },
    D102: { name: '纯变换依赖 UI 或状态', level: 'error' },
    D103: { name: '契约依赖实现', level: 'error' },
    D104: { name: 'service 依赖组件', level: 'error' },
    D105: { name: 'wall 引擎依赖内容', level: 'error' },
    D110: { name: '绕过 omni', level: 'error' },
    // 下面三条由已有的架构单测检查（describe 标题带代码）
    D112: { name: '绕过 AI 文本门面', level: 'error' },
    D113: { name: '歌词解析绕过 parserCore', level: 'error' },
    D114: { name: '导出窗口闭包拉进应用 store', level: 'error' },
    D120: { name: 'provider 把读失败当成读完了', level: 'error' },
    D121: { name: '下架不是来自平台明确的记录', level: 'error' },
    // 由 test/unit/dedicatus/contracts/providerRegistration.test.ts 检查
    D122: { name: '新平台登记不全', level: 'error' },
    D190: { name: '目录归属存疑', level: 'warning' },

    // 2xx：library core 与 suite
    D201: { name: 'core 依赖 UI', level: 'error' },
    D202: { name: '契约引用实现', level: 'error' },
    D203: { name: 'model 不是叶子', level: 'error' },
    D204: { name: 'service/state 依赖绑定', level: 'error' },
    D205: { name: 'suite 互相依赖', level: 'error' },
    D206: { name: 'suite 直用 core service', level: 'error' },
    D207: { name: '绕过 registry', level: 'error' },

    // 3xx：耦合与结构
    D301: { name: '新增循环依赖', level: 'error' },
    D306: { name: '首屏闭包引入重型包', level: 'error' },
    D307: { name: '模组接入点没登记', level: 'error' },
    // 由 test/unit/dedicatus/contracts/packageIndependence.test.ts 检查
    D308: { name: '独立包依赖了宿主仓库', level: 'error' },
    // 由 test/unit/playback/currentSongArchitecture.test.ts 检查
    D310: { name: '当前歌曲在 currentSong.ts 之外改写', level: 'error' },
    D311: { name: '播放路径等待之后不复核', level: 'error' },
    D312: { name: '用引用相等判断还是同一个队列', level: 'error' },

    // 4xx：代码规则（ESLint）
    D401: { name: '悬空 Promise', level: 'error' },
    D402: { name: 'Promise 误用', level: 'error' },
    D403: { name: '显式 any', level: 'error' },
    D404: { name: 'switch 不穷尽', level: 'error' },
    D405: { name: '类型导入不一致', level: 'error' },
    D406: { name: 'hook 规则', level: 'error' },
    D407: { name: 'hook 依赖不全', level: 'error' },
    D410: { name: '系统下拉框', level: 'error' },
    D411: { name: '组件直读存储', level: 'error' },
    D412: { name: '非 lucide 图标', level: 'error' },
    D413: { name: '日志缺模块前缀', level: 'warning' },
    D414: { name: '日志只交 message', level: 'warning' },
    D420: { name: '失效的抑制注释', level: 'error' },
    D421: { name: '抑制注释缺原因', level: 'error' },
    D430: { name: '缩进不是 4 空格', level: 'error' },
    D431: { name: '不是单引号', level: 'error' },
    D432: { name: '换行不规范', level: 'error' },
    D440: { name: '高频回调里无条件写状态', level: 'error' },
    D441: { name: 'effect 里注册的东西没有 cleanup', level: 'error' },
    D442: { name: '调试挂件进了正式包', level: 'error' },
    // warning：不阻断，界面文字尽量走 i18n，但不硬性要求（2026-11-08 放宽）
    D443: { name: '界面硬编码文案', level: 'warning' },
    D444: { name: '界面直接显示错误原文', level: 'error' },
    D445: { name: '自建按词分割器', level: 'error' },
    D490: { name: '其他严格规则', level: 'error' },
    // no-unnecessary-condition：一半是对的（必填的 prop 写 ?.()），一半是防运行环境（navigator.mediaDevices?.、import.meta.env?.），只提醒
    D491: { name: '多余的条件判断', level: 'warning' },

    // 5xx：契约与持久化
    D506: { name: '@note 注释被改动', level: 'error' },
    // D507 由 test/unit/dedicatus/contracts/storageKeys.test.ts 检查
    D507: { name: '存储键没登记或被改名', level: 'error' },
    D508: { name: 'store / service 直接读写 localStorage', level: 'error' },
    D509: { name: '缓存键前缀没有清理分类', level: 'error' },
    D511: { name: '外观设置的去向没有声明', level: 'error' },
    D512: { name: '外观配置码短键改名或删除', level: 'error' },
    D513: { name: 'Folium 稳定接口被删改', level: 'error' },
    // 由 test/unit/dedicatus/contracts 下的契约测试检查
    D510: { name: '以主进程为准的设置被渲染层直接写', level: 'error' },

    // 6xx：进程与安全边界
    D604: { name: '账号凭据在登记的入口外写入', level: 'error' },
    // D605、D606 由 test/unit/dedicatus/contracts/ipc.test.ts 检查（D606 另有 restricted-apis 一条）
    D605: { name: 'IPC 通道缺来源校验或没登记', level: 'error' },
    D606: { name: '通道在 preload、主进程、类型三处不一致', level: 'error' },
    D610: { name: '重建主窗口不带播放交接', level: 'error' },
    D607: { name: '同步 IPC', level: 'error' },
    D608: { name: '系统加密的可用性各自判断', level: 'error' },
    D609: { name: '外链绕过协议白名单', level: 'error' },
    D611: { name: '读取别的应用的凭据', level: 'error' },

    // 8xx 是 Coven 流程的代码，由 harness 自己定义（packages/coven/src/codes.mjs），Dedicatus 的检查不报它们。
};

/** ESLint 规则 id → 代码。没列出的规则统一报 D490 并附规则 id；消息以 `Dxxx` 开头的（项目约定规则）按消息里的代码。 */
export const ESLINT_RULE_CODES = {
    '@typescript-eslint/no-floating-promises': 'D401',
    '@typescript-eslint/no-misused-promises': 'D402',
    '@typescript-eslint/no-explicit-any': 'D403',
    '@typescript-eslint/switch-exhaustiveness-check': 'D404',
    '@typescript-eslint/consistent-type-imports': 'D405',
    '@typescript-eslint/no-unnecessary-condition': 'D491',
    'react-hooks/rules-of-hooks': 'D406',
    'react-hooks/exhaustive-deps': 'D407',
    'dedicatus/no-icon-libraries': 'D412',
    'dedicatus/log-module-prefix': 'D413',
    'dedicatus/log-error-object': 'D414',
    'dedicatus/credential-write-sites': 'D604',
    'dedicatus/hot-callback-state': 'D440',
    'dedicatus/effect-cleanup': 'D441',
    'dedicatus/ui-literal-text': 'D443',
    'dedicatus/stale-after-await': 'D311',
    'dedicatus/window-rebuild-handoff': 'D610',
    'dedicatus/error-text-in-ui': 'D444',
    '@eslint-community/eslint-comments/require-description': 'D421',
    '@stylistic/indent': 'D430',
    '@stylistic/quotes': 'D431',
    '@stylistic/eol-last': 'D432',
    '@stylistic/linebreak-style': 'D432',
};

/** D412：界面图标只用 lucide-react，这些库一律不许 import（前缀匹配）。 */
export const FORBIDDEN_ICON_LIBRARIES = [
    'react-icons',
    '@heroicons/',
    '@tabler/icons',
    '@mui/icons-material',
    '@phosphor-icons/',
    '@fortawesome/',
    '@radix-ui/react-icons',
    'react-feather',
    '@iconify/',
    'remixicon',
    'iconoir-react',
];

export const CODE_PATTERN = /^D\d{3}$/;

/** 一个代码当前的定义；不存在或已废弃返回 null。 */
export const codeInfo = code => {
    const info = CODES[code];
    return info && !info.retired ? info : null;
};
