// .github/scripts/triage/lib/comments.mjs
// bot 评论的模板与隐藏 marker。marker 里存 bot 自己的状态（追问时间、模块、TL;DR 等），
// 下一次运行靠它 upsert 同一条评论，不刷屏。所有对外文字都出自这里的固定模板。

const MARKER_PREFIX = '<!-- folia-triage:v1 ';
const MARKER_RE = /<!-- folia-triage:v1 (\{[\s\S]*?\}) -->/;

export function renderMarker(state) {
    // JSON 里出现 `-->` 会提前结束 HTML 注释，把 `>` 转义掉。
    return `${MARKER_PREFIX}${JSON.stringify(state).replace(/>/g, '\\u003e')} -->`;
}

export function parseMarker(body) {
    const match = MARKER_RE.exec(String(body ?? ''));
    if (!match) return null;
    try {
        const state = JSON.parse(match[1]);
        return state && typeof state === 'object' && typeof state.kind === 'string' ? state : null;
    } catch {
        return null;
    }
}

export const hasMarker = body => String(body ?? '').includes('<!-- folia-triage');

// 在评论列表里找 bot 自己发的、指定 kind 的最新一条。
export function findBotComment(comments, botLogin, kind) {
    for (let index = comments.length - 1; index >= 0; index -= 1) {
        const comment = comments[index];
        if (comment.author !== botLogin) continue;
        const state = parseMarker(comment.body);
        if (state?.kind === kind) return { comment, state };
    }
    return null;
}

const FOOTER = '<sub>由 triage bot 自动处理。判断有误请直接回复，维护者会复核。</sub>';

const MISSING_ITEMS = {
    version: 'Folia 版本号：打开 Folia，点击左上角问号按钮，复制中间一行表示版本号的文字',
    deployment: '部署类型：electron 桌面版 / vercel / 其他在线部署',
    errorLog: '报错信息：按 `Ctrl+Shift+I` 打开 devtools，切到 console，重现问题后复制红色报错（或截图）',
    description: '问题描述与重现步骤',
    qrDiagnostics: '扫码诊断信息：Folia 已把诊断复制到剪贴板，直接粘贴到这里即可',
};

export const PROVIDER_REQUEST_TEXT = '添加新的平台需要对应平台的 API 后端。我们会尽可能支持用户需求较高的平台，但这类功能需要较长时间评估，因此无法保证实现。';
export const APPLE_MUSIC_TEXT = 'Apple Music 平台短期内不会支持，因为该平台对第三方接入有非常严格的限制。';

// 扫码登录诊断段落。已知原因的处理步骤出自维护者写的 login-playbook.json；
// AI 只贡献 analysis 与 suggestions 两段文字（已在 schema.mjs 无害化），并明确标注来源。
export function renderDiagnosisSection(diagnosis, playbook) {
    const byId = new Map(playbook.causes.map(cause => [cause.id, cause]));
    const causes = diagnosis.causes.map(id => byId.get(id)).filter(Boolean);
    const suggestions = diagnosis.suggestions ?? [];
    if (!causes.length && !diagnosis.analysis && !suggestions.length) return null;
    const lines = ['### 登录问题初步诊断'];
    lines.push(diagnosis.analysis
        ? `> 以下分析由 AI 根据诊断报告自动生成，可能不准确，维护者会复核。\n\n${diagnosis.analysis}`
        : '根据诊断报告自动匹配到以下已知问题，维护者会复核。');
    causes.forEach((cause, index) => {
        const heading = causes.length > 1 ? `可能原因 ${index + 1}` : '可能原因';
        lines.push(`**${heading}：${cause.title}**\n${cause.steps.map((step, n) => `${n + 1}. ${step}`).join('\n')}`);
    });
    if (suggestions.length) {
        lines.push(`**${causes.length ? '其他排查建议' : '排查建议'}**（AI 生成）\n${suggestions.map(item => `- ${item}`).join('\n')}`);
    }
    lines.push(diagnosis.needsMaintainer
        ? '自动诊断不能完全解释这个问题，维护者会进一步排查。可以先试试上面的方法，有新进展请直接回复。'
        : '按上面的方法处理后如果已经能正常登录，可以直接关闭本 issue；仍然失败请回复说明，维护者会跟进。');
    return lines.join('\n\n');
}

