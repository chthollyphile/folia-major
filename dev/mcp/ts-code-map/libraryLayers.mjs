// dev/mcp/ts-code-map/libraryLayers.mjs
// src/library/core 按功能分文件夹（account/、collection/、home/……），每个文件属于哪一层由文件名说：
// - `*.contract.ts`：契约，只有类型与接口（引用别的契约与 src/types）；
// - `*.service.ts`：资源与动作层，持有状态、调 omni 或别的 service；
// - `use*Store.ts`：状态（zustand store）；
// - 其余 `use*.ts(x)`：React 绑定（hook，和 React 自己「use 开头是 hook」的约定一致）；
// - 其它文件：纯变换（model），是叶子。
// 没写后缀的文件按 model 查：它要是去调 service、读状态，分层检查当场失败，改名或挪走就好，不会悄悄放过。
// test/unit/library/layerBoundaries.test.ts 与 codemap.mjs 的 BOUNDARY_RULES 都用这里的判断。

export const LIBRARY_CORE = 'src/library/core/';

/** @typedef {'contract' | 'service' | 'state' | 'binding' | 'model'} LibraryLayer */

/**
 * core 里一个文件的层（仓库内路径，带不带扩展名都行）；不在 core 里是 null。
 * @param {string} file
 * @returns {LibraryLayer | null}
 */
export const libraryLayerOf = (file) => {
    if (!file.startsWith(LIBRARY_CORE)) return null;
    const name = file.slice(file.lastIndexOf('/') + 1).replace(/\.tsx?$/, '');
    if (name.endsWith('.contract')) return 'contract';
    if (name.endsWith('.service')) return 'service';
    if (/^use[A-Z]\w*Store$/.test(name)) return 'state';
    if (/^use[A-Z]/.test(name)) return 'binding';
    return 'model';
};
