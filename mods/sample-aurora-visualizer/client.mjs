// mods/sample-aurora-visualizer/client.mjs
// Folium sample: a lyric animation registered from the client entry. Plain ESM
// the renderer imports over folia-mod:// — no React, no bundler.
//
// The mount contract in one file:
//   - `ctx.lines` / `ctx.song` are fixed for one mount (the host remounts on a
//     new song), so the DOM is built once per song, not per line;
//   - the current line comes from `ctx.getLineIndex()`, read every frame;
//   - continuous time arrives via `ctx.currentTime.on('change')`, never React state;
//   - `ctx.subscribe` covers changes that happen while time stands still
//     (paused + theme switch), so the frame is repainted then too.

const paintSpans = (spans, timeSec) => {
  spans.forEach(({ el, start, end }) => {
    const t = (timeSec - start) / Math.max(0.001, end - start);
    const clamped = Math.min(1, Math.max(0, t));
    // Aurora sweep: hue rotates through the line, alpha rises as each
    // char becomes active; untouched chars stay a soft dim glow.
    const hue = Math.round(((start % 4) * 70 + clamped * 40) % 360);
    el.style.color = clamped <= 0
      ? 'var(--aurora-dim)'
      : `hsl(${hue} 90% ${58 + clamped * 14}%)`;
    el.style.textShadow = clamped > 0 && clamped < 1
      ? `0 0 ${8 + clamped * 14}px hsl(${hue} 90% 65% / 0.65)`
      : 'none';
    el.style.transform = clamped > 0 && clamped < 1 ? 'translateY(-2px)' : 'none';
  });
};

// Per-char timing from the line's words when present, else evenly spread.
const buildCharTimings = (line) => {
  const timings = [];
  if (line.words.length > 0) {
    line.words.forEach((word) => {
      const chars = Array.from(word.text);
      const duration = Math.max(0.001, word.endTime - word.startTime);
      chars.forEach((char, index) => {
        timings.push({
          char,
          start: word.startTime + (duration * index) / chars.length,
          end: word.startTime + (duration * (index + 1)) / chars.length,
        });
      });
    });
    return timings;
  }
  const chars = Array.from(line.text);
  const duration = Math.max(0.001, line.endTime - line.startTime);
  return chars.map((char, index) => ({
    char,
    start: line.startTime + (duration * index) / chars.length,
    end: line.startTime + (duration * (index + 1)) / chars.length,
  }));
};

const mountAurora = (container, ctx) => {
  const shell = document.createElement('div');
  shell.style.cssText = [
    'position:absolute', 'inset:0',
    'display:flex', 'align-items:center', 'justify-content:center',
    'padding:0 8%', 'box-sizing:border-box', 'overflow:hidden',
  ].join(';');
  const lineBox = document.createElement('div');
  lineBox.style.cssText = 'max-width:100%;text-align:center;font-size:64px;line-height:1.35;letter-spacing:0.04em;';
  shell.appendChild(lineBox);
  container.appendChild(shell);

  const applyTheme = () => {
    const theme = ctx.getTheme();
    lineBox.style.fontFamily = theme.fontFamily;
    lineBox.style.fontWeight = String(theme.fontWeight);
    shell.style.setProperty('--aurora-dim', theme.isDaylight ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.28)');
  };

  let spans = [];
  let renderedIndex = -2;
  const renderLine = (index) => {
    renderedIndex = index;
    lineBox.replaceChildren();
    spans = [];
    const line = index >= 0 ? ctx.lines[index] : null;
    if (!line) return;
    buildCharTimings(line).forEach(({ char, start, end }) => {
      const span = document.createElement('span');
      span.textContent = char;
      span.style.cssText = 'display:inline-block;white-space:pre;transition:none;';
      lineBox.appendChild(span);
      spans.push({ el: span, start, end });
    });
  };

  const paint = (timeSec) => {
    const index = ctx.staticMode && ctx.staticLineIndex !== null ? ctx.staticLineIndex : ctx.getLineIndex();
    if (index !== renderedIndex) renderLine(index);
    paintSpans(spans, timeSec);
  };

  applyTheme();
  paint(ctx.currentTime.get());
  const offTime = ctx.currentTime.on('change', paint);
  const offChanges = ctx.subscribe(() => {
    applyTheme();
    paint(ctx.currentTime.get());
  });

  return () => {
    offTime();
    offChanges();
    shell.remove();
    spans = [];
  };
};

export default function activate(folium) {
  folium.registries.visualizers.register({
    id: 'aurora-text',
    label: { 'zh-CN': '虹光', en: 'Aurora' },
    order: 420,
    mount: mountAurora,
  });
}
