import { sceneTransform } from './coordinates.mjs';

// Original layer placements use the wallpaper's 3840 × 2160, Y-up world coordinates.
export function createScenery(images, puppet) {
    const positions = {
        sky: [1786, 1538, 4417, 1898], city: [1893, 699, 3970, 678],
        railing: [1916, 1136, 4200, 2500], curtainLeft: [742, 1285, 1920, 2018],
        curtainRight: [3577, 1370, 2850, 2452], chair: [3741, 521, 2312, 1367], bag: [488, 648, 3302, 1890],
    };
    const star = (ctx, x, y, r, alpha) => {
        ctx.globalAlpha = alpha; ctx.fillStyle = '#d8edee'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    };
    return (ctx, f, energy, motion) => {
        const w = f.width, h = f.height, portrait = h > w;
        // Portrait pulls back to keep the whole girl and provides sky for the note stream.
        const { scale, tx, ty } = sceneTransform(f);
        const t = f.reducedMotion ? 0 : f.time;
        ctx.fillStyle = '#0c2538'; ctx.fillRect(0, 0, w, h);
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#092235'); sky.addColorStop(.55, '#1a3d51'); sky.addColorStop(1, '#080f1d');
        ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
        if (portrait) ctx.drawImage(images.sky, 0, 0, images.sky.width, images.sky.height, 0, 0, w, h * .79);
        ctx.save(); ctx.translate(tx, ty); ctx.scale(scale, scale);
        const layer = (id, dx = 0, dy = 0, shear = 0) => {
            const [x, y, width, height] = positions[id];
            const extend = portrait && id.startsWith('curtain') ? Math.max(0, ty / scale + 2160 - y - height / 2) : 0;
            ctx.save(); ctx.translate(x + dx, 2160 - y + dy - extend / 2); ctx.transform(1, 0, shear, 1, 0, 0);
            ctx.drawImage(images[id.toLowerCase()], -width / 2, -(height + extend) / 2, width, height + extend); ctx.restore();
        };
        if (!portrait) layer('sky');
        for (let i = 0; i < 62; i++) {
            const x = (i * 1279.7 + 139) % 3840, y = (i * 637.3 + 19) % 1100;
            star(ctx, x, y, i % 9 === 0 ? 2.1 : 1, .12 + .22 * (.5 + .5 * Math.sin(t * .6 + i * 8)));
        }
        ctx.globalAlpha = 1;
        layer('city', Math.sin(t * .17) * 3 * motion);
        layer('railing');
        layer('curtainLeft', Math.sin(t * .7) * 9 * motion, 0, Math.sin(t * .55) * .008 * motion);
        layer('curtainRight', Math.sin(t * .6 + 2) * 13 * motion, 0, Math.sin(t * .5 + 1) * .01 * motion);
        puppet.render(t, motion, energy);
        // Mesh bounds are [-790, 890] × [-1100, 700] around the original origin.
        ctx.drawImage(puppet.canvas, 2032 - 790, 2160 - 1101 - 700, 1680, 1800);
        layer('chair'); layer('bag');
        ctx.restore();
        const shade = ctx.createLinearGradient(0, h * .65, 0, h);
        shade.addColorStop(0, '#040a1400');
        if (portrait) shade.addColorStop(.73, '#040a14');
        shade.addColorStop(1, portrait ? '#040a14' : '#040a14c9');
        ctx.fillStyle = shade; ctx.fillRect(0, 0, w, h);
        return { x: tx + 1850 * scale, y: ty + 900 * scale, scale, portrait };
    };
}
