import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'vite';
import { containsCjk, toFullPinyin, toInitials } from './pinyinTerms.mjs';

// 解析器用 Vite 自带的 parseAst（rolldown 的解析器，直接吃 TS），而不是 typescript 包：
// 仓库里的 typescript 已经是 7.x，经典的 ts.createSourceFile / ts.forEachChild 编译器 API
// 不在包根了（根入口只剩 version.cjs，AST 挪到 typescript/unstable/*，也没有 createSourceFile）。
// 插件本来就跑在 Vite 里，用它自己的解析器等于零新依赖。

// dev/pinyin/commandPinyinPlugin.mjs
// 构建期生成命令面板检索用的拼音字典，以 Vite 虚拟模块形式提供，不签入仓库。
//
// 为什么是「短语 -> 拼音」的扁平字典，而不是「命令 id -> 拼音」的索引：
// 关键词经由八种不同的工厂位置参数传进命令对象（createSettingsCommand 的第 4 个参数、
// createVisualizerCommand 的第 4 个参数、内联对象字面量……），构建期靠静态分析把字符串归属到
// 具体命令并不可靠；而要拿到归属就得执行 registry，那会把 React、lucide、整张模块图都拖进
// 构建脚本。改成按短语查表后，归属交给运行时的索引构建器——它本来就握着命令对象——
// 这个插件只需要做纯静态扫描。
//
// 语言库只在 devDependencies 里，运行时零字典体积。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

