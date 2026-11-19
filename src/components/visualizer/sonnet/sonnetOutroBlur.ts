import type { SceneView } from './sonnetSceneBuilder';

// src/components/visualizer/sonnet/sonnetOutroBlur.ts
// 片尾模糊：片尾海报升起时给最后一段场景挂一个 BlurFilter，强度随片尾帧变化；回到 0 或换场景时摘下销毁。
type PixiModule = typeof import('pixi.js');

/** The outro blur runs at this share of the canvas resolution. */
const OUTRO_BLUR_RESOLUTION_SHARE = 0.75;

export class SonnetOutroBlur {
    private filter: import('pixi.js').BlurFilter | null = null;
    private scene: SceneView | null = null;

    constructor(private readonly pixi: PixiModule) { }

    /** Whether the blur is currently attached to `scene`. */
    isOn(scene: SceneView) {
        return this.scene === scene;
    }

    clear() {
        if (this.filter && this.scene) {
            this.scene.container.filters = (this.scene.container.filters ?? [])
                .filter(filter => filter !== this.filter);
            this.filter.destroy();
        }
        this.filter = null;
        this.scene = null;
    }

    /** `renderResolution` is what the canvas runs at; the scenes are rebuilt (and this cleared) when it changes. */
    update(scene: SceneView, strength: number, renderResolution: number) {
        if (strength <= 0) {
            this.clear();
            return;
        }
        if (this.scene !== scene) this.clear();
        if (!this.filter) {
            this.filter = new this.pixi.BlurFilter({
                strength: 0,
                quality: 2,
                kernelSize: 5,
                // The scene is drawn at the lowest resolution among its enabled filters, so this is
                // a share of the canvas, not a fixed 0.75 that a 3x canvas would stretch fourfold.
                resolution: renderResolution * OUTRO_BLUR_RESOLUTION_SHARE,
            });
            this.filter.antialias = scene.filterAntialias;
            // Shares the scene's filter chain with the post-process vignette, so its padding would
            // grow the shared render frame and drift the vignette outward as the outro blur ramps.
            this.filter.repeatEdgePixels = true;
            scene.container.filters = [...(scene.container.filters ?? []), this.filter];
            this.scene = scene;
        }
        this.filter.strength = strength;
    }
}
