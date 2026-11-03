// Minimal car responses; no real accounts, tickets or encryption keys are stored in fixtures.
export const track = (id = '7676337516358617115') => ({
    base_info: { id, name: 'Song', duration_ms: 200000 },
    related_info: { artist_links: [{ id: '42', name: 'Artist' }], album_link: { id: '43', name: 'Album' } },
    display_info: { cover_url: { uri: 'cover', urls: ['https://p3.douyinpic.com/'], template_prefix: 'tplv-test' } },
});
export const response = (data: unknown, headers = {}) => new Response(JSON.stringify(data), { headers });
