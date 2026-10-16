// dev/folium/sample-playback-session/audio.mjs
// Quiet generated tones keep the source/decoder test independent of accounts and network access.
export function toneUrl(frequency, seconds) {
    const rate = 8000, count = rate * seconds;
    const buffer = new ArrayBuffer(44 + count * 2), view = new DataView(buffer);
    const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data');
    view.setUint32(40, count * 2, true);
    for (let i = 0; i < count; i++) {
        const envelope = Math.min(1, i / 400, (count - i) / 400);
        view.setInt16(44 + i * 2, Math.round(Math.sin(i * 2 * Math.PI * frequency / rate) * 1400 * envelope), true);
    }
    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}
