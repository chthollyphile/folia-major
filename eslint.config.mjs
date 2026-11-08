import {
    CREDENTIAL_KEYS,
    CREDENTIAL_OBJECT_FACTORIES,
    CREDENTIAL_OBJECTS,
    CREDENTIAL_STORAGE_KEY_CALLS,
    CREDENTIAL_WRITE_CALLS,
    CREDENTIAL_WRITERS,
} from './dev/dedicatus/credentialWriters.mjs';
import dedicatus from './dev/dedicatus/eslint/plugin.mjs';
import { REGISTERED_SITES } from './dev/dedicatus/registeredSites.mjs';
import { PLAYBACK_TOKENS } from './dev/dedicatus/playbackTokens.mjs';
import { RESTRICTED_APIS } from './dev/dedicatus/restrictedApis.mjs';
import { WINDOW_REBUILD } from './dev/dedicatus/windowRebuild.mjs';
import { comments, globals, js, reactHooks, stylistic, tseslint } from './dev/dedicatus/lint/plugins.mjs';
// eslint.config.mjs
// Dedicatus 的 ESLint 配置。ESLint 和插件装在 dev/dedicatus/lint/ 的隔离环境里（钉 TypeScript 6.0：
// typescript-eslint 要用编译器 API，项目用的 TypeScript 7 没有），根目录不装。跑法：npm run lint（先 npm run lint:install）。
// 现有违规记在 eslint-suppressions.json，只减不增；输出由 dev/dedicatus 换成 D 代码（规则到代码的对应在 dev/dedicatus/codes.mjs）。

/** 带类型信息检查的 TypeScript：用根 tsconfig（api-ts 用它自己的）。 */
const TYPED = ['src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx,mts}', 'dev/**/*.{ts,tsx}', 'api-ts/**/*.ts', 'worker/**/*.ts', '*.ts'];
/** 应用自己的代码：日志规则（AGENTS.md 的“日志”一节）只管这里，测试、开发脚本和 CLI 的输出不算日志。 */
const APP_CODE = ['src/**/*.{ts,tsx,js,mjs,cjs}', 'electron/**/*.{ts,js,mjs,cjs}'];
const SCRIPTS = ['**/*.{js,cjs,mjs}'];

