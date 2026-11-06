import { zipSync, strToU8 } from 'fflate';
import { downloadStyleFile } from '../download';
import artDirection from '../../../skills/folia-style-art-direction/SKILL.md?raw';
import builtinDesign from '../../../skills/folia-style-art-direction/references/builtins.md?raw';
import reconstruction from '../../../skills/folia-style-art-direction/references/reconstruction.md?raw';
import motionAcceptance from '../../../skills/folia-style-art-direction/references/motion-and-acceptance.md?raw';
import lyricRelease from '../../../skills/folia-style-art-direction/references/lyric-release.md?raw';
import taxonomy from '../../../skills/folia-style-art-direction/references/taxonomy.md?raw';

// Local video decoding exports reference evidence for an agent, without claiming to recover source code.
export const referenceTimes = (start: number, end: number, count = 8) => {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 60) throw new Error('referenceRange');
    const n = Math.max(2, Math.min(12, Math.round(count)));
    return Array.from({ length: n }, (_, i) => start + (end - start) * i / (n - 1));
};
type Labels = Record<'reference' | 'videoHint' | 'videoImport' | 'videoSample' | 'videoExport' | 'videoStart' | 'videoEnd' | 'videoNote' | 'videoMark' | 'videoReady' | 'failed' | 'referenceRange' | 'videoLimit' | 'videoDecode' | 'videoDuration' | 'videoCapture' | 'videoChanged' | 'frames', string>;
type Frame = { time: number; bytes: Uint8Array; url: string };
const mediaEvent = (target: HTMLVideoElement, name: string, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new Error('videoChanged')); return; }
    const done = () => { cleanup(); resolve(); }, fail = () => { cleanup(); reject(new Error('videoDecode')); };
    const abort = () => { cleanup(); reject(new Error('videoChanged')); };
    const timer = setTimeout(fail, 10000);
    const cleanup = () => { clearTimeout(timer); target.removeEventListener(name, done); target.removeEventListener('error', fail); signal.removeEventListener('abort', abort); };
    signal.addEventListener('abort', abort, { once: true });
    target.addEventListener(name, done, { once: true }); target.addEventListener('error', fail, { once: true });
});
export function mountVideoReference(root: HTMLElement, labels: Labels) {
    const errorText = (error: unknown) => {
        const key = error instanceof Error ? error.message : String(error);
        return Object.hasOwn(labels, key) ? labels[key as keyof Labels] : String(error);
    };
    root.innerHTML = `<h2>${labels.reference}</h2><p class="muted">${labels.videoHint}</p><label class="file">${labels.videoImport}<input type="file" accept="video/*" /></label><video controls muted playsinline></video><div class="toolbar"><label>${labels.videoStart}<input class="clip-start" type="number" min="0" step="0.1" value="0" /></label><label>${labels.videoEnd}<input class="clip-end" type="number" min="0" step="0.1" value="12" /></label><button class="sample" disabled>${labels.videoSample}</button><button class="export" disabled>${labels.videoExport}</button></div><label>${labels.videoNote}<input class="note" type="text" maxlength="500" /></label><button class="mark" disabled>${labels.videoMark}</button><p class="video-status" role="status"></p><div class="reference-frames"></div>`;
    const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
    const video = find<HTMLVideoElement>('video'), fileInput = find<HTMLInputElement>('input[type=file]');
    const start = find<HTMLInputElement>('.clip-start'), end = find<HTMLInputElement>('.clip-end');
    const sample = find<HTMLButtonElement>('.sample'), exportButton = find<HTMLButtonElement>('.export'), mark = find<HTMLButtonElement>('.mark');
    const status = find<HTMLElement>('.video-status'), gallery = find<HTMLElement>('.reference-frames');
    let sourceUrl = '', fileName = '', revision = 0, disposed = false, frames: Frame[] = [];
    let mediaAbort = new AbortController();
    let marks: { time: number; note: string }[] = [];
    const clearFrames = () => { frames.forEach(frame => URL.revokeObjectURL(frame.url)); frames = []; gallery.replaceChildren(); exportButton.disabled = true; };
    fileInput.onchange = async () => {
        const file = fileInput.files?.[0]; if (!file) return;
        const run = ++revision; sample.disabled = true; mark.disabled = true; clearFrames(); marks = [];
        mediaAbort.abort(); mediaAbort = new AbortController();
        try {
            if (file.size > 250 * 1024 * 1024 || (file.type && !file.type.startsWith('video/'))) throw new Error('videoLimit');
            video.pause(); if (sourceUrl) URL.revokeObjectURL(sourceUrl);
            sourceUrl = URL.createObjectURL(file); fileName = file.name;
            const loaded = mediaEvent(video, 'loadeddata', mediaAbort.signal); video.src = sourceUrl; video.load(); await loaded;
            if (disposed || run !== revision) return;
            if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth) throw new Error('videoDuration');
            start.value = '0'; end.value = String(Math.min(30, Math.max(.01, video.duration - .05)));
            sample.disabled = false; mark.disabled = false;
            status.textContent = `${labels.videoReady} · ${video.videoWidth}×${video.videoHeight} · ${video.duration.toFixed(2)} s`;
        } catch (error) { if (run === revision) status.textContent = `${labels.failed} ${errorText(error)}`; }
    };
    mark.onclick = () => {
        const input = find<HTMLInputElement>('.note'), note = input.value.trim(); if (!note) return;
        marks.push({ time: video.currentTime, note }); input.value = '';
        status.textContent = marks.map(item => `${item.time.toFixed(2)} s — ${item.note}`).join('\n');
    };
    sample.onclick = async () => {
        const run = revision, original = video.currentTime;
        video.pause(); video.inert = true; video.controls = false;
        sample.disabled = true; fileInput.disabled = true; mark.disabled = true; clearFrames();
        const generated: Frame[] = [];
        try {
            const times = referenceTimes(Number(start.value), Math.min(Number(end.value), video.duration - .01));
            const canvas = document.createElement('canvas'); const ratio = Math.min(1, 960 / video.videoWidth, 960 / video.videoHeight);
            canvas.width = Math.max(1, Math.round(video.videoWidth * ratio)); canvas.height = Math.max(1, Math.round(video.videoHeight * ratio));
            const ctx = canvas.getContext('2d')!;
            for (const time of times) {
                if (disposed || run !== revision) throw new Error('videoChanged');
                // Even an initial time of zero must seek: loadeddata alone can precede the drawable first frame.
                const seeked = mediaEvent(video, 'seeked', mediaAbort.signal); video.currentTime = time; await seeked;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('videoCapture')), 'image/jpeg', .85));
                generated.push({ time, bytes: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob) });
            }
            if (disposed || run !== revision) throw new Error('videoChanged');
            frames = generated;
            for (const frame of frames) {
                const figure = document.createElement('figure'), image = document.createElement('img'), caption = document.createElement('figcaption');
                image.src = frame.url; image.alt = `${frame.time.toFixed(2)} s`; caption.textContent = image.alt;
                figure.append(image, caption); gallery.append(figure);
            }
            exportButton.disabled = false; status.textContent = `${labels.videoReady} · ${frames.length} ${labels.frames}`;
        } catch (error) { generated.forEach(frame => URL.revokeObjectURL(frame.url)); status.textContent = `${labels.failed} ${errorText(error)}`; }
        finally { if (!disposed && run === revision) { video.currentTime = original; video.inert = false; video.controls = true; sample.disabled = false; fileInput.disabled = false; mark.disabled = false; } }
    };
    exportButton.onclick = () => {
        const evidence = { format: 'folia-video-reference', version: 1, video: { name: fileName, duration: video.duration, width: video.videoWidth, height: video.videoHeight },
            frames: frames.map((frame, i) => ({ time: frame.time, file: `frames/${String(i + 1).padStart(2, '0')}.jpg` })), marks,
            limitations: ['Uniform samples are not automatic shot detection.', 'Reference frames do not recover source code, shaders or assets.', 'Compare motion against the original video as well as these samples.'] };
        const brief = '# Video → Folia renderer pack\n\nRead reference.json and every frame, and watch the supplied original video if available. Separate observed behavior from inferred implementation. Describe typography, composition, entry/exit, camera, lighting, particles and beat coupling with timestamps. Ask for missing motion evidence instead of inventing it. Implement an original renderer using the Folia API 2 contract (AGENT.md and renderer-api.d.ts), not a prerecorded video overlay. Use host lyric/word/glyph timing; deterministic seek, reduced motion and portrait layout are required. Preserve the reference’s distinctive motion grammar while adapting to arbitrary lyrics. Provide the pack, renderer source, screenshots, Studio report, comparison notes and remaining differences. Do not claim exact recovery of the video’s original program.\n';
        const guidance = 'First read skills/folia-style-art-direction/SKILL.md and its references included here, or call folia_style_brief on the Folia MCP with source=video. Write a phrase-level motion plan before coding; a single repeated arc with random jitter is not varied choreography. Watch continuous previews and record visual evidence separately from technical validation.\n\n';
        const skillRoot = 'skills/folia-style-art-direction/';
        const files: Record<string, Uint8Array> = { 'reference.json': strToU8(JSON.stringify(evidence, null, 2)), 'agent-brief.md': strToU8(guidance + brief),
            [`${skillRoot}SKILL.md`]: strToU8(artDirection), [`${skillRoot}references/builtins.md`]: strToU8(builtinDesign),
            [`${skillRoot}references/reconstruction.md`]: strToU8(reconstruction), [`${skillRoot}references/motion-and-acceptance.md`]: strToU8(motionAcceptance),
            [`${skillRoot}references/lyric-release.md`]: strToU8(lyricRelease), [`${skillRoot}references/taxonomy.md`]: strToU8(taxonomy) };
        frames.forEach((frame, i) => { files[`frames/${String(i + 1).padStart(2, '0')}.jpg`] = frame.bytes; });
        downloadStyleFile('folia-video-reference.zip', new Blob([new Uint8Array(zipSync(files, { level: 0 }))], { type: 'application/zip' }));
    };
    return () => { disposed = true; revision++; mediaAbort.abort(); video.pause(); video.removeAttribute('src'); video.load(); if (sourceUrl) URL.revokeObjectURL(sourceUrl); clearFrames(); root.replaceChildren(); };
}
