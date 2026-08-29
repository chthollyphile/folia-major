// mods/sample-aurora-visualizer/visualizer.mjs
// Renderer-side contribution (apiVersion 1, imperative contract): default.mount
// receives a host element and shared props, builds its own DOM, and returns a
// disposer. No React/bundler coupling — plain ESM the browser can import over
// folia-mod://. Continuous time arrives via currentTime.on('change'), never
// React state, matching the project's runtime guardrails.

export default {
  mount(element, props) {
    const shell = document.createElement('div');
    shell.style.cssText = [
      'position:absolute', 'inset:0',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:0 8%', 'box-sizing:border-box', 'overflow:hidden',
    ].join(';');
    const lineBox = document.createElement('div');
    lineBox.style.cssText = 'max-width:100%;text-align:center;font-size:64px;font-weight:500;line-height:1.35;letter-spacing:0.04em;';
    shell.appendChild(lineBox);
    element.appendChild(shell);

    // Rebuild spans whenever the song's lyric data changes.
    let spans = [];
    let currentLine = null;
    const renderLine = (line) => {
      lineBox.replaceChildren();
      spans = [];
      if (!line) return;
      const text = line.fullText ?? (line.words ?? []).map((w) => w.text).join('');
      const chars = Array.from(text ?? '');
      chars.forEach((char, index) => {
        const span = document.createElement('span');
        span.textContent = char;
        span.style.cssText = 'display:inline-block;white-space:pre;transition:none;';
        lineBox.appendChild(span);
        spans.push({
          el: span,
          start: charTiming(line, index, chars.length),
          end: charTiming(line, index + 1, chars.length),
        });
      });
    };

    // Approximate per-char timing by evenly distributing the line window over
    // its characters; a production mod can map Line.words timestamps instead.
    const charTiming = (line, index, total) => {
      const duration = Math.max(0.001, (line.endTime ?? 0) - (line.startTime ?? 0));
      return (line.startTime ?? 0) + (duration * index) / total;
    };

    const paint = (timeSec) => {
      const line = props.lines[props.currentLineIndex] ?? null;
      if (line !== currentLine) {
        currentLine = line;
        renderLine(line);
      }
      spans.forEach(({ el, start, end }) => {
        const t = (timeSec - start) / Math.max(0.001, end - start);
        const clamped = Math.min(1, Math.max(0, t));
        // Aurora sweep: hue rotates through the line, alpha rises as each
        // char becomes active; untouched chars stay a soft dim glow.
        const hue = Math.round(((start % 4) * 70 + clamped * 40) % 360);
        el.style.color = clamped <= 0
          ? 'rgba(255,255,255,0.28)'
          : `hsl(${hue} 90% ${58 + clamped * 14}%)`;
        el.style.textShadow = clamped > 0 && clamped < 1
          ? `0 0 ${8 + clamped * 14}px hsl(${hue} 90% 65% / 0.65)`
          : 'none';
        el.style.transform = clamped > 0 && clamped < 1 ? 'translateY(-2px)' : 'none';
      });
    };

    paint(props.currentTime.get());
    const unsubscribe = props.currentTime.on('change', paint);

    return () => {
      unsubscribe();
      shell.remove();
      spans = [];
    };
  },
};