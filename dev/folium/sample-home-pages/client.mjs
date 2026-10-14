// dev/folium/sample-home-pages/client.mjs
// The mod owns both widgets; the host only appends their isolated mount points.
export default function activate(folium) {
  if (folium.env.context !== 'main') return;
  const pages = folium.experimental['home.pages'];
  let draft = '';
  let actions = 0;
  const label = { en: 'Notes', 'zh-CN': '记事' };
  const text = (ctx, en, zh) => ctx.locale.startsWith('zh') ? zh : en;
  const handle = pages.register({
    id: 'notes', label,
    mountNavigation(container, ctx) {
      const style = document.createElement('style');
      // These are sample-owned styles, including the adaptation to a generic overflow menu.
      style.textContent = `
        *, *::before, *::after { box-sizing: border-box; }
        button { border: 0; background: transparent; cursor: pointer; font-family: var(--folium-font, inherit); }
        button[data-surface="bravais"]:focus-visible { outline: 2px solid var(--folium-accent); outline-offset: 2px; }
        .icon { display: inline-flex; width: 14px; height: 14px; align-items: center; justify-content: center; flex: none; line-height: 1; }
        .icon svg { display: block; width: 14px; height: 14px; }
        button[data-surface="grid"] { position: relative; display: inline-flex; align-items: center; justify-content: center;
          padding: 6px 12px; border-radius: 9999px; font-size: 12px; line-height: 16px; font-weight: 500;
          white-space: nowrap; color: var(--notes-grid-ink); transition: color 300ms; }
        button[data-surface="grid"]:hover { color: var(--notes-grid-hover); }
        button[data-surface="grid"] .label { max-width: 0; overflow: hidden; opacity: 0; transition: all 300ms ease-out; }
        button[data-surface="grid"]:is(:hover, :focus-visible) .label { margin-left: 6px; max-width: 112px; opacity: 1; }
        @media (min-width: 768px) { button[data-surface="grid"] { font-size: 14px; line-height: 20px; } }
        button[data-surface="bravais"] { display: block; width: var(--folium-home-shortcut-width, 100%); max-width: 100%; margin-inline: auto; padding: 6px; border-radius: 10px;
          color: color-mix(in srgb, var(--folium-primary) 55%, transparent); transition: background-color 140ms, color 140ms; }
        button[data-surface="bravais"] .icon { display: none; }
        button[data-surface="bravais"] .label { display: -webkit-box; overflow: hidden; font-size: 11px; line-height: 1.3;
          font-weight: 500; text-align: center; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
        button[data-surface="bravais"]:hover { color: var(--folium-primary); background: color-mix(in srgb, currentColor 8%, transparent); }
        :host-context(.is-compact) button[data-surface="bravais"] { padding: 5px 2px; }
        :host-context(.is-compact) button[data-surface="bravais"] .label { font-size: 10px; }
        :host-context([role="menu"]) button[data-surface="bravais"] { display: flex; width: 100%; align-items: center; justify-content: flex-start;
          gap: 6px; padding: 7px 6px; border: 1px solid transparent; border-radius: 9px; color: var(--folium-primary);
          font-size: 12px; line-height: 1.25; font-weight: 650; transition: none; }
        :host-context([role="menu"]) button[data-surface="bravais"] .icon { display: inline-flex; opacity: .75; }
        :host-context([role="menu"]) button[data-surface="bravais"] .label { display: block; font-size: 12px; line-height: 1.25;
          font-weight: 650; text-align: left; overflow-wrap: normal; }
        :host-context([role="menu"]) button[data-surface="bravais"]:hover { background: color-mix(in srgb, currentColor 14%, transparent); }
      `;
      const button = document.createElement('button'); button.type = 'button';
      const name = text(ctx, 'Notes', '记事');
      button.dataset.surface = ctx.surface;
      button.setAttribute('aria-label', name); button.title = name;
      button.style.setProperty('--notes-grid-ink', ctx.isDaylight ? 'rgb(0 0 0 / 60%)' : 'rgb(255 255 255 / 60%)');
      button.style.setProperty('--notes-grid-hover', ctx.isDaylight ? '#000' : '#fff');
      const icon = document.createElement('span'); icon.className = 'icon'; icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '✎'; // Keep an icon-sized fallback if the host icon cannot be loaded.
      const caption = document.createElement('span'); caption.className = 'label'; caption.setAttribute('aria-hidden', 'true'); caption.textContent = name;
      button.append(icon, caption);
      let disposed = false;
      folium.ui.icon('notebook-pen', { size: 14 }).then(svg => {
        if (!disposed && ctx.isCurrent() && svg) icon.replaceChildren(svg);
      }).catch(() => {}); // The fallback remains usable when loading fails.
      button.onclick = () => { if (ctx.open()) folium.log.info('home.pages: opened notes', ctx.surface); };
      container.append(style, button);
      return () => { disposed = true; button.onclick = null; folium.log.info('home.pages: navigation disposed', ctx.surface); };
    },
    mountPage(container, ctx) {
      const style = document.createElement('style');
      style.textContent = `.page { box-sizing: border-box; min-height: 100%; padding: 24px; font: 14px var(--folium-font, sans-serif); color: var(--folium-primary); }
        h1 { margin-top: 0; } textarea { box-sizing: border-box; width: 100%; min-height: 180px; padding: 12px; resize: vertical;
        border: 1px solid var(--folium-secondary); border-radius: 16px; background: transparent; color: inherit; font: inherit; }
        button { padding: 8px 16px; margin: 12px 8px 0 0; border: 0; border-radius: 999px;
          background: color-mix(in srgb, var(--folium-accent) 20%, transparent); color: inherit; cursor: pointer; }
        button:focus-visible, textarea:focus-visible { outline: 2px solid var(--folium-accent); outline-offset: 2px; }`;
      const page = document.createElement('main'); page.className = 'page';
      const title = document.createElement('h1'); title.textContent = text(ctx, 'Offline notes', '离线记事');
      const input = document.createElement('textarea'); input.setAttribute('aria-label', text(ctx, 'Note draft', '草稿'));
      input.value = draft; input.oninput = () => { draft = input.value; };
      const save = document.createElement('button'); save.textContent = text(ctx, 'Record action', '记录动作');
      const close = document.createElement('button'); close.textContent = text(ctx, 'Return to library', '返回资料库');
      const status = document.createElement('output');
      save.onclick = () => { if (ctx.isCurrent()) { actions++; status.textContent = text(ctx, `Actions: ${actions}`, `执行次数：${actions}`); folium.log.info('home.pages: record action', { actions, draftLength: draft.length }); } };
      close.onclick = () => ctx.close();
      page.append(title, input, save, close, status); container.append(style, page);
      folium.log.info('home.pages: page mounted');
      return () => { folium.log.info('home.pages: page disposed'); };
    },
  });
  const command = folium.registries.commands.register({ id: 'open-notes', label,
    keywords: ['notes', 'home', '记事'], run: () => { pages.open('notes'); } });
  return () => { command.unregister(); handle.unregister(); };
}
