// electron/appleMusic/config.cjs
// Release maintainers supply their HTTPS service; it returns { token: <signed MusicKit JWT> }.
// Keep the Apple signing private key on that server, never in the desktop bundle.
module.exports = { developerTokenEndpoint: '' };
