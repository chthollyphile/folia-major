// The scenery camera and voice emitter use the same world-to-screen transform and head motion as the puppet shader.
const smooth = (a, b, x) => { const p = Math.max(0, Math.min(1, (x - a) / (b - a))); return p * p * (3 - 2 * p); };
export function sceneTransform(f) {
    const portrait = f.height > f.width;
    const scale = portrait ? Math.max(f.width / 2100, f.height / 3400) : Math.max(f.width / 3840, f.height / 2160);
    return { portrait, scale, tx: f.width * (portrait ? .54 : .52) - 2032 * scale, ty: f.height * (portrait ? .57 : .5) - 1080 * scale };
}

export function emitterAt(frame, time, energy, motion) {
    const camera = sceneTransform(frame);
    let x = -182, y = 159;
    const upper = smooth(-650, 260, y);
    x += upper * Math.sin(time * 1.48) * (4.2 + energy * 3.2) * motion;
    y += upper * (Math.sin(time * 2.35) * 1.8 + energy * 2.2) * motion;
    const angle = Math.sin(time * 1.48 + .4) * (.008 + energy * .016) * motion * smooth(35, 165, y);
    const lx = x + 65, ly = y - 85;
    x = -65 + Math.cos(angle) * lx - Math.sin(angle) * ly;
    y = 85 + Math.sin(angle) * lx + Math.cos(angle) * ly;
    return { x: camera.tx + (2032 + x) * camera.scale, y: camera.ty + (1059 - y) * camera.scale };
}
