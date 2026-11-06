import { mountPackCanvas } from './canvasHost';
import { mountCodePack } from './code/host';
import type { AnyStylePack, CodeScene } from './code/contract';
import type { PackFrame } from './types';

// Studio keeps one host API while using the production renderer for each package version.
export function mountPreview(root: HTMLElement, pack: AnyStylePack, input: () => { frame: PackFrame; scene: CodeScene; animate: boolean }, onError: (error: unknown) => void) {
    if (pack.schemaVersion === 2) {
        const host = mountCodePack(root, pack, () => {
            const { frame: { cover: _cover, ...frame }, scene, animate } = input();
            root.style.backgroundColor = frame.theme.background;
            return { scene, animate, frame: { ...frame, index: scene.lines.findIndex(line => frame.time >= line.start && frame.time < line.end), paused: !animate } };
        }, onError);
        return {
            draw: host.draw, dispose: host.dispose, metrics: host.metrics,
            capture: async () => { await host.idle(); await host.renderOnce(); return host.capture(); },
            setCover: async (image: HTMLImageElement | null) => {
                const bitmap = image ? await createImageBitmap(image) : null;
                try { await host.idle(); await host.setCover(bitmap); } catch (error) { bitmap?.close(); throw error; }
            },
        };
    }
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:100%;height:100%'; root.append(canvas);
    const host = mountPackCanvas(canvas, () => ({ pack, frame: input().frame, animate: input().animate }), onError);
    return {
        draw: host.draw, dispose: () => { host.dispose(); canvas.remove(); }, metrics: () => null,
        setCover: async (_image: HTMLImageElement | null) => host.draw(),
        capture: async () => { host.capture(); return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Capture failed')))); },
    };
}
