---
name: online-song-omni-routing
description: Standardize Folia online-song data access around the Omni facade, including search, playback, lyrics, catalogs, libraries, recommendations, account actions, mutations, provider identity, and explicit cross-provider flows. Use when adding, refactoring, reviewing, or testing online music features, when deciding whether a caller may use a provider adapter directly, or when implementing provider aggregation, fallback, comparison, or migration.
---

# Online Song Omni Routing

Use this skill for every feature that exchanges data with an online music provider. Read the relevant sections of `README.md` and `src/README.md` first; treat `src/services/onlineMusic/omni.ts` and `src/types/onlineMusic.ts` as the public contract.

## Non-negotiable rule

Unless the feature is explicitly cross-provider, route all online-song data interaction through `omni`.

This rule applies to search, song detail, audio URLs, availability/replacement, lyrics, chorus ranges, playlists, albums, artists, recommendations, account status, likes, subscriptions, playlist mutations, and page URLs. Components, hooks, stores, and ordinary app services must not import a concrete provider, provider registry, or provider transport to perform these operations.

`omni` is a facade, not a raw-response escape hatch. Callers consume `UnifiedSong`, `OmniCollection`, `OmniPage`, `OmniLyricsResult`, `OmniAudioSource`, `OmniUser`, and `OmniError`; never make caller code depend on provider-specific field names or envelopes.

## Decide the boundary before coding

Classify the requested behavior as one of these:

- **Single-provider flow**: the user is browsing, playing, editing, or reading data belonging to the active provider or to the provider that owns a song/collection. Use an `omni` method that routes by active provider, song source, or collection provider.
- **Explicit provider selection**: the UI lets the user choose one provider. Still use `omni`, normally `searchProviderSongs`, `getProviderUserPlaylists`, `getProviderCapabilities`, or another provider-explicit Omni method. Selecting a provider is not by itself a reason to bypass Omni.
- **Cross-provider flow**: the product behavior intentionally combines two or more providers, such as comparison, federated search, fallback across providers, duplicate review, or migration. Implement an app/service-level orchestrator that calls Omni's provider-explicit methods and preserves each result's source identity.
- **Provider implementation**: the change adds or repairs one adapter's transport, request mapping, raw-response unwrapping, or normalization. Only the provider adapter and transport layers may use that provider's raw API. Keep the result behind the Omni contract.

If the request does not explicitly say cross-provider, default to single-provider routing through Omni. Do not infer cross-provider behavior merely because multiple providers are registered.

## Canonical Omni examples

### Ordinary online-song flow

```ts
import { omni } from '@/services/onlineMusic/omni';

const page = await omni.searchSongs(query, { limit: 30, offset: 0 });
const song = page.items[0];
if (song) {
    const lyrics = await omni.getLyrics(song);
    const audio = await omni.getAudioSource(song, 'high');
    const availability = omni.getSongAvailability(song);
}
```

For a song already in the queue, use the song-aware methods so Omni routes by `song.sourceRef`:

```ts
await omni.toggleSongLike(song);
await omni.addSongToPlaylist(song, playlist);
const tracks = await omni.getCollectionTracks(playlist, { limit: 50, offset: 0 });
```

For an explicitly selected single provider, retain the same boundary:

```ts
const page = await omni.searchProviderSongs('kugou', query, { limit: 30, offset: 0 });
const capabilities = omni.getProviderCapabilities('kugou');
```

Do not replace these calls with `kugouProvider.search.searchSongs(...)`, `requestKugou(...)`, `neteaseApi(...)`, or a direct `fetch` from a component, hook, store, or app-level feature service.

## Explicit cross-provider examples

Cross-provider code must say what makes it cross-provider and must keep provider identity attached to every result. Prefer Omni's provider-explicit methods even here:

```ts
import { omni } from '@/services/onlineMusic/omni';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';

const providers = omni.getProviderSummaries()
    .filter(summary => summary.availability.configured)
    .map(summary => summary.providerId);

const pages = await Promise.all(
    providers.map(providerId => omni.searchProviderSongs(
        providerId,
        query,
        { limit: 20, offset: 0 },
    )),
);

const results = pages.flatMap(page => page.items);
const uniqueBySource = new Map(results.map(song => [getPlaybackSongKey(song), song]));
```

