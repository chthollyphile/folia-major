# Folia macOS Now Playing

macOS bridge for Folia's existing **Now Playing** stage source.

- Speaks `ws://localhost:9863/api/ws/lyric`
- Reads **Music.app** (Apple Music / local library) via AppleScript
- Fetches LRC from [lrclib.net](https://lrclib.net)
- Does **not** embed Apple Music streaming inside Folia

See also: [docs/desktop/macos-now-playing.md](../../docs/desktop/macos-now-playing.md)

## Requirements

- macOS
- Node.js 18+
- Folia desktop app
- Music.app playing audio

## Usage

```bash
cd tools/macos-nowplaying
npm install
npm start          # follow Music.app
npm run demo       # protocol self-test without Music.app / lyric APIs
```

In Folia:

1. Settings → Options → Connection & Integration
2. Enable Stage Mode
3. Source: **Now Playing**
4. Play a song in Music.app

Health check:

```bash
curl http://127.0.0.1:9863/health
```

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `FOLIA_NP_HOST` | `127.0.0.1` | Bind host |
| `FOLIA_NP_PORT` | `9863` | Port (Folia Now Playing is fixed to this) |
| `FOLIA_NP_POLL_MS` | `250` | How often the Node side reads the cached Music snapshot |
| `FOLIA_NP_PROGRESS_PUSH_MS` | `1500` | Min interval between `PlayerProgress` WS pushes (Folia extrapolates; too frequent causes stutter) |
| `FOLIA_NP_OFFSET_MS` | `500` | Delay lyrics vs audio (ms). If lyrics are early, increase (e.g. `700`). If late, decrease or use `0` / negative |
| `FOLIA_NP_IDLE_STOP_MS` | `15000` | After the last Folia client disconnects, pause the Music monitor to free RAM |

### Memory notes

- Node starts with `--max-old-space-size=64`
- AppleScript monitor starts **only when Folia connects**, and pauses after idle
- Lyric cache keeps at most 8 LRC strings
- Check `curl http://127.0.0.1:9863/health` → `memory.rssMb` / `memory.monitor`

Also implements Folia's drift-correction probe:

```bash
curl http://127.0.0.1:9863/api/query/progress
# {"progress":123456}
```

## Protocol

Events mirror Folia's `NowPlayingProvider` consumer:

`Track` · `Lyric` · `PlayerPauseState` · `PlayerProgress` · `PlayerProgressReplay`

## License

Same as the Folia repository (AGPL-3.0), unless otherwise noted for third-party lyric providers' terms of use.
