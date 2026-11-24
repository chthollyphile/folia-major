import type { FoliumCommandDef, FoliumLabel, FoliumRegistryHandle } from '@folia/folium';
import { LxImportFailed } from './lxTransport';
import type { LxState, LxTransport } from './lxTransport';

// sources/lxmusic/client/lxCommands.ts
// 洛雪音源的脚本管理：四条命令（命令面板和模组面板里这个模组的那一行），不另造界面。
// 「切换」「移除」「搜索平台」的选项来自脚本库的状态，状态变了就把命令重新登记一遍。
// 命令的名字是 FoliumLabel（各语言都写在这里）；运行后的提示走模组的语言表。

const label = (zh: string, en: string, id: string, vi: string): FoliumLabel => ({ 'zh-CN': zh, en, in: id, vi });
const plain = (text: string): FoliumLabel => ({ 'zh-CN': text, en: text, in: text, vi: text });

const PLATFORM_LABELS: Record<string, FoliumLabel> = {
    kw: label('酷我', 'Kuwo', 'Kuwo', 'Kuwo'),
    kg: label('酷狗', 'Kugou', 'Kugou', 'Kugou'),
    tx: label('QQ 音乐', 'QQ Music', 'QQ Music', 'QQ Music'),
    wy: label('网易云', 'NetEase', 'NetEase', 'NetEase'),
};

export interface LxCommandsEnv {
    transport: LxTransport;
    register(def: FoliumCommandDef): FoliumRegistryHandle;
    translate(key: string, params?: Record<string, string | number>): string;
    /** 脚本库的状态变了（导入、切换、移除、换平台之后）。 */
    onState(state: LxState): void;
}

const scriptLabel = (script: LxState['scripts'][number]): FoliumLabel => (
    plain(script.version ? `${script.name} (${script.version})` : script.name)
);

/** 登记命令；回一个「状态变了，重新登记」的函数。 */
export const createLxCommands = (env: LxCommandsEnv): ((state: LxState) => void) => {
    let dynamic: FoliumRegistryHandle[] = [];
    const apply = (state: LxState) => {
        env.onState(state);
        return state;
    };

    env.register({
        id: 'import-script',
        label: label('洛雪音源：导入自定义源脚本…', 'LX Music Source: Import a custom source script…', 'LX Music Source: Impor skrip sumber kustom…', 'LX Music Source: Nhập tập lệnh nguồn tùy chỉnh…'),
        description: label(
            '选一个洛雪「自定义源」脚本文件。脚本是第三方代码，来源由你自己负责。',
            'Pick an LX Music “custom source” script file. The script is third-party code; where it comes from is your responsibility.',
            'Pilih berkas skrip “sumber kustom” LX Music. Skrip adalah kode pihak ketiga; asal-usulnya menjadi tanggung jawab Anda.',
            'Chọn tệp tập lệnh “nguồn tùy chỉnh” của LX Music. Tập lệnh là mã của bên thứ ba; bạn tự chịu trách nhiệm về nguồn gốc của nó.',
        ),
        keywords: ['lx', 'lxmusic', '洛雪', 'script', '脚本', '音源'],
        async run() {
            try {
                const state = await env.transport.request<LxState | null>('importScript');
                if (!state) return { message: env.translate('import.cancelled') };
                apply(state);
                const added = state.scripts.find(script => script.id === state.activeId);
                return { message: env.translate('import.done', { name: added?.name ?? '' }) };
            } catch (error) {
                if (error instanceof LxImportFailed) return { message: env.translate(`import.failed.${error.reason}`) || env.translate('import.failed.load-failed') };
                throw error;
            }
        },
    });

    const registerDynamic = (state: LxState) => {
        for (const handle of dynamic) handle.unregister();
        dynamic = [];
        if (state.scripts.length === 0) return;
        const scripts = state.scripts.map(script => ({ value: script.id, label: scriptLabel(script) }));
        if (state.scripts.length > 1) {
            dynamic.push(env.register({
                id: 'select-script',
                label: label('洛雪音源：切换自定义源脚本', 'LX Music Source: Switch the custom source script', 'LX Music Source: Ganti skrip sumber kustom', 'LX Music Source: Đổi tập lệnh nguồn tùy chỉnh'),
                keywords: ['lx', 'lxmusic', '洛雪', 'script', '脚本'],
                params: [{
                    key: 'script', type: 'select', options: scripts, defaultValue: state.activeId ?? scripts[0].value,
                    label: label('脚本', 'Script', 'Skrip', 'Tập lệnh'),
                }],
                async run({ values }) {
                    const next = apply(await env.transport.request<LxState>('selectScript', String(values.script)));
                    return { message: env.translate('select.done', { name: next.scripts.find(script => script.id === next.activeId)?.name ?? '' }) };
                },
            }));
        }
        dynamic.push(env.register({
            id: 'remove-script',
            label: label('洛雪音源：移除自定义源脚本', 'LX Music Source: Remove a custom source script', 'LX Music Source: Hapus skrip sumber kustom', 'LX Music Source: Xóa tập lệnh nguồn tùy chỉnh'),
            keywords: ['lx', 'lxmusic', '洛雪', 'script', '脚本'],
            params: [{
                key: 'script', type: 'select', options: scripts, defaultValue: state.activeId ?? scripts[0].value,
                label: label('脚本', 'Script', 'Skrip', 'Tập lệnh'),
            }],
            async run({ values }) {
                const removed = state.scripts.find(script => script.id === String(values.script));
                apply(await env.transport.request<LxState>('removeScript', String(values.script)));
                return { message: env.translate('remove.done', { name: removed?.name ?? '' }) };
            },
        }));
        if (state.platforms.length > 1) {
            dynamic.push(env.register({
                id: 'search-platform',
                label: label('洛雪音源：切换搜索平台', 'LX Music Source: Switch the platform searched', 'LX Music Source: Ganti platform pencarian', 'LX Music Source: Đổi nền tảng tìm kiếm'),
                description: label(
                    '搜索、榜单用哪一家的曲库。只列当前脚本支持的平台。',
                    'Which platform’s catalog the search and charts use. Only the platforms the current script serves are listed.',
                    'Katalog platform mana yang dipakai pencarian dan tangga lagu. Hanya platform yang didukung skrip saat ini yang ditampilkan.',
                    'Tìm kiếm và bảng xếp hạng dùng danh mục của nền tảng nào. Chỉ liệt kê các nền tảng mà tập lệnh hiện tại hỗ trợ.',
                ),
                keywords: ['lx', 'lxmusic', '洛雪', 'platform', '平台'],
                params: [{
                    key: 'platform', type: 'select', defaultValue: state.platform ?? state.platforms[0],
                    options: state.platforms.map(key => ({ value: key, label: PLATFORM_LABELS[key] ?? plain(key) })),
                    label: label('平台', 'Platform', 'Platform', 'Nền tảng'),
                }],
                async run({ values }) {
                    const next = apply(await env.transport.request<LxState>('setPlatform', String(values.platform)));
                    return { message: env.translate('platformSwitch.done', { platform: env.translate(`platform.${next.platform ?? 'other'}`) }) };
                },
            }));
        }
    };

    return registerDynamic;
};
