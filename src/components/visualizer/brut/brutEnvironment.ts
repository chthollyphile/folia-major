import * as THREE from 'three';

// src/components/visualizer/brut/brutEnvironment.ts
// A theme-derived vertical gradient used as the scene environment.
//
// three's RoomEnvironment is deliberately NOT used: it is a showroom box with its own hardcoded
// colours, which is both the wrong content for a shaft and a violation of the theme-derived colour
// rule. A 64x32 equirect costs one PMREM build per theme change and is what makes the steel frames
// look like metal instead of grey plastic, and the damp concrete like something with a surface.

export interface BrutEnvironment {
    texture: THREE.Texture;
    dispose: () => void;
}

const WIDTH = 64;
const HEIGHT = 32;

const toChannel = (value: number) => Math.round(Math.max(0, Math.min(255, value)));

export const createBrutEnvironment = (
    renderer: THREE.WebGLRenderer,
    skyColor: string,
    deepColor: string,
): BrutEnvironment | null => {
    const sky = new THREE.Color(skyColor);
    const deep = new THREE.Color(deepColor);
    const data = new Uint8Array(WIDTH * HEIGHT * 4);

    for (let row = 0; row < HEIGHT; row += 1) {
        // Equirect row 0 is the zenith, so the sky occupies the top and falls off into the pit.
        const t = row / (HEIGHT - 1);
        const eased = t * t;
        for (let column = 0; column < WIDTH; column += 1) {
            const offset = (row * WIDTH + column) * 4;
            data[offset] = toChannel(THREE.MathUtils.lerp(sky.r, deep.r, eased) * 255);
            data[offset + 1] = toChannel(THREE.MathUtils.lerp(sky.g, deep.g, eased) * 255);
            data[offset + 2] = toChannel(THREE.MathUtils.lerp(sky.b, deep.b, eased) * 255);
            data[offset + 3] = 255;
        }
    }

    const source = new THREE.DataTexture(data, WIDTH, HEIGHT, THREE.RGBAFormat);
    source.mapping = THREE.EquirectangularReflectionMapping;
    source.colorSpace = THREE.SRGBColorSpace;
    source.needsUpdate = true;

    let generator: THREE.PMREMGenerator | null = null;
    try {
        generator = new THREE.PMREMGenerator(renderer);
        const target = generator.fromEquirectangular(source);
        source.dispose();
        generator.dispose();
        return {
            texture: target.texture,
            dispose: () => target.dispose(),
        };
    } catch {
        source.dispose();
        generator?.dispose();
        return null;
    }
};
