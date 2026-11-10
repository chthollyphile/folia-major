#!/bin/sh
set -eu

# The probe uses the production native host with an isolated bundle/store and explicit visible mode.
probe_source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
probe_repo_root=$(CDPATH= cd -- "$probe_source_dir/../../../.." && pwd)
sh "$probe_repo_root/electron/appleMusic/macos/buildCompanion.sh" \
    "$probe_repo_root/test-results/apple-music-wk-probe/FoliaWKProbe.app" org.folia.AppleMusicWKProbe
