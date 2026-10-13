// dev/folium/sample-queue-ui/components.mjs
// Mod-owned DOM and CSS. The host only mounts these functions in isolated containers.
export const componentWidth = (surface, header = false) => header
  ? ({ panel: 26, command: 24, wall: 29, lattice: 44 })[surface]
  : ({ panel: 25, command: 30, wall: 26, lattice: globalThis.matchMedia?.('(max-width: 640px)').matches ? 86 : 44 })[surface];

const css = `
* { box-sizing: border-box }
button { font: inherit; color: var(--folium-primary, inherit); cursor: pointer }
button { display: grid; place-items: center; position: relative; width: var(--size); height: var(--height);
  padding: var(--pad); border: var(--border); border-radius: var(--radius); background: transparent;
  opacity: var(--opacity); flex: none; transition: background-color 140ms ease, opacity 140ms ease }
button:hover { opacity: 1; background: var(--hover); border-color: var(--hover-border, transparent) }
button:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-offset); opacity: var(--focus-opacity); background: var(--focus-bg) }
button:disabled { opacity: .3; cursor: default }
svg { width: var(--icon); height: var(--icon); display: block }
.count { pointer-events: none; position: absolute; top: var(--offset); right: var(--offset); padding: 0 4px;
  border: 1px solid color-mix(in srgb, var(--folium-primary, currentColor) 20%, transparent);
  border-radius: 999px; font: 10px/12px system-ui; font-variant-numeric: tabular-nums;
  color: var(--folium-primary, currentColor);
  background: color-mix(in srgb, var(--folium-bg, Canvas) 90%, var(--folium-primary, CanvasText)); visibility: hidden }
button:hover .count, button:focus-visible .count { visibility: visible }
.text { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .6; font: 10px/12px system-ui }
`;
const prepare = (container, ctx) => {
  const style = document.createElement('style'); style.textContent = css; container.append(style);
  const header = ctx.placement === 'header';
  // The command toolbar already has 4px vertical padding: use it for the hit target without enlarging the text line.
  if (header && ctx.surface === 'command') Object.assign(container.style, { display: 'flex', alignItems: 'center', height: '16px' });
  const lattice = ctx.surface === 'lattice';
  const size = componentWidth(ctx.surface, header);
  const icon = lattice ? (size === 86 ? 30 : 20) : header ? (ctx.surface === 'wall' ? 15 : ctx.surface === 'panel' ? 14 : 16) : ctx.surface === 'panel' ? 13 : 14;
  const radius = lattice ? (size === 86 ? 20 : 12) : header ? (ctx.surface === 'wall' ? 9 : ctx.surface === 'command' ? 999 : 6) : ctx.surface === 'wall' ? 7 : ctx.surface === 'command' ? 8 : 6;
  const opacity = lattice ? .65 : ctx.surface === 'wall' ? (header ? .72 : .7) : header && ctx.surface === 'panel' ? .6 : 1;
  const alpha = ctx.surface === 'wall' ? (ctx.isDaylight ? (header ? 7 : 8) : (header ? 10 : 12)) : 10;
  const color = ctx.isDaylight ? '0 0 0' : '255 255 255';
  const tailwindHover = `color-mix(in oklab, ${ctx.isDaylight && !(ctx.surface === 'panel' && header) ? 'black' : 'white'} 10%, transparent)`;
  const properties = { size: `${size}px`, height: `${header && ctx.surface === 'wall' ? 28 : size}px`, icon: `${icon}px`, radius: `${radius}px`, opacity,
    pad: lattice || ctx.surface === 'wall' && !header ? '0' : header && ctx.surface === 'wall' ? '0 7px' : header && ctx.surface === 'command' ? '4px' : `${ctx.surface === 'panel' ? 6 : 8}px`,
    border: lattice ? '1px solid transparent' : '0px solid currentColor',
    hover: lattice ? 'color-mix(in srgb, currentColor 16%, transparent)' : ctx.surface === 'wall' ? `rgb(${color} / ${alpha}%)` : tailwindHover,
    'hover-border': lattice ? 'color-mix(in srgb, currentColor 26%, transparent)' : 'currentColor',
    'focus-outline': lattice ? '2px solid currentColor' : ctx.surface === 'wall' ? '2px solid var(--folium-accent, currentColor)' : 'auto 1px -webkit-focus-ring-color',
    'focus-offset': lattice ? '-2px' : ctx.surface === 'wall' ? '2px' : '0px',
    'focus-opacity': ctx.surface === 'wall' ? 1 : opacity,
    'focus-bg': ctx.surface === 'wall' ? `rgb(${color} / ${alpha}%)` : 'transparent',
    offset: lattice ? '0px' : '-4px' };
  for (const [key,value] of Object.entries(properties)) container.style.setProperty(`--${key}`,String(value));
};

/** @param {any} options */
export const buttonMount = options => (container, ctx) => {
  prepare(container, ctx);
  const button = document.createElement('button'); button.type = 'button';
  const label = typeof options.label === 'function' ? options.label(ctx) : options.label;
  button.setAttribute('aria-label', label); button.title = label;
  if (!options.icon) button.textContent = label;
  let alive = true;
  // The slot already reserves its width; loading an optional mod icon never affects native controls.
  options.icon?.(ctx)?.then(svg => { if (alive && svg) button.prepend(svg); });
  const count = document.createElement('span'); count.className = 'count'; count.setAttribute('aria-hidden','true');
  count.dataset.sampleCount = '';
  const update = () => {
    if (options.count) { const value = String(options.count(ctx)); count.textContent = value; button.setAttribute('aria-description',value); }
  };
  if (options.count) button.append(count);
  button.addEventListener('click', event => {
    if (event.detail > 0 && ctx.surface !== 'lattice') button.blur();
    void ctx.run(() => options.run(ctx));
  });
  update(); container.append(button);
  const dispose = options.subscribe?.(update);
  return () => { alive = false; dispose?.(); button.remove(); };
};
export const textMount = getText => (container, ctx) => {
  prepare(container, ctx);
  const text = document.createElement('span'); text.className = 'text';
  text.textContent = getText(ctx); text.title = text.textContent;
  if (ctx.surface === 'wall') text.style.lineHeight = '10px';
  container.append(text);
  return () => text.remove();
};
