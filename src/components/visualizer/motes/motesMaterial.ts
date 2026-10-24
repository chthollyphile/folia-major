// Four reusable circular sprites give lyric and space particles soft edges without per-frame gradients.
export interface MotesMaterial {
    primary: HTMLCanvasElement;
    accent: HTMLCanvasElement;
    glowPrimary: HTMLCanvasElement;
    glowAccent: HTMLCanvasElement;
}

interface MotesMaterialCache {
    primary: string;
    accent: string;
    material: MotesMaterial | null;
}

const SPRITE_SIZE = 64;
const materials = new WeakMap<CanvasRenderingContext2D, MotesMaterialCache>();

const releaseSprite = (canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    canvas.width = 0;
    canvas.height = 0;
};

const releaseMaterial = (material: MotesMaterial | null) => {
    if (!material) return;
    releaseSprite(material.primary);
    releaseSprite(material.accent);
    releaseSprite(material.glowPrimary);
    releaseSprite(material.glowAccent);
};

// Tinting a neutral alpha mask also supports named, hsl() and translucent theme colors.
const createSprite = (owner: Document, color: string, glow: boolean): HTMLCanvasElement | null => {
    const canvas = owner.createElement('canvas');
    canvas.width = SPRITE_SIZE;
    canvas.height = SPRITE_SIZE;
    const context = canvas.getContext('2d');
    if (!context) { releaseSprite(canvas); return null; }
    const center = SPRITE_SIZE / 2;
    const gradient = context.createRadialGradient(center, center, 0, center, center, center - 1);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    if (glow) {
        gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.5)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
    } else {
        gradient.addColorStop(0.74, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.9, 'rgba(255, 255, 255, 0.8)');
    }
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = color;
    context.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    context.globalCompositeOperation = 'source-over';
    return canvas;
};

export const resolveMotesMaterial = (
    context: CanvasRenderingContext2D,
    primary: string,
    accent: string,
): MotesMaterial | null => {
    const accentColor = accent || primary;
    const cached = materials.get(context);
    if (cached?.primary === primary && cached.accent === accentColor) return cached.material;
    releaseMaterial(cached?.material ?? null);
    const owner = context.canvas?.ownerDocument ?? (typeof document === 'undefined' ? null : document);
    let material: MotesMaterial | null = null;
    if (owner) {
        const corePrimary = createSprite(owner, primary, false);
        const coreAccent = corePrimary ? createSprite(owner, accentColor, false) : null;
        const glowPrimary = coreAccent ? createSprite(owner, primary, true) : null;
        const glowAccent = glowPrimary ? createSprite(owner, accentColor, true) : null;
        if (corePrimary && coreAccent && glowPrimary && glowAccent) {
            material = { primary: corePrimary, accent: coreAccent, glowPrimary, glowAccent };
        } else {
            releaseSprite(corePrimary);
            releaseSprite(coreAccent);
            releaseSprite(glowPrimary);
            releaseSprite(glowAccent);
        }
    }
    // Cache failures too: a host without an offscreen 2D context must not retry allocation every frame.
    materials.set(context, { primary, accent: accentColor, material });
    return material;
};
