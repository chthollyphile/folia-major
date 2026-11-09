// packages/coven/compass/compass.js
// Coven Compass 的页面脚本（浏览器里跑，不 import 任何东西）。数据都从本机服务（src/compass.mjs）的 /api/ 来，
// 请求带页面里的一次性令牌。所有来自 GitHub 和账本的文字都用 textContent 放进页面，不拼 HTML。
'use strict';

(() => {
    const TOKEN = document.querySelector('meta[name="coven-token"]').content;
    const POLL_MS = 5000;
    const RISKS = ['R0', 'R1', 'R2', 'R3', 'R4'];
    const PHASE_LABELS = {
        planning: ['规划', 'info'], 'spec-review': ['等批准', 'warn'], building: ['实现中', 'accent'], evaluating: ['评审中', 'accent'],
        pr: ['PR 已开', 'info'], done: ['完成', 'ok'], blocked: ['停着', 'bad'], released: ['放弃', ''],
    };
    const CLAIM_LABELS = { claimed: ['认领', 'info'], working: ['有 PR', 'accent'], blocked: ['停着', 'bad'], 'handed-off': ['转交', 'warn'], released: ['已释放', ''], done: ['完成', 'ok'], pending: ['发评论中', 'warn'] };
    const STATUS_LABELS = { held: ['有人持有', 'accent'], done: ['已完成', 'ok'], free: ['空闲', ''] };
    const DECISION_LABELS = { replan: '做成任务', release: '不做', hold: '先放着' };

    const view = {
        tab: 'run',
        overview: null,
        claims: null,
        claimsError: null,
        scope: { source: null, options: {}, hints: {}, list: null, listError: null, filter: { text: '', risks: new Set(RISKS), hideTaken: false }, picks: new Map(), name: '', notice: null, saving: false, openScope: null },
        history: { selected: null, detail: null },
    };

    // ---- 小工具 ----

    function h(tag, props, ...children) {
        const element = document.createElement(tag);
        for (const [key, value] of Object.entries(props ?? {})) {
            if (value === null || value === undefined || value === false) continue;
            if (key === 'class') element.className = value;
            else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
            else if (key === 'checked' || key === 'disabled' || key === 'value') element[key] = value;
            else element.setAttribute(key, value === true ? '' : String(value));
        }
        for (const child of children.flat(Infinity)) {
            if (child === null || child === undefined || child === false) continue;
            element.append(child instanceof Node ? child : String(child));
        }
        return element;
    }

    async function api(path, { method = 'GET', body } = {}) {
        const response = await fetch(path, {
            method,
            headers: { 'x-coven-token': TOKEN, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(data.error ?? `HTTP ${response.status}`), { status: response.status, data });
        return data;
    }

    const pad = number => String(number).padStart(2, '0');
    function time(iso, { date = true } = {}) {
        if (!iso) return '';
        const value = new Date(iso);
        if (Number.isNaN(value.getTime())) return String(iso);
        const clock = `${pad(value.getHours())}:${pad(value.getMinutes())}`;
        return date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${clock}` : clock;
    }
    function ago(iso) {
        const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
        if (!Number.isFinite(seconds)) return '';
        if (seconds < 60) return '刚刚';
        if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
        return `${Math.floor(seconds / 86400)} 天前`;
    }
    const tokens = (count, approx) => `${approx ? '约 ' : ''}${Number(count ?? 0).toLocaleString('zh-CN')}`;
    const chip = (label, tone = '') => h('span', { class: `chip ${tone}` }, label);
    const tempo = (risk, label) => h('span', { class: `tempo ${risk}`, title: risk }, label ?? `${view.overview?.tempos?.[risk] ?? risk}（${risk}）`);
    const phaseChip = phase => chip(...(PHASE_LABELS[phase] ?? [phase, '']));
    const link = (href, text) => (href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text) : text);
    const command = (name, args) => (view.overview?.commandStyle === 'npm' ? `npm run coven:${name} -- ${args}` : `coven ${name} ${args}`);

    function setStatus(text, isError = false) {
        const status = document.getElementById('status');
        status.textContent = text;
        status.classList.toggle('error', isError);
    }

    function replace(id, ...children) {
        const container = document.getElementById(id);
        container.replaceChildren(...children.flat().filter(Boolean));
    }

    // ---- 运行 ----

    function renderRun() {
        const overview = view.overview;
        if (!overview) return replace('tab-run', h('div', { class: 'card empty' }, '读取中……'));
        const run = overview.run;
        if (!run) {
            return replace('tab-run', h('div', { class: 'card empty' },
                h('strong', null, '没有进行中的运行'),
                '这个检出里没有 .coven/state.json。到“划范围”挑一批条目存成范围，再告诉监控 session 用它开一次运行。'));
        }
        if (run.error) return replace('tab-run', h('div', { class: 'card empty error-text' }, `读不了账本：${run.error}`));
        const totals = run.totals ?? {};
        const overhead = Object.entries(totals.overhead ?? {}).map(([role, count]) => `${role} ${tokens(count)}`).join('、');
        const head = h('div', { class: 'card' },
            h('div', { class: 'run-head' },
                h('span', { class: 'run-title' }, run.label),
                run.dryRun ? chip('干跑', 'warn') : chip('真跑', 'accent'),
                run.finishedAt ? chip(`已收尾 ${time(run.finishedAt)}`, 'ok') : chip('进行中', 'info')),
            h('div', { class: 'meta' },
                h('span', null, '范围 ', h('b', null, run.scopeLabel), ' ', h('span', { class: 'faint mono' }, run.scope)),
                h('span', null, '集成分支 ', h('code', null, run.integrationBranch)),
                h('span', null, '跟踪 issue ', run.trackingIssue ? link(run.trackingIssueUrl, `#${run.trackingIssue}`) : '无'),
                h('span', null, '维护者 ', h('b', null, `@${run.owner}`)),
                h('span', null, '开始 ', h('b', null, time(run.startedAt)))),
            h('div', { class: 'tiles' },
                tile('任务', totals.tasks ?? 0, `完成 ${totals.done ?? 0} · PR ${totals.prs ?? 0} · 停着 ${totals.blocked ?? 0}`),
                tile('人类介入', run.interventions.length, summarizeKinds(run.interventions)),
                tile('用量（token）', tokens(totals.tokens, totals.approxTokens), overhead ? `不属于任务的：${overhead}` : (totals.approxTokens ? '含估算值' : '')),
                tile('GitHub 写操作', totals.githubWrites ?? 0, run.dryRun ? '干跑：只记在本地' : '收尾时 audit 对账')));
        return replace('tab-run', head, tasksCard(run), escalationsCard(run), interventionsCard(run));
    }

    function tile(label, value, sub) {
        return h('div', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, String(value)), sub ? h('div', { class: 'sub' }, sub) : null);
    }

    function summarizeKinds(list) {
        const counts = {};
        for (const entry of list) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
        return Object.entries(counts).map(([kind, count]) => `${kind} ×${count}`).join(' · ');
    }

    function tasksCard(run) {
        if (run.tasks.length === 0) {
            const claimed = run.items.filter(item => item.claim === 'claimed' && !item.task).length;
            return h('div', { class: 'card' }, h('h2', null, '任务'), h('p', { class: 'muted' }, claimed > 0 ? `认领了 ${claimed} 条，还没分进任务（等 planner）。` : '还没有任务。'));
        }
        const rows = run.tasks.map(task => h('tr', null,
            h('td', null, h('div', null, h('b', null, task.label)), h('div', { class: 'faint small mono' }, task.id), task.prTitle ? h('div', { class: 'muted small' }, task.prTitle) : null),
            h('td', null, tempo(task.risk, task.tempo)),
            h('td', null, phaseChip(task.phase), task.code ? h('div', { class: 'small error-text' }, task.code) : null),
            h('td', { class: 'num' }, String(task.rounds)),
            h('td', { class: 'num nowrap' }, tokens(task.tokens, task.approxTokens)),
            h('td', { class: 'nowrap' }, task.pr ? link(task.prUrl, task.prLabel) : h('span', { class: 'faint' }, '—')),
            h('td', { class: 'small' }, task.lastVerdict ? `第 ${task.lastVerdict.round} 轮 ${task.lastVerdict.passes ? '通过' : (task.lastVerdict.verdict ?? '没过')}` : h('span', { class: 'faint' }, '—')),
            h('td', { class: 'small' }, [...task.codes, ...task.escalations].join('、') || h('span', { class: 'faint' }, '—'))));
        return h('div', { class: 'card' },
            h('h2', null, '任务', h('span', { class: 'count' }, `${run.tasks.length} 个`)),
            h('div', { class: 'table-wrap' }, h('table', null,
                h('thead', null, h('tr', null, h('th', null, '任务'), h('th', null, '风险'), h('th', null, '阶段'), h('th', { class: 'num' }, '轮数'), h('th', { class: 'num' }, 'token'), h('th', null, 'PR'), h('th', null, '最近评审'), h('th', null, '停过'))),
                h('tbody', null, rows))));
    }

    function escalationsCard(run) {
        if (run.escalations.length === 0) return null;
        const open = run.escalations.filter(entry => entry.open).length;
        return h('div', { class: 'card' },
            h('h2', null, '升级', h('span', { class: 'count' }, open > 0 ? `${open} 条等着` : '都了结了')),
            run.escalations.map(entry => h('div', { class: `escalation${entry.open ? ' open' : ''}` },
                h('div', null, h('b', null, entry.id ?? `任务 ${entry.task}`), ' ', chip(entry.code ?? '停着', entry.open ? 'warn' : ''), ' ', h('span', { class: 'muted small' }, entry.result)),
                h('div', { class: 'small mono muted' }, (entry.open ? entry.openItems : entry.items).join('，')),
                entry.question ? h('div', { class: 'q' }, entry.question) : null,
                entry.options.length > 0 ? h('ul', null, entry.options.map(option => h('li', null, option))) : null,
                entry.lean ? h('div', { class: 'small muted' }, `planner 倾向：${entry.lean}`) : null,
                entry.decision
                    ? h('div', { class: 'decision' }, chip(`HD4 · ${DECISION_LABELS[entry.decision.outcome] ?? entry.decision.outcome}`, 'accent'), ` @${entry.decision.by}：${entry.decision.note}`)
                    : (entry.open && entry.id ? h('div', { class: 'decision muted small' }, `等维护者决定：${command('state', `hd HD4 --escalation ${entry.id} --decision replan|release|hold --by <账号> --note "…"`)}`) : null))));
    }

    function interventionsCard(run) {
        if (run.interventions.length === 0) return null;
        return h('div', { class: 'card' },
            h('h2', null, '人类介入', h('span', { class: 'count' }, `${run.interventions.length} 次`)),
            h('ul', { class: 'timeline' }, [...run.interventions].reverse().map(entry => h('li', null,
                h('span', { class: 'muted small' }, time(entry.at)),
                h('span', null, chip(entry.kind, 'accent')),
                h('span', null, entry.note ?? '')))));
    }

    // ---- 认领 ----

    function renderClaims() {
        const claims = view.claims;
        const overview = view.overview;
        const toolbar = h('div', { class: 'toolbar' },
            h('button', { type: 'button', class: 'btn primary', onclick: () => loadClaims(true) }, claims ? '重新读一次' : '从 GitHub 读认领'),
            claims?.available ? h('span', { class: 'muted small' }, `跟踪 issue `, link(claims.issueUrl, `#${claims.issue}`), ` · 读于 ${time(claims.readAt)}（${ago(claims.readAt)}）`) : null,
            h('span', { class: 'faint small' }, '借本机 gh 读评论，判定和 coven claim status 一样'));
        if (view.claimsError) return replace('tab-claims', h('div', { class: 'card' }, toolbar, h('div', { class: 'notice bad' }, view.claimsError)));
        if (!claims) {
            return replace('tab-claims', h('div', { class: 'card' }, toolbar,
                h('p', { class: 'muted' }, overview?.config?.trackingIssue ? `认领评论在跟踪 issue #${overview.config.trackingIssue} 上。点上面的按钮读一次（会调用 gh）。` : '配置里没有跟踪 issue。')));
        }
        if (!claims.available) return replace('tab-claims', h('div', { class: 'card' }, toolbar, h('div', { class: 'notice info' }, claims.reason)));
        const counts = { held: 0, done: 0, free: 0 };
        for (const entry of claims.items) counts[entry.status] += 1;
        const rows = claims.items.map(entry => {
            const holder = entry.holder;
            return h('tr', null,
                h('td', { class: 'key' }, entry.item),
                h('td', null, chip(...STATUS_LABELS[entry.status])),
                h('td', null, holder ? [h('b', null, `@${holder.owner}`), holder.mine ? chip('这个检出', 'accent') : null, holder.manual ? chip('手写', 'warn') : null] : h('span', { class: 'faint' }, '—')),
                h('td', null, holder ? [chip(...(CLAIM_LABELS[holder.state] ?? [holder.state, ''])), holder.code ? ` ${holder.code}` : '', holder.pr ? [' ', link(holder.prUrl, holder.prLabel)] : null] : null),
                h('td', { class: 'nowrap small' }, holder && entry.status === 'held' ? `${time(holder.leaseUntil)}` : ''),
                h('td', { class: 'small' },
                    entry.conflicts.map(claim => h('div', { class: 'error-text' }, `D830 冲突：@${claim.owner}`)),
                    entry.expired.map(claim => h('div', { class: 'muted' }, `D832 过期：@${claim.owner}`))));
        });
        replace('tab-claims',
            h('div', { class: 'card' },
                toolbar,
                h('div', { class: 'tiles' }, tile('有人持有', counts.held), tile('已完成', counts.done), tile('空闲（过期的）', counts.free)),
                h('h3', null, '条目'),
                claims.items.length === 0 ? h('p', { class: 'muted' }, '跟踪 issue 上还没有 coven: 认领评论。') : h('div', { class: 'table-wrap' }, h('table', null,
                    h('thead', null, h('tr', null, h('th', null, '条目'), h('th', null, '状态'), h('th', null, '持有人'), h('th', null, '认领'), h('th', null, '租约至'), h('th', null, '其他'))),
                    h('tbody', null, rows)))),
            claims.ignored.length > 0 ? h('div', { class: 'card' },
                h('h2', null, '没算数的 coven: 评论', h('span', { class: 'count' }, `${claims.ignored.length} 条`)),
                h('ul', null, claims.ignored.map(entry => h('li', { class: 'small' }, `评论 ${entry.commentId}（@${entry.author}）：${entry.code ? `${entry.code} ` : ''}${entry.reason}`)))) : null);
    }

    async function loadClaims(refresh) {
        setStatus('读认领评论……');
        try {
            view.claims = await api(`/api/claims${refresh ? '?refresh=1' : ''}`);
            view.claimsError = null;
            setStatus(`认领读于 ${time(view.claims.readAt ?? new Date().toISOString(), { date: false })}`);
        } catch (error) {
            view.claimsError = error.message;
            setStatus('读认领失败', true);
        }
        renderClaims();
        // 候选里标的“谁持有”跟着更新
        if (view.scope.list) await listCandidates({ quiet: true, source: view.scope.list.source, options: view.scope.list.options });
    }

    // ---- 划范围 ----

    const scopeKey = (source, options) => `${source}?${Object.entries(options).map(([key, values]) => `${key}=${values.join(',')}`).join('&')}`;
    const splitValues = text => text.split(',').map(value => value.trim()).filter(Boolean);

    function renderScope() {
        const overview = view.overview;
        if (!overview) return replace('tab-scope', h('div', { class: 'card empty' }, '读取中……'));
        const scope = view.scope;
        const source = overview.sources.find(entry => entry.name === scope.source);
        const picker = h('div', { class: 'card' },
            h('h2', null, '来源', h('span', { class: 'count' }, `适配层 ${overview.adapter}`)),
            h('div', { class: 'sources' }, overview.sources.map(entry => h('button', {
                type: 'button', class: 'source', 'aria-pressed': String(entry.name === scope.source), title: entry.describe,
                onclick: () => selectSource(entry.name),
            }, entry.name))),
            source ? h('p', { class: 'muted small' }, source.describe) : h('p', { class: 'muted small' }, '挑一个来源。'),
            source ? source.options.map(option => optionField(option)) : null,
            source ? h('div', { class: 'toolbar' },
                h('button', { type: 'button', class: 'btn primary', onclick: () => listCandidates() }, '列出候选'),
                h('span', { class: 'faint small' }, '选项留空就是不限（有的来源要求必须写）')) : null);
        replace('tab-scope', h('div', { class: 'scope-layout' },
            h('div', null, picker, candidatesCard(), existingScopesCard()),
            cartCard()));
    }

    // 选项框和提示按钮只改状态、就地更新，不重画整页：重画会把正要点的按钮换成新元素，那一下点击就丢了
    function optionField(option) {
        const scope = view.scope;
        const hints = scope.hints[option] ?? [];
        const buttons = [];
        const syncButtons = () => {
            const values = scope.options[option] ?? [];
            for (const button of buttons) button.setAttribute('aria-pressed', String(values.includes(button.dataset.value)));
        };
        const input = h('input', {
            type: 'text', value: (scope.options[option] ?? []).join(', '), placeholder: '多个用逗号隔开', 'aria-label': `--${option}`,
            oninput: event => {
                scope.options[option] = splitValues(event.target.value);
                syncButtons();
            },
        });
        for (const hint of hints) {
            buttons.push(h('button', {
                type: 'button', class: 'hint', 'data-value': hint.value, 'aria-pressed': 'false', title: hint.label ?? '',
                onclick: () => {
                    const next = new Set(scope.options[option] ?? []);
                    if (next.has(hint.value)) next.delete(hint.value);
                    else next.add(hint.value);
                    scope.options[option] = [...next];
                    input.value = scope.options[option].join(', ');
                    syncButtons();
                },
            }, hint.value, hint.count !== undefined ? h('span', { class: 'n' }, Number(hint.count).toLocaleString('zh-CN')) : null));
        }
        syncButtons();
        return h('div', { class: 'option' },
            h('label', null, h('code', null, `--${option}`)),
            input,
            buttons.length > 0 ? h('div', { class: 'hints' }, buttons) : null);
    }

    // 切来源、重新列候选时，晚到的旧响应不能盖掉新的：每次请求记一个序号，回来时对不上就丢掉
    let listSeq = 0;

    async function selectSource(name) {
        const scope = view.scope;
        if (scope.source === name) return;
        listSeq++;
        Object.assign(scope, { source: name, options: {}, hints: {}, list: null, listError: null });
        renderScope();
        const source = view.overview.sources.find(entry => entry.name === name);
        if (!source?.hasHints) return;
        try {
            const hints = (await api(`/api/hints?source=${encodeURIComponent(name)}`)).hints ?? {};
            if (scope.source !== name) return;
            scope.hints = hints;
        } catch (error) {
            if (scope.source !== name) return;
            setStatus(`读选项候选值失败：${error.message}`, true);
        }
        renderScope();
    }

    /** 列候选。默认用页面上现在的来源和选项；重读认领后刷新标注时，用上次列的那组。 */
    async function listCandidates({ quiet = false, source = view.scope.source, options = view.scope.options } = {}) {
        const scope = view.scope;
        if (!source) return;
        const seq = ++listSeq;
        const params = new URLSearchParams({ source });
        for (const [option, values] of Object.entries(options)) if (values.length > 0) params.set(option, values.join(','));
        if (!quiet) setStatus('列候选……');
        try {
            const result = await api(`/api/candidates?${params}`);
            if (seq !== listSeq || scope.source !== source) return;
            scope.list = result;
            scope.listError = null;
            if (!quiet) setStatus(`列出 ${result.items.length} 条`);
        } catch (error) {
            if (seq !== listSeq || scope.source !== source) return;
            scope.list = null;
            scope.listError = error.message;
            if (!quiet) setStatus('列候选失败', true);
        }
        renderScope();
    }

    function visibleCandidates() {
        const { list, filter } = view.scope;
        if (!list) return [];
        const text = filter.text.trim().toLowerCase();
        return list.items.filter(item => {
            if (!filter.risks.has(item.risk)) return false;
            if (filter.hideTaken && item.claim && (item.claim.status === 'done' || (item.claim.status === 'held' && !item.claim.mine))) return false;
            if (!text) return true;
            return [item.key, item.note, item.code, ...(item.reasons ?? [])].filter(Boolean).some(value => String(value).toLowerCase().includes(text));
        });
    }

    // 候选卡片：工具栏（筛选框、风险、隐藏已占的）只建一次，筛选时只换下面的表，输入框和输入法的组字都不受影响
    function candidatesCard() {
        const scope = view.scope;
        if (scope.listError) return h('div', { class: 'card' }, h('h2', null, '候选'), h('div', { class: 'notice bad' }, scope.listError));
        if (!scope.list) return null;
        const readAt = scope.list.claimsReadAt;
        const search = h('input', {
            type: 'search', placeholder: '按条目、代码、说明筛选', value: scope.filter.text, 'aria-label': '筛选候选',
            oninput: event => {
                if (event.isComposing) return;
                scope.filter.text = event.target.value;
                refreshCandidates();
            },
        });
        search.addEventListener('compositionend', event => {
            scope.filter.text = event.target.value;
            refreshCandidates();
        });
        const toolbar = h('div', { class: 'toolbar' },
            search,
            RISKS.map(risk => h('label', null, h('input', {
                type: 'checkbox', checked: scope.filter.risks.has(risk),
                onchange: event => { if (event.target.checked) scope.filter.risks.add(risk); else scope.filter.risks.delete(risk); refreshCandidates(); },
            }), tempo(risk, risk))),
            h('label', { title: readAt ? '' : '先读一次认领' }, h('input', {
                type: 'checkbox', checked: scope.filter.hideTaken, disabled: !readAt,
                onchange: event => { scope.filter.hideTaken = event.target.checked; refreshCandidates(); },
            }), '藏起别人持有的和已完成的'));
        // 标注用的是最近一次读到的认领：写明是什么时候读的，旧了可以重读
        const claimsLine = h('p', { class: 'faint small' },
            readAt ? `候选上标的认领读于 ${time(readAt)}（${ago(readAt)}）。` : '还没读过认领，候选上标不出谁持有。',
            ' ', h('button', { type: 'button', class: 'btn link', onclick: () => loadClaims(true) }, readAt ? '重读认领' : '现在读认领'));
        return h('div', { class: 'card', id: 'candidates-card' },
            h('h2', null, '候选'),
            toolbar,
            claimsLine,
            h('div', { id: 'candidates-body' }, candidatesBody()));
    }

    function refreshCandidates() {
        const body = document.getElementById('candidates-body');
        if (!body) return renderScope();
        body.replaceChildren(...[candidatesBody()].flat(Infinity).filter(Boolean));
    }

    function candidatesBody() {
        const scope = view.scope;
        const items = visibleCandidates();
        const groupKey = scopeKey(scope.list.source, scope.list.options);
        const isPicked = key => scope.picks.has(key);
        const pick = item => scope.picks.set(item.key, { source: scope.list.source, options: scope.list.options, group: groupKey, item });
        const toggle = (item, on) => {
            if (on) pick(item);
            else scope.picks.delete(item.key);
            refreshPicks();
        };
        const allPicked = items.length > 0 && items.every(item => isPicked(item.key));
        const claimsKnown = Boolean(scope.list.claimsReadAt);
        const count = h('p', { class: 'muted small' }, `列出 ${scope.list.items.length} 条，显示 ${items.length} 条`);
        if (items.length === 0) return [count, h('p', { class: 'muted' }, '没有符合条件的候选。')];
        const rows = items.map(item => {
            const taken = item.claim && (item.claim.status === 'done' || (item.claim.status === 'held' && !item.claim.mine));
            return h('tr', { class: `${isPicked(item.key) ? 'selected' : ''}${taken ? ' dim' : ''}` },
                h('td', null, h('input', { type: 'checkbox', checked: isPicked(item.key), 'aria-label': `选 ${item.key}`, onchange: event => toggle(item, event.target.checked) })),
                h('td', null, tempo(item.risk)),
                h('td', { class: 'nowrap' }, item.code ?? item.kind ?? ''),
                h('td', { class: 'key' }, item.key, item.note ? h('div', { class: 'muted small' }, item.note) : null, reasonsBlock(item.reasons ?? [])),
                h('td', { class: 'small' }, item.claim ? [chip(...STATUS_LABELS[item.claim.status]), item.claim.owner ? ` @${item.claim.owner}` : '', item.claim.mine ? ' （这个检出）' : ''] : h('span', { class: 'faint' }, claimsKnown ? '没人认领' : '—')));
        });
        const pickAll = event => {
            for (const item of items) {
                if (event.target.checked) pick(item);
                else scope.picks.delete(item.key);
            }
            refreshPicks();
        };
        return [count, h('div', { class: 'table-wrap' }, h('table', null,
            h('thead', null, h('tr', null,
                h('th', null, h('input', { type: 'checkbox', checked: allPicked, 'aria-label': '全选显示的', onchange: pickAll })),
                h('th', null, '风险'), h('th', null, '代码'), h('th', null, '条目'), h('th', null, '认领'))),
            h('tbody', null, rows)))];
    }

    /** 勾选变了：只换候选表和右边的范围，不重画整页（筛选框、滚动位置都留着）。 */
    function refreshPicks() {
        refreshCandidates();
        const cart = document.getElementById('cart');
        if (cart) cart.replaceWith(cartCard());
        else renderScope();
    }

    /** 敏感原因：一个目录型的条目可能碰到十几个敏感文件，只摆前三条，其余收起来。 */
    function reasonsBlock(reasons) {
        if (reasons.length === 0) return null;
        const line = reason => h('div', { class: 'small reason' }, reason);
        const head = h('div', { class: 'small' }, h('span', { class: 'chip warn' }, `敏感 ${reasons.length} 处`));
        if (reasons.length <= 3) return [head, reasons.map(line)];
        return [head, reasons.slice(0, 3).map(line), h('details', { class: 'small' }, h('summary', { class: 'muted' }, `还有 ${reasons.length - 3} 处`), reasons.slice(3).map(line))];
    }

    function cartCard() {
        const scope = view.scope;
        const picks = [...scope.picks.values()];
        const byRisk = {};
        for (const pick of picks) byRisk[pick.item.risk] = (byRisk[pick.item.risk] ?? 0) + 1;
        const nameInput = h('input', {
            type: 'text', placeholder: '例如 fugue-boundaries', value: scope.name, 'aria-label': '范围名',
            oninput: event => { scope.name = event.target.value.trim(); },
        });
        return h('aside', { class: 'card cart', id: 'cart' },
            h('h2', null, '这次的范围', h('span', { class: 'count' }, `${picks.length} 条`)),
            picks.length > 0 ? h('div', { class: 'small muted' }, RISKS.filter(risk => byRisk[risk]).map(risk => [tempo(risk, `${risk} ×${byRisk[risk]}`), ' '])) : h('p', { class: 'muted small' }, '在左边勾选候选。可以换来源、换选项再列，勾的都会留在这里。'),
            picks.length > 0 ? h('ul', { class: 'cart-list' }, picks.map(pick => h('li', null,
                tempo(pick.item.risk, pick.item.risk),
                h('span', { class: 'k' }, pick.item.key),
                h('button', { type: 'button', title: '去掉', 'aria-label': `去掉 ${pick.item.key}`, onclick: () => { scope.picks.delete(pick.item.key); refreshPicks(); } }, '✕')))) : null,
            h('div', { class: 'option' }, h('label', null, '范围名'), nameInput,
                h('details', { class: 'small muted' }, h('summary', null, '怎么起名'), h('pre', { class: 'summary' }, view.overview.scopeNameHelp))),
            h('div', { class: 'toolbar' },
                h('button', { type: 'button', class: 'btn primary', disabled: picks.length === 0 || scope.saving, onclick: () => saveScope(false) }, scope.saving ? '存着……' : '存成范围'),
                picks.length > 0 ? h('button', { type: 'button', class: 'btn', onclick: () => { scope.picks.clear(); scope.notice = null; refreshPicks(); } }, '清空') : null),
            scope.notice);
    }

    async function saveScope(overwrite) {
        const scope = view.scope;
        const name = scope.name;
        const groups = new Map();
        for (const pick of scope.picks.values()) {
            if (!groups.has(pick.group)) groups.set(pick.group, { source: pick.source, options: pick.options, keys: [] });
            groups.get(pick.group).keys.push(pick.item.key);
        }
        scope.saving = true;
        scope.notice = null;
        renderScope();
        try {
            const saved = await api('/api/scopes', { method: 'POST', body: { name, picks: [...groups.values()], overwrite } });
            scope.notice = h('div', { class: 'notice ok' },
                `存好了：${saved.file}（${saved.count} 条）。把它交给监控 session，比如说“用范围 ${saved.name} 开一次运行”；它会跑：`,
                h('pre', null, `${command('state', `init --scope ${saved.name}`)}\n${command('state', `hd HD1 --note "范围 ${saved.name}"`)}`));
            // 范围已经存好；刷新“已有的范围”失败不算存失败，不然维护者会以为没存上、再存一次
            try {
                view.overview = await api('/api/overview');
            } catch {
                setStatus('范围存好了，刷新列表失败', true);
            }
        } catch (error) {
            if (error.status === 409 && error.data?.exists && !overwrite) {
                scope.saving = false;
                if (window.confirm(`已经有范围 ${name}，覆盖它吗？`)) return saveScope(true);
            }
            scope.notice = h('div', { class: 'notice bad' }, error.message);
        }
        scope.saving = false;
        renderScope();
    }

    function existingScopesCard() {
        const scopes = view.overview?.scopes ?? [];
        if (scopes.length === 0) return null;
        const scope = view.scope;
        return h('div', { class: 'card' },
            h('h2', null, '已有的范围', h('span', { class: 'count' }, `${scopes.length} 个`)),
            h('div', { class: 'table-wrap' }, h('table', null,
                h('thead', null, h('tr', null, h('th', null, '范围'), h('th', { class: 'num' }, '条目'), h('th', null, '来源'), h('th', null, '建于'))),
                h('tbody', null, scopes.flatMap(entry => [
                    h('tr', { class: 'clickable', onclick: () => toggleScope(entry.name) },
                        h('td', null, h('b', null, entry.label), ' ', h('span', { class: 'faint mono small' }, entry.name)),
                        h('td', { class: 'num' }, String(entry.count)),
                        h('td', { class: 'small mono' }, (entry.source?.from ?? []).join('、')),
                        h('td', { class: 'small nowrap' }, time(entry.createdAt))),
                    scope.openScope?.name === entry.name ? h('tr', null, h('td', { colspan: '4' },
                        h('ul', { class: 'cart-list' }, (scope.openScope.items ?? []).map(item => h('li', null, tempo(item.risk, item.risk), h('span', { class: 'k' }, item.key)))))) : null,
                ])))));
    }

    async function toggleScope(name) {
        const scope = view.scope;
        if (scope.openScope?.name === name) {
            scope.openScope = null;
            return renderScope();
        }
        try {
            scope.openScope = await api(`/api/scopes/${encodeURIComponent(name)}`);
        } catch (error) {
            setStatus(error.message, true);
        }
        renderScope();
    }

    // ---- 历史 ----

    function renderHistory() {
        const runs = view.overview?.runs ?? [];
        if (runs.length === 0) return replace('tab-history', h('div', { class: 'card empty' }, h('strong', null, '还没有收尾过的运行'), '运行收尾（coven state finish）后，记录和总结在 .coven/runs/。'));
        const selected = view.history.selected;
        const list = h('div', { class: 'card' },
            h('h2', null, '运行记录', h('span', { class: 'count' }, `${runs.length} 次`)),
            h('div', { class: 'table-wrap' }, h('table', null,
                h('thead', null, h('tr', null, h('th', null, '运行'), h('th', null, '范围'), h('th', null, '时间'), h('th', { class: 'num' }, '任务'), h('th', { class: 'num' }, '介入'), h('th', { class: 'num' }, 'token'))),
                h('tbody', null, runs.map(entry => h('tr', { class: `clickable${selected === entry.run ? ' selected' : ''}`, onclick: () => openRun(entry.run) },
                    h('td', null, h('b', null, entry.label), entry.dryRun ? [' ', chip('干跑', 'warn')] : null),
                    h('td', null, entry.scopeLabel),
                    h('td', { class: 'small nowrap' }, `${time(entry.startedAt)} → ${time(entry.finishedAt, { date: false })}`),
                    h('td', { class: 'num' }, `${entry.totals?.done ?? 0}/${entry.totals?.tasks ?? 0}`),
                    h('td', { class: 'num' }, String(entry.interventionCount ?? 0)),
                    h('td', { class: 'num nowrap' }, tokens(entry.totals?.tokens, entry.totals?.approxTokens))))))));
        const detail = view.history.detail;
        replace('tab-history', list, detail ? h('div', { class: 'card' },
            h('h2', null, `${detail.label} 的总结`),
            detail.summary ? h('pre', { class: 'summary' }, detail.summary) : h('p', { class: 'muted' }, '这次运行没有总结文件。')) : null);
    }

    async function openRun(run) {
        view.history.selected = run;
        try {
            const result = await api(`/api/runs/${encodeURIComponent(run)}`);
            view.history.detail = { label: view.overview.runs.find(entry => entry.run === run)?.label ?? run, summary: result.summary };
        } catch (error) {
            view.history.detail = null;
            setStatus(error.message, true);
        }
        renderHistory();
    }

    // ---- 总调度 ----

    const RENDER = { run: renderRun, claims: renderClaims, scope: renderScope, history: renderHistory };

    function showTab(tab) {
        view.tab = tab;
        for (const button of document.querySelectorAll('.tabs button')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
        for (const name of Object.keys(RENDER)) document.getElementById(`tab-${name}`).hidden = name !== tab;
        RENDER[tab]();
        if (tab === 'claims' && !view.claims && !view.claimsError && view.overview?.config?.trackingIssue) loadClaims(false);
    }

    // 自动刷新时，内容没变就不重画；维护者正选着文字（比如要复制的命令）也先不重画，下一轮再说
    let renderedSignature = null;

    async function refreshOverview() {
        try {
            view.overview = await api('/api/overview');
            const run = view.overview.run;
            document.getElementById('repo').textContent = `${view.overview.repo} · ${view.overview.root}`;
            document.title = run?.label ? `${run.label} · Coven Compass` : 'Coven Compass';
            if (view.tab === 'run' || view.tab === 'history') {
                const signature = JSON.stringify([run, view.overview.runs]);
                const selecting = String(window.getSelection?.() ?? '').length > 0;
                if (signature !== renderedSignature && !selecting) {
                    RENDER[view.tab]();
                    renderedSignature = signature;
                }
            }
            setStatus(`更新于 ${time(new Date().toISOString(), { date: false })}`);
        } catch (error) {
            setStatus(`读不到 Compass 服务：${error.message}`, true);
        }
    }

    for (const button of document.querySelectorAll('.tabs button')) button.addEventListener('click', () => showTab(button.dataset.tab));
    refreshOverview().then(() => showTab(view.tab));
    // 只在“运行”页、而且页面在前台时自动刷新
    setInterval(() => {
        if (view.tab === 'run' && document.visibilityState === 'visible') refreshOverview();
    }, POLL_MS);
})();