export const VIRTUAL_MODULE_ID = 'virtual:folia-command-pinyin';
const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`;

const ZH_LOCALE_PATH = path.join(ROOT, 'src/i18n/locales/zh-CN.ts');
const COMMANDS_DIR = path.join(ROOT, 'src/components/command-palette/commands');
const COMMAND_FACTORIES_PATH = path.join(ROOT, 'src/components/command-palette/commandFactories.ts');
const LIBRARY_SUITES_DIR = path.join(ROOT, 'src/library/suites');
/** library suite 的外观动作（manifest 的 chromeActions）只能声明在这两种文件里，关键词才会生成拼音。 */
const SUITE_CHROME_FILE_NAMES = ['entry.ts', 'chromeActions.ts'];
const VISUALIZER_DIR = path.join(ROOT, 'src/components/visualizer');
const MODE_ENTRY_FILE = 'entry.tsx';

const parse = (filePath) => parseAst(fs.readFileSync(filePath, 'utf8'), { lang: filePath.endsWith('.tsx') ? 'tsx' : 'ts' });

/** 泛型 ESTree 遍历：任何带 type 的对象都当节点，数组逐个下钻。 */
const walk = (node, visit) => {
    if (!node || typeof node !== 'object') {
        return;
    }
    if (Array.isArray(node)) {
        node.forEach(child => walk(child, visit));
        return;
    }
    if (typeof node.type !== 'string') {
        return;
    }
    visit(node);
    for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'loc' || key === 'range' || key === 'parent') {
            continue;
        }
        walk(node[key], visit);
    }
};

const propertyKeyName = (property) => {
    if (property?.type !== 'Property') {
        return null;
    }
    const key = property.key;
    if (key?.type === 'Literal' && typeof key.value === 'string') {
        return key.value;
    }
    if (key?.type === 'Identifier' && !property.computed) {
        return key.name;
    }
    return null;
};

/** 在一个对象字面量里按名字找属性值，找不到返回 null。 */
const findProperty = (objectExpression, name) => {
    if (objectExpression?.type !== 'ObjectExpression') {
        return null;
    }
    for (const property of objectExpression.properties) {
        if (propertyKeyName(property) === name) {
            return property.value;
        }
    }
    return null;
};

/** 找到 default export 的对象字面量；locale 文件整份就是一个大对象。 */
const findExportedObject = (program) => {
    for (const statement of program.body) {
        if (statement.type === 'ExportDefaultDeclaration' && statement.declaration?.type === 'ObjectExpression') {
            return statement.declaration;
        }
    }
    // `const zhCN = { ... }; export default zhCN;` 这种写法：取第一个够大的对象字面量。
    let found = null;
    walk(program, (node) => {
        if (!found && node.type === 'ObjectExpression' && node.properties.length > 5) {
            found = node;
        }
    });
    return found;
};

/** 收集一棵子树里所有含 CJK 的字符串字面量。 */
const collectCjkStrings = (node, sink) => {
    walk(node, (current) => {
        if (current.type === 'Literal' && typeof current.value === 'string' && containsCjk(current.value)) {
            sink.add(current.value);
            return;
        }
        if (current.type === 'TemplateLiteral' && current.expressions.length === 0) {
            const raw = current.quasis.map(quasi => quasi.value.cooked ?? '').join('');
            if (containsCjk(raw)) {
                sink.add(raw);
            }
        }
    });
};

/**
 * zh-CN 的 commandPalette.commands 区块。整份 locale 有两千多行中文，全收会让字典膨胀十几倍
 * 却对命令检索毫无用处，所以精确走到这一个节点再收。
 */
const collectLocaleCommandPhrases = (sink) => {
    const sourceFile = parse(ZH_LOCALE_PATH);
    const root = findExportedObject(sourceFile);
    const commands = findProperty(findProperty(root, 'commandPalette'), 'commands');
    if (!commands) {
        throw new Error(
            '[folia-command-pinyin] 在 src/i18n/locales/zh-CN.ts 里找不到 commandPalette.commands。'
            + '文案结构变了就得同步改这里，否则命令的中文和拼音会静默搜不到。',
        );
    }
    collectCjkStrings(commands, sink);
};

/**
 * 命令定义文件里的 CJK 字面量，也就是手写的中文同义词。
 * 不区分它属于哪条命令——字典按短语查，多收几个无害。
 */
const collectCommandSynonymPhrases = (sink) => {
    const files = fs.readdirSync(COMMANDS_DIR)
        .filter(name => name.endsWith('.ts'))
        .map(name => path.join(COMMANDS_DIR, name));
    files.push(COMMAND_FACTORIES_PATH);
    files.forEach(filePath => collectCjkStrings(parse(filePath), sink));
};

/**
 * library suite 的外观动作（B2）：命令由命令面板在启动时按各 suite manifest 的 chromeActions 生成，
 * 手写的中文关键词就在 `src/library/suites/<id>/entry.ts` 或同目录的 `chromeActions.ts` 里。
 * 只扫这两种文件（不扫整个 suite：组件里的中文字面量与命令检索无关）。
 */
const listSuiteChromeFiles = () => {
    if (!fs.existsSync(LIBRARY_SUITES_DIR)) {
        return [];
    }
    return fs.readdirSync(LIBRARY_SUITES_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .flatMap(entry => SUITE_CHROME_FILE_NAMES.map(name => path.join(LIBRARY_SUITES_DIR, entry.name, name)))
        .filter(filePath => fs.existsSync(filePath));
};

const collectSuiteChromePhrases = (sink) => {
    listSuiteChromeFiles().forEach(filePath => collectCjkStrings(parse(filePath), sink));
};

/** 歌词动画模式和背景的入口文件：visualizer/<mode>/entry.tsx 与 visualizer/backgrounds/<mode>/entry.tsx。 */
const isModeEntryPath = (filePath) => {
    const modeDir = path.dirname(filePath);
    const parentDir = path.dirname(modeDir);
    return path.basename(filePath) === MODE_ENTRY_FILE
        && (parentDir === VISUALIZER_DIR || parentDir === path.join(VISUALIZER_DIR, 'backgrounds'));
};

const listModeEntryPaths = () => [VISUALIZER_DIR, path.join(VISUALIZER_DIR, 'backgrounds')].flatMap(dir => (
    fs.readdirSync(dir, { withFileTypes: true })
        .filter(item => item.isDirectory())
        .map(item => path.join(dir, item.name, MODE_ENTRY_FILE))
        .filter(entryPath => fs.existsSync(entryPath))
));

/**
 * 切换到某个歌词动画模式或背景的那条命令，文案写在该模式自己的 entry.tsx 的 command 里
 * （commands/visualizerCommands.ts 按 registry 生成命令），所以同义词也得到那里去收。
 * 只收 command 这个属性下面的字面量：入口文件里还有显示名之类的中文，和命令检索无关。
 */
const collectModeEntryCommandPhrases = (sink) => {
    listModeEntryPaths().forEach((entryPath) => {
        walk(parse(entryPath), (node) => {
            if (propertyKeyName(node) === 'command') {
                collectCjkStrings(node.value, sink);
            }
        });
    });
};

export const collectPhrases = () => {
    const phrases = new Set();
    collectLocaleCommandPhrases(phrases);
    collectCommandSynonymPhrases(phrases);
    collectSuiteChromePhrases(phrases);
    collectModeEntryCommandPhrases(phrases);
    return phrases;
};

/**
 * 确定性输出：key 排序、固定缩进。产物虽然不进 git，但确定性让 dev 下的 HMR 失效不会因为
 * 顺序抖动而产生假变更，也让「同一份源码生成同一份字典」可被测试断言。
 */
export const renderDictionary = () => {
    const phrases = [...collectPhrases()].sort();
    const lines = phrases.map((phrase) => {
        const full = toFullPinyin(phrase);
        const initials = toInitials(phrase);
        return `    ${JSON.stringify(phrase)}: { full: ${JSON.stringify(full)}, initials: ${JSON.stringify(initials)} },`;
    });

    return [
        '// 由 dev/pinyin/commandPinyinPlugin.mjs 在构建期生成，不签入仓库，不要手改。',
        '// 来源：src/i18n/locales/zh-CN.ts 的 commandPalette.commands，以及',
        '//       src/components/command-palette/commands/*.ts 和各模式 entry.tsx 的 command 里手写的中文同义词，',
        '//       src/library/suites/*/{entry,chromeActions}.ts 里外观动作的中文关键词。',
        '',
        '/** @type {Record<string, { full: string; initials: string }>} */',
        'export const PINYIN_BY_PHRASE = {',
        ...lines,
        '};',
        '',
        `export const PINYIN_PHRASE_COUNT = ${phrases.length};`,
        '',
    ].join('\n');
};

/** 源文件变了就让虚拟模块失效——否则 dev 下改了中文文案，拼音还是旧的。 */
const WATCHED_PATHS = [ZH_LOCALE_PATH, COMMANDS_DIR, COMMAND_FACTORIES_PATH];

/** `src/library/suites/<id>/entry.ts` 或 `chromeActions.ts`（新增的 suite 也算，所以按形状判断而不是按清单）。 */
const isSuiteChromePath = (changedPath) => (
    path.dirname(path.dirname(changedPath)) === LIBRARY_SUITES_DIR
    && SUITE_CHROME_FILE_NAMES.includes(path.basename(changedPath))
);

// 模式目录里只认入口文件：整个 visualizer 目录都算进来的话，改任何一个 renderer 都会整页刷新。
const isWatchedPath = (changedPath) => isSuiteChromePath(changedPath) || isModeEntryPath(changedPath) || WATCHED_PATHS.some(watched => (
    changedPath === watched || changedPath.startsWith(`${watched}${path.sep}`)
));

export const commandPinyinPlugin = () => ({
    name: 'folia-command-pinyin',
    enforce: 'pre',
    resolveId(id) {
        return id === VIRTUAL_MODULE_ID ? RESOLVED_VIRTUAL_MODULE_ID : null;
    },
    load(id) {
        return id === RESOLVED_VIRTUAL_MODULE_ID ? renderDictionary() : null;
    },
    configureServer(server) {
        WATCHED_PATHS.forEach(watched => server.watcher.add(watched));
        const invalidate = (changedPath) => {
            if (!isWatchedPath(changedPath)) {
                return;
            }
            const virtualModule = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
            if (virtualModule) {
                server.moduleGraph.invalidateModule(virtualModule);
                server.ws.send({ type: 'full-reload' });
            }
        };
        server.watcher.on('change', invalidate);
        server.watcher.on('add', invalidate);
        server.watcher.on('unlink', invalidate);
    },
});

export default commandPinyinPlugin;
