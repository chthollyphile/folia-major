import { toneUrl } from './audio.mjs';

// dev/folium/sample-playback-session/client.mjs
export default function activate(folium) {
    const sessions = folium.experimental['playback.sessions'];
    const urls = [toneUrl(330, 30), toneUrl(440, 35)];
    const tracks = ['A', 'B'].map((id, index) => ({ id, title: `会话测试 ${id}`, artists: ['离线测试音源'], durationMs: (30 + index * 5) * 1000 }));
    const listeners = new Set(), logs = [];
    let lease = null, generation = 0, active = true, index = 0, blocked = false, failIntent = false, delay = false;
    const log = text => {
        logs.push(`${new Date().toLocaleTimeString()} ${text}`);
        if (logs.length > 100) logs.shift();
        listeners.forEach(update => update());
    };
    const release = () => { generation++; lease?.release(); lease = null; log('已释放：私人队列恢复，播放停止'); };
    const provider = folium.experimental['omni.providers'].register({
        id: 'tones', displayName: '会话测试音源', shortName: '会话测试',
        search: async () => ({ items: tracks, hasMore: false }),
        getSong: async id => tracks.find(song => song.id === id) ?? null,
        getAudioUrl: async song => {
            if (delay) { delay = false; await new Promise(resolve => setTimeout(resolve, 4000)); }
            return { url: urls[song.id === 'B' ? 1 : 0] };
        },
        getLyrics: async () => ({ main: { format: 'lrc', text: '[00:00.00]外部播放会话 API 验收\n[00:10.00]暂停和音量只影响本机\n[00:20.00]下一首与跳转交给会话' } }),
    });
    const song = async id => sessions.resolveSong('folium.session-api-demo.tones', id);
    const load = async (id, resume = true) => {
        const mine = ++generation, current = lease;
        if (!current) throw new Error('请先建立会话');
        const resolved = await song(id);
        if (!active || mine !== generation || lease !== current) return;
        index = id === 'B' ? 1 : 0;
        const result = await current.play(resolved);
        log(`加载 ${id}: ${result.status}`);
        if (result.status !== 'source-committed') return;
        const until = Date.now() + 10000;
        while (active && mine === generation && lease === current && Date.now() < until) {
            const state = folium.playback.getState();
            if (state.song?.id === resolved.id && state.song?.source === resolved.source && state.duration > 0) {
                if (resume) folium.playback.play();
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    };
    const acquire = () => {
        if (lease) return;
        blocked = false;
        lease = sessions.acquire({ restore: 'queue-stopped', onIntent: async intent => {
            log(`意图 ${intent.type}${intent.type === 'seek' ? ` ${intent.seconds.toFixed(1)}s` : ''}`);
            if (failIntent) { failIntent = false; generation++; lease = null; log('意图故意抛错：宿主将自动释放会话'); throw new Error('验收：意图处理失败'); }
            if (['next', 'previous', 'ended'].includes(intent.type)) await load(index ? 'A' : 'B');
            if (intent.type === 'seek') { lease.seek(intent.seconds); if (intent.resume) folium.playback.play(); }
            if (intent.type === 'play') log(`选曲已交给会话：${intent.song.title}`);
            if (intent.type === 'enqueue') log(`入队已交给会话：${intent.songs.length} 首`);
        }});
        log('已接管：使用宿主播放条、键盘或遥控测试');
    };
    const mount = container => {
        const root = document.createElement('section');
        root.innerHTML = `<style>
            section{font:13px/1.5 system-ui;color:var(--folium-text-primary,inherit);padding:12px;box-sizing:border-box}
            h3{margin:0 0 6px}p{opacity:.75}.actions{display:flex;flex-wrap:wrap;gap:8px}
            button{font:inherit;color:inherit;background:color-mix(in srgb,currentColor 9%,transparent);border:1px solid #8886;border-radius:12px;padding:7px 10px;cursor:pointer}
            button:hover,button:focus-visible{background:color-mix(in srgb,currentColor 18%,transparent)}
            pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:230px;overflow:auto;font:12px/1.6 monospace}
        </style><h3>播放会话验收</h3><p>无需登录。请先准备私人队列，再建立会话。</p><div class="actions"></div><p role="status"></p><pre aria-label="执行日志"></pre>`;
        const add = (label, run) => {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
            button.addEventListener('keydown', event => {
                // Keep native button activation; the host's Space shortcut must not cancel its click.
                if (!event.ctrlKey && !event.altKey && !event.metaKey && (event.key === 'Enter' || event.key === ' ')) {
                    event.stopPropagation();
                }
            });
            button.onclick = () => { Promise.resolve().then(run).catch(error => log(`错误：${error.message}`)); };
            root.querySelector('.actions').append(button);
        };
        add('准备私人队列', async () => { if (lease) release(); await folium.playback.playSong(await song('A')); folium.playback.enqueue(await song('B')); log('私人队列已准备：A、B'); });
        add('建立会话并播放 B', async () => { acquire(); await load('B'); });
        add('宿主下一首', () => folium.playback.next());
        add('宿主暂停 / 恢复', () => folium.playback.toggle());
        add('宿主跳转到 10 秒', () => folium.playback.seek(10));
        add('切换切歌 / 跳转权限', () => { blocked = !blocked; lease?.setCapabilities({ canNext: !blocked, canPrevious: !blocked, canSeek: !blocked }); log(`切歌和跳转：${blocked ? '禁止' : '允许'}`); });
        add('清空媒体，保持会话', () => { generation++; lease?.stop(); log('媒体已清空，会话继续占有'); });
        add('释放会话', release);
        add('加载慢音源后立即退出', () => { acquire(); delay = true; void load(index ? 'A' : 'B').catch(error => log(error.message)); setTimeout(() => { if (active) release(); }, 150); });
        add('下次意图抛错', () => { failIntent = true; log('下次意图会抛错，请点下一首'); });
        add('清空日志', () => { logs.length = 0; log('日志已清空'); });
        const update = () => {
            root.querySelector('[role=status]').textContent = lease ? '会话已建立' : '私人播放';
            const pre = root.querySelector('pre'); pre.textContent = logs.join('\n'); pre.scrollTop = pre.scrollHeight;
        };
        listeners.add(update); update(); container.append(root);
        return () => { listeners.delete(update); root.remove(); };
    };
    const panel = folium.registries.playerPanelTabs.register({ id: 'session', label: { 'zh-CN': '会话验收', en: 'Session test' }, mount });
    const command = folium.registries.commands.register({ id: 'open', label: { 'zh-CN': '播放会话验收', en: 'Playback session test' }, run: () => { folium.ui.navigate('player'); folium.ui.openPlayerPanel('session'); } });
    return () => { active = false; release(); panel.unregister(); command.unregister(); provider.unregister(); urls.forEach(URL.revokeObjectURL); listeners.clear(); };
}
