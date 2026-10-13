import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import * as pixi from 'pixi.js';
import { installPixiFilterPoolCompat } from '@/components/visualizer/pixiFilterPoolCompat';

// test/unit/visualizer/pixiFilterPoolCompat.test.ts
// Exercise real Pixi pools and bind groups without needing a WebGL context.
type FilterSystem = pixi.FilterSystem & { init: () => void };
const SCREEN = 991001;
const OTHER_SCREEN = 991002;
let systems: FilterSystem[];
let warn: MockInstance<typeof console.warn>;

/** Simulates the last filter pass with the actual texture and sampler change listeners. */
const createSystem = () => {
    const system = new pixi.FilterSystem({} as pixi.WebGLRenderer) as FilterSystem;
    system.init();
    systems.push(system);
    const group = (system as unknown as { _globalFilterBindGroup: pixi.BindGroup })._globalFilterBindGroup;
    const bind = (texture: pixi.Texture) => {
        group.setResource(texture.source, 1);
        group.setResource(texture.source.style, 2);
        group.setResource(texture.source, 3);
    };
    return { system, group, bind };
};

interface FilterStackCompat {
    _filterStack: { inputTexture: pixi.Texture }[];
    _filterStackIndex: number;
}

/**
 * A filter system with just enough renderer for push() to claim pooled input textures. pop()
 * stands in for the real one minus the draw: it releases the entry and returns its input.
 */
const createPushSystem = () => {
    const viewport = { width: 0, height: 0 };
    const renderer = {
        type: pixi.RendererType.WEBGL,
        renderTarget: {
            renderSurface: {},
            renderTarget: { colorTexture: { source: { resolution: 1, antialias: false, ...viewport } } },
            rootViewPort: viewport,
            bind: () => {},
            finishRenderPass: () => {},
        },
        globalUniforms: { push: () => {}, pop: () => {} },
    };
    const system = new pixi.FilterSystem(renderer as unknown as pixi.WebGLRenderer) as FilterSystem;
    system.init();
    systems.push(system);
    const stack = system as unknown as FilterStackCompat;
    // Only the fields push() reads; a real Filter would compile its program against a canvas.
    const filter = {
        enabled: true,
        resolution: 1,
        padding: 0,
        antialias: 'off',
        clipToViewport: true,
        blendRequired: false,
        compatibleRenderers: pixi.RendererType.WEBGL,
    };
    const frame = (width: number, height: number) => {
        Object.assign(viewport, { width, height });
        Object.assign(renderer.renderTarget.renderTarget.colorTexture.source, viewport);
        return {
            filterEffect: { filters: [filter], filterArea: new pixi.Rectangle(0, 0, width, height) },
            container: { worldTransform: new pixi.Matrix(), renderGroup: { cacheToLocalTransform: null } },
        } as unknown as pixi.FilterInstruction;
    };
    const pop = () => {
        stack._filterStackIndex -= 1;
        const texture = stack._filterStack[stack._filterStackIndex]!.inputTexture;
        pixi.TexturePool.returnTexture(texture);
        return texture;
    };
    return { system, frame, pop };
};

const expectUnbound = (group: pixi.BindGroup) => {
    expect(group.getResource(1)).toBe(pixi.Texture.EMPTY.source);
    expect(group.getResource(2)).toBe(pixi.Texture.EMPTY.source.style);
    expect(group.getResource(3)).toBe(pixi.Texture.EMPTY.source);
};