// 截止日期按北京时间写给人看（仓库以中文用户为主）。
const beijingDate = iso => new Date(Date.parse(iso) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

// 请作者拆分或改写的段落。只说内容的问题，不揣测是怎么写出来的：判断可能有误，措辞要经得起误判。
export function renderRewriteSection({ deadline, days }) {
    return [
        '### 请拆分或改写这个 issue',
        '这个 issue 一次提出了很多项彼此独立的需求，维护者没法逐条讨论、评估和跟进。请二选一：',
        '- 改写成**一个**具体的需求：说明你遇到的实际场景、现在哪里不方便、希望怎样改，其余的先删掉；',
        '- 或者把每一项拆成单独的 issue 分别提交，再把这里改成其中一项。',
        '',
        `请在 ${days} 天内（北京时间 ${beijingDate(deadline)} 前）编辑这个 issue，改好后标记会自动撤掉；到期仍未修改将自动关闭。`,
    ].join('\n');
}

export function renderRewriteComment({ at, deadline, days }) {
    return [renderMarker({ kind: 'rewrite', at }), renderRewriteSection({ deadline, days }), FOOTER].join('\n\n');
}

// 统一的 triage 评论。sections 里每一项都可缺省，缺省就不渲染对应段落。
export function renderTriageComment({ state, module, moduleDescription, tldr, diagnosis, playbook, providerRequest, missing, infoReceived, related, reason, rateLimited, rewrite, rewriteReceived }) {
    const parts = [renderMarker(state)];
    if (module) {
        parts.push(`**初步归属模块**：\`${module}\`（${moduleDescription}）\n<sub>自动判断，如有误维护者可直接修改 \`module: *\` 标签。</sub>`);
    }
    if (tldr?.length) {
        parts.push(`### TL;DR\n> 由 AI 自动生成，可能不准确，以原文为准。\n\n${tldr.map(line => `- ${line}`).join('\n')}`);
    }
    const diagnosisSection = diagnosis && playbook ? renderDiagnosisSection(diagnosis, playbook) : null;
    if (diagnosisSection) parts.push(diagnosisSection);
    if (providerRequest) {
        const lines = [PROVIDER_REQUEST_TEXT];
        if (providerRequest.appleMusic) lines.push(APPLE_MUSIC_TEXT);
        for (const issue of providerRequest.inProgress) lines.push(`相关平台的支持正在开发中，进度见 #${issue}。`);
        parts.push(`### 关于新平台支持\n${lines.join('\n\n')}`);
    }
    if (rewrite) parts.push(renderRewriteSection(rewrite));
    else if (rewriteReceived) parts.push('### 请拆分或改写这个 issue\n已收到修改，等待维护者处理。');
    if (missing?.length) {
        parts.push(`### 需要补充的信息\n为了定位问题，请补充以下内容（编辑 issue 或直接回复都可以）：\n${missing.map(key => `- [ ] ${MISSING_ITEMS[key]}`).join('\n')}\n\n超过 14 天未补充，issue 会被自动关闭。`);
    } else if (infoReceived) {
        parts.push('### 需要补充的信息\n已收到补充信息，等待维护者处理。');
    }
    if (related?.length) {
        parts.push(`### 可能相关\n${related.map(number => `- #${number}`).join('\n')}`);
    }
    if (rateLimited) {
        parts.push('<sub>当前自动分类请求较多，详细分类稍后补充。</sub>');
    }
    if (reason) {
        parts.push(`<details><summary>分类依据</summary>\n\n${reason}\n\n</details>`);
    }
    parts.push(FOOTER);
    return parts.join('\n\n');
}

// 作者后来补了诊断报告时单独回一条：更新 triage 评论不会触发通知，用户看不到。
export function renderDiagnosisComment({ at, reportHash, section }) {
    return [renderMarker({ kind: 'diagnosis', reportHash, at }), section, FOOTER].join('\n\n');
}

const CLOSE_TEXT = {
    'qr-aggregate': ({ target }) => `这份扫码登录诊断与 #${target} 属于同一类问题，已合并到 #${target} 统一跟踪。如果你认为是不同的问题，请直接回复说明。`,
    'web-deployment': ({ causes }) => [
        '这份诊断来自自行部署的网页版：登录失败是因为这个网站没有配置音乐平台的 API 服务，或者连不上它。这是部署配置问题，不是 Folia 本身的 bug，已关闭。',
        '如果你只是在使用别人部署的网站，请把诊断报告交给这个网站的部署者；如果你就是部署者，可以按下面的步骤处理：',
        ...causes.map(cause => `**${cause.title}**\n${cause.steps.map((step, n) => `${n + 1}. ${step}`).join('\n')}`),
        '在官方版本（[GitHub Releases](https://github.com/chthollyphile/folia-major/releases) 的桌面版，或官方 Docker 镜像）上也能复现的话，请用官方版本重新生成诊断后回复，维护者会复核。',
    ].join('\n\n'),
    'unofficial-build': () => [
        '诊断报告显示这不是 Folia 仓库 CI 构建的官方版本，也不是文档里的自部署方式（`build: unofficial`），可能是他人打包、fork 或修改过的版本，本仓库无法排查其中的问题，已关闭。',
        '请向提供这个版本的人反馈。如果在官方版本（[GitHub Releases](https://github.com/chthollyphile/folia-major/releases) 的桌面版，或官方 Docker 镜像）上也能复现，请用官方版本重新生成诊断后回复，维护者会复核。',
    ].join('\n\n'),
    duplicate: ({ target }) => `该 issue 与 #${target} 重复，已关闭，请在 #${target} 继续讨论。`,
    invalid: () => '该 issue 没有有效内容，已关闭。请按模板重新填写后回复，或重新提交。',
    out_of_scope: ({ topicDescription }) => `该请求属于「${topicDescription}」，超出 Folia 项目范围，已关闭。`,
    'needs-info-timeout': ({ days }) => `超过 ${days} 天未补充所需信息，已自动关闭。补充信息后回复即可，维护者会复核。`,
    'rewrite-timeout': ({ days }) => `超过 ${days} 天没有拆分或改写，已自动关闭。欢迎把其中最重要的一项需求单独整理成新的 issue 提交。`,
    stale: ({ days }) => `该 issue 被标记为 stale 后 ${days} 天仍无活动，已自动关闭。如果问题依然存在，请回复说明。`,
};

export function renderCloseComment(reason, details) {
    return [renderMarker({ kind: 'close', reason, at: details.at }), CLOSE_TEXT[reason](details), FOOTER].join('\n\n');
}

export function renderStaleComment({ at, inactiveDays, closeAfterDays, willClose, isPullRequest = false }) {
    const tail = willClose ? `${closeAfterDays} 天内仍无活动将自动关闭。` : `${isPullRequest ? 'PR' : '这类 issue'}不会被自动关闭。`;
    return [renderMarker({ kind: 'stale', at }), `该条目已 ${inactiveDays} 天无活动，标记为 stale。${tail}回复即可取消标记。`, FOOTER].join('\n\n');
}

export function renderPrComment({ state, titleHint, pausedHits, scope }) {
    const parts = [renderMarker(state)];
    if (titleHint) {
        parts.push('### 标题格式\nPR 标题建议使用 `类型(范围): 描述` 的格式，例如 `fix(qq): 修复扫码登录失败`。类型可选 feat / fix / docs / refactor / perf / test / chore。');
    }
    for (const hit of pausedHits ?? []) {
        const files = hit.files.slice(0, 10).map(file => `- \`${file}\``).join('\n');
        const more = hit.files.length > 10 ? `\n- …以及另外 ${hit.files.length - 10} 个文件` : '';
        parts.push(`### 涉及暂停接受的区域\n根据 #${hit.announcement}${hit.note ? `（${hit.note}）` : ''}，以下改动所在区域暂停接受 PR，合并前请先与维护者确认：\n${files}${more}`);
    }
    if (scope) {
        parts.push(`### 改动规模\n排除 lockfile、代码地图和快照后，本 PR 改动 ${scope.lines} 行、${scope.files} 个文件，超过建议上限（${scope.maxLines} 行 / ${scope.maxFiles} 个文件）。建议拆成多个独立的 PR，便于审阅。`);
    }
    if (parts.length === 1) parts.push('之前提示的问题已解决。');
    parts.push(FOOTER);
    return parts.join('\n\n');
}

export function renderBreakerNotice({ windowKey, reasons, at }) {
    return [renderMarker({ kind: 'breaker', windowKey, at }), `**triage 熔断已触发**（${windowKey}）\n\n${reasons.map(reason => `- ${reason}`).join('\n')}\n\n熔断期间新 issue 只走确定性规则，并打上 \`bot: rate-limited\`，解除后由定时任务补跑分类。`].join('\n\n');
}
