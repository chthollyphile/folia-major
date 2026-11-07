// dev/dedicatus/codes.mjs
// Dedicatus 的代码登记表：每个代码的名字、级别和一句说明。检查脚本、ESLint 格式化器和以后的分诊机器人都从这里读，
// 代码一经发布不改含义、不复用，废弃的标 retired。用法与约定见 dev/dedicatus/README.md。

/**
 * 运行模式。report：照常输出，但退出码恒为 0（先观察误报）；enforce：有新的 error 就失败。
 * 环境变量 DEDICATUS_MODE 可以覆盖。
 */
export const DEFAULT_MODE = 'report';

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
    D490: { name: '其他严格规则', level: 'error' },

    // 5xx：契约与持久化
    D506: { name: '@note 注释被改动', level: 'error' },
};

/** ESLint 规则 id → 代码。没列出的规则统一报 D490 并附规则 id；消息以 `Dxxx` 开头的（项目约定规则）按消息里的代码。 */
export const ESLINT_RULE_CODES = {
    '@typescript-eslint/no-floating-promises': 'D401',
    '@typescript-eslint/no-misused-promises': 'D402',
    '@typescript-eslint/no-explicit-any': 'D403',
    '@typescript-eslint/switch-exhaustiveness-check': 'D404',
    '@typescript-eslint/consistent-type-imports': 'D405',
    'react-hooks/rules-of-hooks': 'D406',
    'react-hooks/exhaustive-deps': 'D407',
    'dedicatus/no-icon-libraries': 'D412',
    'dedicatus/log-module-prefix': 'D413',
    'dedicatus/log-error-object': 'D414',
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