export default tseslint.config(
    {
        ignores: [
            '**/node_modules/**', 'dist/**', 'release/**', 'coverage/**', 'test-results/**', 'playwright-report/**',
            // 生成的文件改源头不改它（AGENTS.md）
            'api/qq.js', 'mods/**', 'docs/**',
            // 已签名的模组和测试夹具：签名覆盖原始字节，不能被 --fix 改动
            'test/fixtures/folium-signature/**',
            'sync-server/dist/**', 'build/*/**',
        ],
    },
    {
        linterOptions: { reportUnusedDisableDirectives: 'error' },
    },

    // 所有文件：风格、抑制注释、@note 水印
    {
        plugins: { '@stylistic': stylistic, '@eslint-community/eslint-comments': comments, dedicatus },
        rules: {
            '@stylistic/indent': ['error', 4, { SwitchCase: 1 }],
            '@stylistic/quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: 'always' }],
            '@stylistic/eol-last': ['error', 'always'],
            '@stylistic/linebreak-style': ['error', 'unix'],
            '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
            // `@note Version Control` 水印上方的 eslint-disable 按 AGENTS.md 保留不动：
            // 让这条规则只认这一个词条，水印行触发、被上一行的指令抑制，指令就一直“有效”，不会被判为失效（D420）。
            'no-warning-comments': ['error', { terms: ['@note version control'], location: 'start' }],
            // 项目约定规则在 ESLint 里都是 error，旧违规才进得了批量抑制；是否阻断由 Dedicatus 的代码级别决定（D413、D414 是 warning）。
            'dedicatus/no-icon-libraries': 'error',
            // 某些 API 只在登记过的地方用（D445、D508、D607、D608、D609…），每条的范围和例外在登记表里
            'dedicatus/restricted-apis': ['error', { entries: RESTRICTED_APIS }],
            // 某种写法只能出现在登记过的文件或函数里（D121、D120、D442…）
            'dedicatus/registered-sites': ['error', { entries: REGISTERED_SITES }],
            // D610：重建主窗口要带播放交接快照（只看 electron/main.cjs）
            'dedicatus/window-rebuild-handoff': ['error', WINDOW_REBUILD],
            // D311：播放路径等待之后要先复核起播令牌再写状态（只看登记的播放路径文件）
            'dedicatus/stale-after-await': ['error', PLAYBACK_TOKENS],
        },
    },
    {
        files: APP_CODE,
        rules: {
            'dedicatus/log-module-prefix': 'error',
            'dedicatus/log-error-object': 'error',
            // D444：错误原文不直接交给界面的提示函数
            'dedicatus/error-text-in-ui': ['error', { notifiers: ['setStatusMessage', 'showStatusMessage', 'showToast', 'pushToast', 'toast', 'setError'] }],
            // D604：账号凭据只在 dev/dedicatus/credentialWriters.mjs 登记过的函数里写（#1104 那类问题）
            'dedicatus/credential-write-sites': ['error', {
                keys: CREDENTIAL_KEYS,
                calls: CREDENTIAL_WRITE_CALLS,
                objects: CREDENTIAL_OBJECTS,
                objectFactories: CREDENTIAL_OBJECT_FACTORIES,
                storageKeyCalls: CREDENTIAL_STORAGE_KEY_CALLS,
                writers: CREDENTIAL_WRITERS,
            }],
        },
    },

    // 脚本（Node 与浏览器两边的 JS）
    {
        files: SCRIPTS,
        extends: [js.configs.recommended],
        languageOptions: { ecmaVersion: 'latest', globals: { ...globals.browser, ...globals.node } },
    },
    {
        files: ['**/*.cjs'],
        languageOptions: { sourceType: 'commonjs' },
    },

    // sync-server：有自己的 tsconfig 和依赖，v1 只做不需要类型信息的检查
    {
        files: ['sync-server/**/*.ts'],
        extends: [tseslint.configs.strict],
    },

    // 带类型信息的 TypeScript：strictTypeChecked 全套，调松两条（和 React 的写法冲突、误报多）
    {
        files: TYPED,
        extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
        languageOptions: {
            parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
            globals: { ...globals.browser, ...globals.node },
        },
        plugins: { 'react-hooks': reactHooks },
        rules: {
            '@typescript-eslint/no-confusing-void-expression': 'off',
            '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
            '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'error',
            'no-restricted-syntax': ['error', {
                selector: "JSXOpeningElement[name.name='select']",
                message: 'D410：不用系统 <select>，设置页用 settings/kit 的 Select，别处用 shared/CustomSelect。',
            }],
        },
    },
    // 热路径与界面文案（D440、D441、D443）：只管应用的渲染进程代码
    {
        files: ['src/**/*.{ts,tsx}'],
        ignores: ['src/dev/**'],
        rules: {
            'dedicatus/hot-callback-state': 'error',
            'dedicatus/effect-cleanup': 'error',
        },
    },
    {
        files: ['src/**/*.tsx'],
        ignores: ['src/dev/**'],
        rules: {
            'dedicatus/ui-literal-text': ['error', { allow: ['Folia', 'Folium', 'Bravais', 'Lattice', 'Navidrome', 'GitHub', 'OBS', 'Stage', 'Discord'] }],
        },
    },
    {
        files: ['src/components/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-globals': ['error',
                { name: 'localStorage', message: 'D411：组件不直接读写 localStorage，放进 src/stores 的 use*SettingsStore（storagePrimitives）。' },
                { name: 'sessionStorage', message: 'D411：组件不直接读写 sessionStorage，放进 src/stores。' },
            ],
            'no-restricted-properties': ['error',
                { object: 'window', property: 'localStorage', message: 'D411：组件不直接读写 localStorage，放进 src/stores。' },
                { object: 'window', property: 'sessionStorage', message: 'D411：组件不直接读写 sessionStorage，放进 src/stores。' },
            ],
        },
    },
);
