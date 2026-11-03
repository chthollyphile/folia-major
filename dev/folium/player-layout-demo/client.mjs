// dev/folium/player-layout-demo/client.mjs
// A small, account-free example: all geometry comes from the opt-in stage context layout snapshot.

const margin = 24;
const gap = 12;
const right = rect => rect.left + rect.width;
const bottom = rect => rect.top + rect.height;
const overlaps = (a, b) => a.left < right(b) + gap && right(a) > b.left - gap
    && a.top < bottom(b) + gap && bottom(a) > b.top - gap;

// Find free rectangles without treating every obstacle as a blocked row or column.
export function computePlayerLayoutDemo({ bounds, insets, obstacles }) {
    const safeBounds = {
        left: bounds.left + insets.left,
        top: bounds.top + insets.top,
        width: Math.max(0, bounds.width - insets.left - insets.right),
        height: Math.max(0, bounds.height - insets.top - insets.bottom),
    };
    const width = Math.max(0, Math.min(300, safeBounds.width - margin * 2));
    const height = Math.max(0, Math.min(96, safeBounds.height - margin * 2));
    const desired = { left: right(safeBounds) - margin - width, top: safeBounds.top + margin, width, height };
    // Keep separate rectangles even when several obstacles have the same role.
    const rects = obstacles.map(item => item.rect);
    const xs = new Set([desired.left, safeBounds.left + margin]);
    const ys = new Set([desired.top]);
    for (const rect of rects) {
        xs.add(rect.left - width - gap); xs.add(right(rect) + gap);
        ys.add(rect.top - height - gap); ys.add(bottom(rect) + gap);
    }
    let dialog = null;
    let distance = Infinity;
    for (const left of xs) for (const top of ys) {
        const candidate = { left, top, width, height };
        if (left < safeBounds.left + margin || top < safeBounds.top + margin
            || right(candidate) > right(safeBounds) - margin || bottom(candidate) > bottom(safeBounds) - margin
            || rects.some(rect => overlaps(candidate, rect))) continue;
        const nextDistance = Math.abs(left - desired.left) + Math.abs(top - desired.top);
        if (nextDistance < distance) { dialog = candidate; distance = nextDistance; }
    }
    // A tall chat occupies a free vertical interval; unrelated right-side rectangles do not move it.
    const left = safeBounds.left + margin;
    let intervals = [{ top: safeBounds.top + margin, bottom: bottom(safeBounds) - margin }];
    for (const rect of [...rects, ...(dialog ? [dialog] : [])]) {
        if (rect.left >= left + width + gap || right(rect) <= left - gap) continue;
        intervals = intervals.flatMap(interval => {
            if (rect.top - gap >= interval.bottom || bottom(rect) + gap <= interval.top) return [interval];
            return [
                { top: interval.top, bottom: Math.min(interval.bottom, rect.top - gap) },
                { top: Math.max(interval.top, bottom(rect) + gap), bottom: interval.bottom },
            ].filter(item => item.bottom > item.top);
        });
    }
    const interval = intervals.sort((a, b) => (b.bottom - b.top) - (a.bottom - a.top) || b.bottom - a.bottom)[0];
    const chat = interval ? { left, top: interval.top, width, height: interval.bottom - interval.top } : null;
    return { chat, dialog };
}

export function mountPlayerLayoutDemo(container, ctx) {
    const chat = document.createElement('div');
    const dialog = document.createElement('div');
    for (const box of [chat, dialog]) {
        box.style.cssText = 'position:fixed;box-sizing:border-box;padding:12px;border:1px solid #a78bfa;background:#231e38dd;color:#f5f3ff;border-radius:18px;overflow:hidden;pointer-events:auto;font:14px/1.6 system-ui;';
        container.appendChild(box);
    }
    chat.dataset.layoutDemoChat = '';
    dialog.dataset.layoutDemoDialog = '';
    chat.textContent = Array.from({ length: 60 }, (_, index) => `示例用户 ${index + 1}：这条消息只用于检查控件避让。`).join('\n');
    chat.style.whiteSpace = 'pre-line';
    dialog.textContent = '示例私信气泡\n窗口和侧栏变化时跟随可用空间。';
    dialog.style.whiteSpace = 'pre-line';
    let previous;
    const update = () => {
        const layout = ctx.getLayout();
        if (layout === previous) return;
        previous = layout;
        container.dataset.layoutDemoSnapshot = JSON.stringify(layout);
        const positions = layout ? computePlayerLayoutDemo(layout) : { chat: null, dialog: null };
        for (const [box, rect] of [[chat, positions.chat], [dialog, positions.dialog]]) {
            box.hidden = !rect || rect.height < 32 || rect.width < 32;
            if (!rect) continue;
            for (const key of ['left', 'top', 'width', 'height']) box.style[key] = `${rect[key]}px`;
        }
    };
    const off = ctx.subscribe(update);
    update();
    return () => { off(); chat.remove(); dialog.remove(); delete container.dataset.layoutDemoSnapshot; };
}

export default function activate(folium) {
    if (folium.env.context !== 'main') return;
    folium.registries.stageLayers.register({
        id: 'safe-area-demo', slot: 'app.overlay',
        mount: (container, ctx) => mountPlayerLayoutDemo(container, ctx),
    });
}