This is valid because the feature is intentionally federated search. A fallback implementation is also cross-provider only when the product explicitly requires it:

```ts
for (const providerId of providers) {
    const page = await omni.searchProviderSongs(providerId, query, { limit: 20, offset: 0 });
    if (page.items.length > 0) return page.items;
}
return [];
```

When merging semantically duplicate songs, use an explicit matching policy (for example normalized artist/title/duration) but never discard the original provider ID. A duplicate is not the same playback identity: `online:netease:123` and `online:kugou:123` are different songs until the user or a documented policy chooses one.

Direct provider calls are still not the default for cross-provider features. Use them only inside the adapter/transport implementation when the cross-provider orchestration needs a capability that Omni does not expose; first extend the Omni contract when the capability is a normal online-song operation.

## Layer rules

| Layer | Allowed online data access | Forbidden |
| --- | --- | --- |
| Component / hook / store | `omni` and shared source-aware utilities | provider registry, provider adapter, transport, raw API |
| Ordinary app-level service | `omni`; source-aware utilities | concrete provider calls |
| Cross-provider orchestrator | `omni` provider-explicit methods; provider summaries/capabilities | dropping `providerId`, comparing numeric IDs alone |
| `src/services/onlineMusic/*Provider.ts` | its own transport and adapter helpers; normalize into shared types | leaking raw response shapes to callers |
| `src/services/onlineMusic/*Transport.ts` | HTTP/IPC/provider protocol | UI or product orchestration |
| Tests | test the layer being changed; Omni tests for routing, adapter tests for normalization | fixtures that pretend raw provider data is the public contract |

If Omni lacks a normal capability, add the capability to `src/types/onlineMusic.ts` and `src/services/onlineMusic/omni.ts`, then implement it in each applicable adapter. Do not create a second public bypass around Omni.

## Identity and normalization rules

- Treat online identity as `(sourceRef.kind: 'online', sourceRef.providerId, sourceRef.mediaId)`, not `song.id` alone.
- Use `getPlaybackSourceRef`, `getPlaybackSongKey`, `isSamePlaybackSong`, and existing source-aware helpers before comparing, deduplicating, replacing, or queuing songs.
- Keep `providerId` on `UnifiedSong`, `SongResult`, collections, catalog references, cache keys, and mutation checks.
- Route a song mutation through the provider that owns the song. Do not add a Netease song to a KuGou playlist unless the feature explicitly resolves and confirms a cross-provider mapping.
- Normalize raw provider data once at the adapter boundary. Callers should receive stable shared types and `OnlineProviderError`/`OmniError` codes.
- Respect capability and availability checks. An unsupported operation is not an empty successful result; preserve the existing Omni error/empty-page convention.
- Preserve active-provider request cancellation behavior. Do not cache or apply a late response after the active provider changes.

## Implementation workflow

1. Read the relevant README sections and locate the actual Omni method/type, provider adapter, and transport.
2. Classify the feature using the boundary decision above. Write the cross-provider reason in the service/function name or a short comment when it is not obvious.
3. Implement ordinary calls through Omni. If a normal capability is missing, extend the Omni contract instead of bypassing it.
4. For provider changes, verify the raw contract with the provider-specific alignment skill and keep normalization inside the adapter.
5. Add focused tests for routing, source identity, capability failures, and cross-provider deduplication/fallback when applicable.
6. Run the repository's testing guidance for the touched path; prefer focused unit tests over an unrelated full build.

## Review checklist

- [ ] Is every online-song call in a component, hook, store, or ordinary app service made through `omni`?
- [ ] If a concrete provider was used, is the file a provider adapter/transport or a focused adapter test?
- [ ] If the code loops over providers, is the cross-provider product behavior explicit and documented?
- [ ] Does every song/collection retain `providerId` and source-aware identity?
- [ ] Are search, playback, lyrics, catalog, account, recommendation, and mutation results shared Omni types rather than raw provider data?
- [ ] Are capability, availability, auth, network, and unsupported states preserved?
- [ ] Are numeric IDs ever compared without provider identity? If yes, fix them.
- [ ] Is there a focused test for the new routing or adapter behavior?
