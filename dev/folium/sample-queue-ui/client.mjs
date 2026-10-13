import { buttonMount, componentWidth, textMount } from './components.mjs';

// dev/folium/sample-queue-ui/client.mjs
// Offline component example: all buttons, badges and text belong to this mod.
export default function activate(folium) {
  if (folium.env.context !== 'main') return undefined;
  const queueUi = folium.experimental['queue.ui'];
  if (!queueUi?.register) throw new Error('This host does not provide experimental queue.ui');
  const counts = new Map(), listeners = new Set(), structural = new Set();
  let syncCount = 0;
  const notify = () => { for (const listener of listeners) listener(); };
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  const label = (ctx, zh, en) => ctx.locale.startsWith('zh') ? zh : en;
  const key = ctx => `${ctx.entry.index}:${ctx.entry.song.ref ?? ctx.entry.song.id}`;
  const syncMount = buttonMount({
    label: ctx => label(ctx, '示例同步（仅记录点击）', 'Sample sync (logs only)'),
    icon: () => folium.ui.icon('refresh-cw', { size: 16 }),
    run(ctx) { syncCount += 1; folium.log.info(`queue.ui header: surface=${ctx.surface}, sync clicks=${syncCount}`);
      folium.ui.toast(`示例同步已点击 ${syncCount} 次`, { type: 'info', durationMs: 1500 }); },
  });
  const voteMount = buttonMount({
    label: ctx => label(ctx, '示例点赞', 'Sample vote'),
    icon: () => folium.ui.icon('thumbs-up', { size: 14 }), subscribe,
    count: ctx => counts.get(key(ctx)) ?? 0,
    run(ctx) { counts.set(key(ctx), (counts.get(key(ctx)) ?? 0) + 1);
      folium.log.info(`queue.ui vote: surface=${ctx.surface}, index=${ctx.entry.index}, song=${ctx.entry.song.title}, count=${counts.get(key(ctx))}`);
      notify(); },
  });
  const overlineMount = textMount(ctx => ctx.entry.index % 2 === 0
    ? label(ctx, '示例推荐者', 'Sample recommender') : label(ctx, '系统推荐（示例）', 'System recommendation (sample)'));
  const media = window.matchMedia('(max-width: 640px)');
  const resized = () => { for (const listener of structural) listener(); };
  media.addEventListener('change', resized);
  const handle = queueUi.register({
    id: 'sample', getEntryLayout: () => 'overline',
    subscribe(listener) { structural.add(listener); return () => structural.delete(listener); },
    getHeaderContent(surface) { return [
      { id: 'sync', width: componentWidth(surface, true), mount: syncMount },
    ]; },
    getEntryContent({ surface }) { return { overline: { id: 'recommender', mount: overlineMount },
      trailing: [{ id: 'vote', width: componentWidth(surface), mount: voteMount }] }; },
  });
  return () => { handle.unregister(); media.removeEventListener('change', resized); listeners.clear(); structural.clear(); };
}