describe('Pixi 8.21.0 filter pool compatibility', () => {
    beforeAll(() => installPixiFilterPoolCompat(pixi));
    beforeEach(() => {
        systems = [];
        pixi.TexturePool.clear();
        pixi.TexturePool.setScreenSize(SCREEN, 301, 201);
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        systems.forEach(system => system.destroy());
        pixi.TexturePool.removeScreen(SCREEN);
        pixi.TexturePool.removeScreen(OTHER_SCREEN);
        pixi.TexturePool.clear();
        const boundWarnings = warn.mock.calls.filter(args => args.join(' ').includes('destroyed while still bound'));
        warn.mockRestore();
        expect(boundWarnings).toEqual([]);
    });

    it.each([
        ['resize', () => pixi.TexturePool.setScreenSize(SCREEN, 347, 229)],
        ['resolution change', () => pixi.TexturePool.setScreenSize(SCREEN, 602, 402)],
        ['renderer removal', () => pixi.TexturePool.removeScreen(SCREEN)],
        ['pool clear', () => pixi.TexturePool.clear()],
    ])('unbinds textures and samplers before %s destroys idle textures', (_, prune) => {
        const { group, bind } = createSystem();
        const texture = pixi.TexturePool.getOptimalTexture({ width: 301, height: 201 });
        bind(texture);
        pixi.TexturePool.returnTexture(texture);

        prune();

        expect(texture.destroyed).toBe(true);
        expectUnbound(group);
    });

    it('unbinds every live filter system when a shared screen bucket is pruned', () => {
        pixi.TexturePool.setScreenSize(OTHER_SCREEN, 600, 400);
        const first = createSystem();
        const second = createSystem();
        const texture = pixi.TexturePool.getOptimalTexture({ width: 301, height: 201 });
        first.bind(texture);
        second.bind(texture);
        pixi.TexturePool.returnTexture(texture);

        pixi.TexturePool.removeScreen(SCREEN);

        expect(texture.destroyed).toBe(true);
        expectUnbound(first.group);
        expectUnbound(second.group);
    });

    it('releases a checked-out texture returned after its bucket was pruned', () => {
        const { group, bind } = createSystem();
        const texture = pixi.TexturePool.getOptimalTexture({ width: 301, height: 201 });
        pixi.TexturePool.setScreenSize(SCREEN, 347, 229);
        expect(texture.destroyed).toBe(false);
        bind(texture);

        pixi.TexturePool.returnTexture(texture);

        expect(texture.destroyed).toBe(true);
        expectUnbound(group);
    });

    it('keeps normal texture returns and retained power-of-two buckets bound', () => {
        const { group, bind } = createSystem();
        const texture = pixi.TexturePool.getOptimalTexture({ width: 128, height: 128 });
        bind(texture);
        const setResource = vi.spyOn(group, 'setResource');

        pixi.TexturePool.returnTexture(texture);
        pixi.TexturePool.setScreenSize(SCREEN, 347, 229);

        expect(setResource).not.toHaveBeenCalled();
        expect(texture.destroyed).toBe(false);
        expect(group.getResource(1)).toBe(texture.source);
        setResource.mockRestore();
    });

    it('destroys filter bind groups and removes their listeners when the renderer is destroyed', () => {
        const source = pixi.Texture.EMPTY.source;
        const before = [source.listenerCount('change'), source.style.listenerCount('change')];
        const { system, group } = createSystem();
        pixi.TexturePool.returnTexture(pixi.TexturePool.getOptimalTexture({ width: 301, height: 201 }));
        pixi.TexturePool.clear();
        expect(source.listenerCount('change')).toBe(before[0]! + 2);
        expect(source.style.listenerCount('change')).toBe(before[1]! + 1);

        system.destroy();
        systems = [];
        expect(group.resources).toBeNull();
        expect([source.listenerCount('change'), source.style.listenerCount('change')]).toEqual(before);
        // Clearing again must not revisit the destroyed group.
        pixi.TexturePool.returnTexture(pixi.TexturePool.getOptimalTexture({ width: 301, height: 201 }));
        expect(() => pixi.TexturePool.clear()).not.toThrow();
    });

    it('pushes a nested filter after a resize pruned its stack entry\'s previous input', () => {
        const { system, frame, pop } = createPushSystem();
        system.push(frame(301, 201));
        system.push(frame(301, 201));
        const stale = pop();
        pop();

        // The entry still holds the returned texture; the resize prunes its screen-sized bucket.
        pixi.TexturePool.setScreenSize(SCREEN, 347, 229);
        expect(stale.destroyed).toBe(true);

        system.push(frame(347, 229));
        expect(() => system.push(frame(347, 229))).not.toThrow();
        const input = pop();
        pop();
        expect(input.destroyed).toBe(false);
    });

    it('installs once and leaves other Pixi versions untouched', () => {
        const init = (pixi.FilterSystem.prototype as FilterSystem).init;
        const push = pixi.FilterSystem.prototype.push;
        const returnTexture = pixi.TexturePool.returnTexture;
        installPixiFilterPoolCompat(pixi);
        expect((pixi.FilterSystem.prototype as FilterSystem).init).toBe(init);
        expect(pixi.FilterSystem.prototype.push).toBe(push);
        expect(pixi.TexturePool.returnTexture).toBe(returnTexture);

        const OtherFilterSystem = class { init = vi.fn(); };
        const otherPixi = { ...pixi, VERSION: '8.22.0', FilterSystem: OtherFilterSystem } as unknown as typeof pixi;
        installPixiFilterPoolCompat(otherPixi);
        expect(Object.getOwnPropertySymbols(OtherFilterSystem.prototype)).toEqual([]);
    });
});
