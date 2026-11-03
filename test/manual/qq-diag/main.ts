import {
    PUBLIC_PLAYLIST_CONTROL_ID,
    probeQqPlaylistDetail,
    probeQqPlaylists,
    type QqPlaylistDetailProbe,
    type QqPlaylistProbeEntry,
} from '../../../src/services/onlineMusic/qq/qqPlaylistDiagnostics';

// test/manual/qq-diag/main.ts

/**
 * 手动诊断台：定位「QQ 自建歌单全部加载为空」。
 *
 * 之所以做成独立页面而不是主应用里的面板：需要看的是原始标识字段和上游状态码，正常 UI 刻意
 * 把这些都正规化掉了；而且这条链路坏掉时主应用恰好什么都不显示，没有可依附的入口。
 */

const root = document.getElementById('root')!;
const collected: Record<string, unknown> = {};

const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const card = (title: string): HTMLDivElement => {
    const box = el('div', 'card');
    box.appendChild(el('h2', undefined, title));
    root.appendChild(box);
    return box;
};

const dump = (parent: HTMLElement, value: unknown): HTMLPreElement => {
    const pre = el('pre', undefined, JSON.stringify(value, null, 2));
    parent.appendChild(pre);
    return pre;
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** 把一次详情探测渲染成一行结论，避免用户自己读 JSON 判断成败。 */
const verdict = (probe: QqPlaylistDetailProbe): { text: string; className: string } => {
    if (probe.error && !probe.ok) return { text: `请求失败：${probe.error}`, className: 'bad' };
    if (!probe.ok) return { text: '上游没有返回歌单本体（cdlist 为空）', className: 'bad' };
    // 🔴 只有 1 是公开：不公开实测是 2，truthy 判断会把它显示成公开。
    const visibility = probe.dirShow === undefined ? '' : `（dir_show=${probe.dirShow}${probe.dirShow === 1 ? ' 公开' : ' 不公开'}）`;
    if (probe.songlistLength === 0) {
        return { text: `返回了歌单，但 songlist 是空的${visibility}`, className: 'warn' };
    }
    return { text: `返回 ${probe.songlistLength} 首${visibility}`, className: 'ok' };
};

const renderDetail = (parent: HTMLElement, probe: QqPlaylistDetailProbe): void => {
    const line = verdict(probe);
    parent.appendChild(el('div', `meta ${line.className}`, `→ ${line.text}`));
    dump(parent, probe);
};

const sessionCard = (): void => {
    const box = card('1. 会话');
    const hasToken = Boolean(localStorage.getItem('online_provider:qq:cookie'));
    box.appendChild(el(
        'div',
        `meta ${hasToken ? 'ok' : 'bad'}`,
        hasToken ? '已检测到 QQ 登录态' : '没有登录态：请先回主站登录 QQ 音乐，再刷新本页',
    ));
};

const playlistCard = (): void => {
    const box = card('2. 歌单列表（带鉴权）');
    const run = el('button', 'primary', '读取我的歌单');
    box.appendChild(run);
    const output = el('div');
    box.appendChild(output);

    run.onclick = async () => {
        run.disabled = true;
        output.replaceChildren();
        try {
            const entries = await probeQqPlaylists();
            collected.playlists = entries;
            output.appendChild(el('div', 'meta', `共 ${entries.length} 个集合。`));
            entries.forEach(entry => output.appendChild(playlistRow(entry)));
        } catch (error) {
            output.appendChild(el('div', 'meta bad', errorText(error)));
        } finally {
            run.disabled = false;
        }
    };
};

const playlistRow = (entry: QqPlaylistProbeEntry): HTMLElement => {
    const row = el('div', 'row');
    row.appendChild(el('div', 'name', entry.name || '(无名)'));
    row.appendChild(el(
        'div',
        'meta',
        `归一化 id=${entry.normalizedId}`
        + `${entry.trackCount === undefined ? '' : ` · 卡片显示 ${entry.trackCount} 首`}`,
    ));
    row.appendChild(el('div', 'meta', `身份字段 ${JSON.stringify(entry.identity)}`));
    row.appendChild(el('div', 'meta', `上游键名 ${entry.rawKeys.join(', ')}`));

    const test = el('button', undefined, '测这个歌单的详情');
    row.appendChild(test);
    const output = el('div');
    row.appendChild(output);

    test.onclick = async () => {
        test.disabled = true;
        output.replaceChildren();
        const probe = await probeQqPlaylistDetail(entry.normalizedId);
        const key = `detail:${entry.name || entry.normalizedId}`;
        collected[key] = probe;
        renderDetail(output, probe);
        test.disabled = false;
    };
    return row;
};

const controlCard = (): void => {
    const box = card('3. 对照组：一个公开歌单（匿名路由）');
    box.appendChild(el(
        'div',
        'meta',
        `用 disstid=${PUBLIC_PLAYLIST_CONTROL_ID} 打同一条路由。它出歌、自建歌单不出歌，`
        + '就说明路由本身是通的，问题在歌单可见性或 id 语义上。',
    ));
    const run = el('button', undefined, '跑对照组');
    box.appendChild(run);
    const output = el('div');
    box.appendChild(output);

    run.onclick = async () => {
        run.disabled = true;
        output.replaceChildren();
        const probe = await probeQqPlaylistDetail(PUBLIC_PLAYLIST_CONTROL_ID);
        collected.publicControl = probe;
        renderDetail(output, probe);
        run.disabled = false;
    };
};

const manualCard = (): void => {
    const box = card('4. 手动测任意 disstid');
    const input = el('input') as HTMLInputElement;
    input.placeholder = '输入 disstid / tid';
    input.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 11px;border-radius:9px;'
        + 'border:1px solid #3a3d46;background:#121317;color:#e8e8ea;font-size:13px;margin-bottom:8px;';
    box.appendChild(input);
    const run = el('button', undefined, '测这个 id');
    box.appendChild(run);
    const output = el('div');
    box.appendChild(output);

    run.onclick = async () => {
        const value = input.value.trim();
        if (!value) return;
        run.disabled = true;
        output.replaceChildren();
        const probe = await probeQqPlaylistDetail(value);
        collected[`manual:${value}`] = probe;
        renderDetail(output, probe);
        run.disabled = false;
    };
};

const exportCard = (): void => {
    const box = card('5. 导出结果');
    box.appendChild(el('div', 'meta', '把上面跑过的结果一次性复制出来，贴回对话即可。'));
    const copy = el('button', 'primary', '复制全部结果');
    box.appendChild(copy);
    const output = el('div');
    box.appendChild(output);

    copy.onclick = async () => {
        const text = JSON.stringify(collected, null, 2);
        try {
            await navigator.clipboard.writeText(text);
            output.replaceChildren(el('div', 'meta ok', '已复制到剪贴板。'));
        } catch {
            // 移动端浏览器在非安全上下文或无用户手势时会拒绝写剪贴板，退回成可长按选中的文本。
            output.replaceChildren(el('div', 'meta warn', '剪贴板不可用，请长按下面的文本手动复制：'));
            dump(output, collected);
        }
    };
};

sessionCard();
playlistCard();
controlCard();
manualCard();
exportCard();

root.appendChild(el(
    'div',
    'note',
    '判读：第 2 步里自建歌单的「上游键名」有没有 dissid，决定了 id 取值是不是选错；'
    + '第 3 步对照组能出歌而自建歌单不出，指向匿名路由读不了非公开歌单。'
    + '把自建歌单在 QQ 音乐 App 里改成公开后重测第 2 步，是区分这两者的决定性实验。',
));
