import en from '../i18n/locales/en';
import zh from '../i18n/locales/zh-CN';
import ind from '../i18n/locales/in';
import vi from '../i18n/locales/vi';
import { RENDERER_PACK } from './code/example';
import { LYRIC_TEMPLATE_PACK } from './code/lyricTemplate';
import { packKind, STYLE_KINDS } from './catalog';
import { parseStylePack, readStylePack, formatStylePack } from './validate';
import { mountPreview } from './preview';
import { fixtureFrame, fixtureScene, type FixtureName } from './fixtures';
import { runPackAcceptance } from './acceptance';
import { runCodeAcceptance } from './code/acceptance';
import { downloadStyleFile } from './download';
import { mountVideoReference } from './video/videoReference';
import type { AnyStylePack } from './code/contract';
import './studio.css';

// Offline authoring workbench: the player runtime, a plain-code editor and local video evidence.
const locale = navigator.language.startsWith('zh') ? zh : /^(id|in)/.test(navigator.language) ? ind : navigator.language.startsWith('vi') ? vi : en;
const t = (key: keyof typeof en.stylePacks) => locale.stylePacks[key];
const root = document.getElementById('studio')!;
root.innerHTML = `<header><div><small>FOLIA / CREATOR TOOLS</small><h1>Style Studio <span>02</span></h1></div><p>${t('studioTagline')}</p></header>
<main><section class="preview"><div class="toolbar"><button id="play">${t('play')}</button><button id="portrait">${t('portrait')}</button><button id="daylight">${t('daylight')}</button><button id="motion">${t('reduceMotion')}</button></div>
<div class="stage"><div id="viewport" aria-label="${t('preview')}"></div></div>
<label class="timeline">${t('timeline')} <output id="time">00:00</output><input id="seek" type="range" min="0" max="24" step="0.01" value="0" /></label>
<div class="toolbar" id="fixtures">${(['demo', 'empty', 'long', 'multilingual'] as const).map(name => `<button data-fixture="${name}">${t(name)}</button>`).join('')}</div>
<div class="toolbar"><label class="file">${t('cover')}<input id="cover" type="file" accept="image/png,image/jpeg,image/webp" /></label><button id="snapshot">${t('snapshot')}</button><button id="report">${t('report')}</button></div>
<p class="muted" id="metrics"></p><p class="muted">${t('reportHint')}</p><details class="reference"><summary>${t('reference')}</summary><div id="video-reference"></div></details></section>
<section class="editor"><div class="toolbar"><h2>${t('definition')}</h2><button id="example">${t('example')}</button><button id="template-example">${t('templateExample')}</button><label class="file">${t('import')}<input id="import" type="file" accept=".json,.folia-style" /></label><button id="export">${t('export')}</button></div>
<div class="toolbar" role="group" aria-label="${t('category')}"><button id="kind-personality">${t('personality')}</button><button id="kind-lyric-template">${t('lyricTemplate')}</button></div><p class="muted" id="kind-note"></p>
<label for="code">${t('rendererCode')}</label><textarea id="code" spellcheck="false"></textarea>
<details><summary>${t('manifest')}</summary><label class="sr-only" for="source">${t('definition')}</label><textarea id="source" spellcheck="false"></textarea></details>
<pre id="status" role="status"></pre><p class="muted">${t('liveHint')}</p></section></main>`;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const viewport = element('viewport'), source = element<HTMLTextAreaElement>('source'), code = element<HTMLTextAreaElement>('code');
const status = element<HTMLPreElement>('status'), seek = element<HTMLInputElement>('seek');
let pack: AnyStylePack = RENDERER_PACK, time = 0, playing = false, daylight = false, reducedMotion = false, portrait = false;
let fixture: FixtureName = 'demo', scene = fixtureScene(), cover: HTMLImageElement | null = null, coverUrl = '', coverRevision = 0;
let valid = true, previous = performance.now(), debounce = 0, raf = 0, lastLabel = -1, lastMetric = -1, reporting = false, disposed = false;
let host: ReturnType<typeof mountPreview>;
let codeDirty = false;
let draftRevision = 0, previewRevision = 0;
const updateValidity = (value: boolean) => {
    valid = value; element<HTMLButtonElement>('export').disabled = !valid;
    element<HTMLButtonElement>('report').disabled = !valid || reporting;
};
const restartPreview = () => {
    const revision = ++previewRevision;
    host?.dispose(); viewport.replaceChildren();
    host = mountPreview(viewport, pack, () => ({ scene, frame: { ...fixtureFrame(time, fixture, daylight, reducedMotion), cover }, animate: playing }), error => {
        if (disposed || revision !== previewRevision) return;
        updateValidity(false); status.textContent = `${t('failed')}\n${String(error)}`;
    });
    if (cover) void host.setCover(cover).catch(error => { if (!disposed && revision === previewRevision) status.textContent = String(error); });
};
const populate = (next: AnyStylePack) => {
    pack = next; source.value = formatStylePack(pack);
    code.value = pack.schemaVersion === 2 ? pack.renderer.code : '';
    code.disabled = pack.schemaVersion !== 2;
    codeDirty = false;
    const kind = packKind(pack);
    for (const value of STYLE_KINDS) element(`kind-${value}`).setAttribute('aria-pressed', String(value === kind));
    element('kind-note').textContent = t(kind === 'personality' ? 'personalityHint' : 'lyricTemplateHint') + (!pack.kind ? ` · ${t('legacyKind')}` : '');
};
populate(pack); status.textContent = t('valid'); restartPreview();
const stage = viewport.parentElement!;
const sizeStage = () => {
    const ratio = portrait ? 390 / 844 : 16 / 9;
    const width = Math.min(stage.clientWidth - 28, (stage.clientHeight - 28) * ratio);
    viewport.style.width = `${Math.max(1, width)}px`; viewport.style.height = `${Math.max(1, width / ratio)}px`; host.draw();
};
const stageObserver = new ResizeObserver(sizeStage); stageObserver.observe(stage); sizeStage();
function validateDraft(fromCode = false) {
    try {
        let next = parseStylePack(source.value);
        if ((fromCode || codeDirty) && next.schemaVersion === 2) next = parseStylePack(JSON.stringify({ ...next, renderer: { ...next.renderer, code: code.value } }));
        populate(next); updateValidity(true); status.textContent = t('valid'); restartPreview();
    } catch (error) { updateValidity(false); status.textContent = `${t('invalid')}\n${String(error)}`; }
}
source.oninput = () => { ++draftRevision; updateValidity(false); clearTimeout(debounce); debounce = window.setTimeout(() => validateDraft(), 500); };
code.oninput = () => { ++draftRevision; codeDirty = true; updateValidity(false); clearTimeout(debounce); debounce = window.setTimeout(() => validateDraft(true), 700); };
async function importFile(file?: File) {
    if (!file) return;
    const revision = ++draftRevision;
    try {
        const next = await readStylePack(file);
        if (disposed || revision !== draftRevision) return;
        clearTimeout(debounce); populate(next); validateDraft();
    } catch (error) { if (!disposed && revision === draftRevision) status.textContent = `${t('failed')} ${String(error)}`; }
}
element<HTMLInputElement>('import').onchange = event => { const input = event.target as HTMLInputElement; void importFile(input.files?.[0]); input.value = ''; };
root.ondragover = event => event.preventDefault();
root.ondrop = event => { event.preventDefault(); const file = event.dataTransfer?.files[0]; if (file && !file.type.startsWith('video/')) void importFile(file); };
element('example').onclick = () => { ++draftRevision; populate(RENDERER_PACK); clearTimeout(debounce); validateDraft(); };
element('template-example').onclick = () => { ++draftRevision; populate(LYRIC_TEMPLATE_PACK); clearTimeout(debounce); validateDraft(); };
for (const kind of STYLE_KINDS) element(`kind-${kind}`).onclick = () => {
    ++draftRevision; clearTimeout(debounce);
    try {
        const current = parseStylePack(source.value);
        source.value = formatStylePack({ ...current, kind });
        validateDraft();
    } catch (error) { updateValidity(false); status.textContent = `${t('invalid')}\n${String(error)}`; }
};
element('play').onclick = () => { playing = !playing; previous = performance.now(); element('play').textContent = t(playing ? 'pause' : 'play'); host.draw(); };
element('portrait').onclick = () => { portrait = !portrait; sizeStage(); };
element('daylight').onclick = () => { daylight = !daylight; host.draw(); };
element('motion').onclick = () => { reducedMotion = !reducedMotion; element('motion').setAttribute('aria-pressed', String(reducedMotion)); host.draw(); };
element('fixtures').onclick = event => { const name = (event.target as HTMLElement).dataset.fixture; if (name) { fixture = name as FixtureName; scene = fixtureScene(fixture); host.draw(); } };
seek.oninput = () => { time = Number(seek.value); host.draw(); };
element('export').onclick = () => { if (valid) downloadStyleFile(`${pack.id}.folia-style.json`, formatStylePack(pack)); };
element('snapshot').onclick = async () => {
    const revision = draftRevision, captured = pack, capturedTime = time, owner = host;
    try { const blob = await owner.capture(); if (!disposed && revision === draftRevision) downloadStyleFile(`${captured.id}-${capturedTime.toFixed(2)}.png`, blob); }
    catch (error) { if (!disposed && revision === draftRevision) status.textContent = `${t('failed')} ${String(error)}`; }
};
element('report').onclick = async () => {
    if (!valid || reporting) return;
    reporting = true; updateValidity(valid); playing = false; element('play').textContent = t('play');
    const tested = pack, revision = draftRevision;
    try {
        const report = tested.schemaVersion === 2 ? await runCodeAcceptance(tested) : runPackAcceptance(tested, document.createElement('canvas'));
        if (disposed || revision !== draftRevision) return;
        status.textContent = `${t('reportDone')} ${report.checks.filter(check => check.pass).length}/60`;
        downloadStyleFile(`${tested.id}.report.json`, JSON.stringify(report, null, 2));
    } catch (error) { if (!disposed && revision === draftRevision) status.textContent = `${t('failed')} ${String(error)}`; }
    finally { reporting = false; updateValidity(valid); }
};
element<HTMLInputElement>('cover').onchange = event => {
    const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) { status.textContent = t('coverLimit'); return; }
    const revision = ++coverRevision, url = URL.createObjectURL(file), image = new Image();
    image.onload = () => {
        if (disposed || revision !== coverRevision) { URL.revokeObjectURL(url); return; }
        if (coverUrl) URL.revokeObjectURL(coverUrl); coverUrl = url; cover = image;
        void host.setCover(image).catch(error => { status.textContent = String(error); }); host.draw();
    };
    image.onerror = () => { URL.revokeObjectURL(url); status.textContent = t('failed'); }; image.src = url;
};
const disposeReference = mountVideoReference(element('video-reference'), locale.stylePacks);
function tick(now: number) {
    if (playing && !document.hidden) time = (time + Math.min(.1, (now - previous) / 1000)) % 24;
    previous = now;
    if (Math.floor(time * 10) !== lastLabel) { lastLabel = Math.floor(time * 10); seek.value = String(time); element('time').textContent = `${time.toFixed(1)} / 24 s`; }
    if (Math.floor(now / 1000) !== lastMetric) {
        lastMetric = Math.floor(now / 1000);
        const metrics = host.metrics(); element('metrics').textContent = metrics ? t('workerStats').replace('{{frames}}', String(metrics.frames)).replace('{{ms}}', metrics.p95Ms.toFixed(2)) : t('canvasRenderer');
    }
    raf = requestAnimationFrame(tick);
}
raf = requestAnimationFrame(tick);
window.addEventListener('pagehide', () => { disposed = true; host.dispose(); disposeReference(); stageObserver.disconnect(); cancelAnimationFrame(raf); clearTimeout(debounce); ++coverRevision; if (coverUrl) URL.revokeObjectURL(coverUrl); }, { once: true });
