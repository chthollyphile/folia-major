# Control search: online IDs and honest recording versions

- Online `play --id` requires an explicit nonempty `--provider`; the CLI help shows both together. A missing provider is a usage error before the token file is read, before discovery and before any transport or playback work. Query play and `library play <local-id>` keep their existing routes.
- Search results show a VERSION column and each renderer search item includes `recordingVersion: 'unknown'`. The normalized `SongResult`/`UnifiedSong` contracts and the provider metadata carry no reliable original/cover assertion. Unknown is explicit; title, artist, aliases, album art and platform-specific unrelated flags do not establish originality.
- No original/cover classification is added without a verified provider field and an end-to-end contract with tests. The unknown marker documents the present capability gap; it does not claim classification is now available.
- Raw JSON stays the server response; older servers without the field still render unknown in the human table. No live provider searches, application restarts, playback changes or installed file edits are needed to validate this behavior.

Acceptance: malformed ID play fails without touching an invalid token path or an unreachable endpoint; a valid provider ID and local library mappings remain correct; `--help` states the provider requirement; names containing Original/Cover stay unknown; the full offline CLI suite passes.
