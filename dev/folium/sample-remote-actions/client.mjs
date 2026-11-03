// dev/folium/sample-remote-actions/client.mjs
// Ordinary main-window activation; only serializable button descriptions cross to the remote.
export default function activate(folium) {
    const counts = new Map();
    let previewActive = true;
    const handle = folium.experimental['remote.actions'].register({
        id: 'example',
        actions({ song }) {
            const key = song ? `${song.source}:${song.id ?? song.ref ?? song.title}` : null;
            const count = counts.get(key) ?? 0;
            return [
                {
                    id: 'like', label: { 'zh-CN': '示例点赞', en: 'Demo like' }, icon: 'thumbs-up',
                    disabled: !song, pressed: count > 0, count,
                    run() {
                        const next = (counts.get(key) ?? 0) + 1;
                        counts.set(key, next);
                        folium.log.info('remote.actions demo like', { song: key, count: next });
                        handle.invalidate();
                    },
                },
                {
                    id: 'stop-preview', label: { 'zh-CN': '停止示例试听', en: 'Stop demo preview' },
                    icon: 'square', scope: 'session', tone: 'alert', disabled: !previewActive,
                    run() {
                        previewActive = false;
                        folium.log.info('remote.actions demo preview stopped');
                        handle.invalidate();
                    },
                },
            ];
        },
    });
    return () => handle.unregister();
}
