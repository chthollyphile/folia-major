# Contribution draft: external lyric styles, Style Studio and MCP

## Proposed title

feat(style-packs): add isolated renderer packs, offline Studio and a portable MCP authoring toolkit

## Problem and behavior

Agents can currently modify built-in visualizers only by changing the player source. This adds importable style packs and an API 2 renderer contract: an author can write a complete lyric renderer, preview the same runtime in an offline Studio, and import its validated JSON into a player version that includes this loader.

The catalog distinguishes six complete personalities from eleven reusable lyric templates; the player picker, pack manager, Studio and MCP share this classification. Optional manifest metadata preserves legacy files and records template provenance without introducing runtime dependencies. Studio rejects stale import/report/screenshot results after a newer edit.

The companion MCP exposes seven read-only tools for art direction, built-in source references, format validation and supplied-motion diagnostics, plus equivalent resources/prompts. A shared aesthetic skill distinguishes per-glyph release, whole-line release and independent word assembly. It records emitter birth, actual visible travel, fixed landing anchors and N+2 retirement separately. No automatic check claims artistic acceptance.

Windows users can install the companion separately from the player. It includes a checksum-verified Node runtime, locked installed dependencies, offline Studio, source references and local new/pack/check commands. Client profiles cover Codex, Claude Code/Desktop, DeepSeek Harness and WorkBuddy; stdio and authenticated loopback Streamable HTTP share the same service. Installer and uninstaller affect the companion only.

## Review map

- `src/stylePacks/`: schema, validator, player library, isolated code runtime, offline Studio and local video references.
- `src/components/visualizer/stylePack/` and command registry: player entry points; existing appearance/storage contracts remain in place.
- `dev/stylePacks/mcp/`: bounded read-only interfaces, common guidance, host profiles and loopback transport.
- `dev/stylePacks/toolkit/`: standalone Windows staging, installer, installed CLI and protocol self-test.
- `skills/folia-style-art-direction/`: canonical guidance served by MCP and copied into Studio/toolkit.
- `style-packs/`: source-only local reconstruction examples. Wallpaper images, generated manifests, private test recordings and prepared packages are excluded.
- `test/unit/stylePacks/`, existing storage/registry contract updates and runtime browser tests: functional coverage.

## Verification of 1.0.0-rc.2 (2026-11-06)

Typecheck passed. The 104 style-pack/MCP/toolkit tests and 74 related registry, command and storage-contract tests passed; one filesystem-scan test exceeded its five-second limit under concurrent load and passed on an isolated rerun. Browser coverage includes draft races, category changes, isolated renderer failures, video extraction and transparent preview compositing. A real per-user Windows installation passed all seven tools, eight resources/guides, forty source-reference files and the prompt over stdio and authenticated loopback HTTP; invalid inputs, missing credentials and browser Origin were rejected. With only Windows directories on PATH and the working directory outside the checkout, the installed runtime completed new→pack→check for a lyric template. The rc1 upgrade/uninstall preservation checks remain the baseline; rc2 was upgraded in place.

The installed offline Studio's lyric template passed all 60 rendering checks and deterministic replay; the legacy Nightingale pack retained its compatibility classification without rewriting the file. A real Codex model turn completed ten calls covering all seven tools against the installed service, including the six/eleven catalog split, template provenance and validation of the Nightingale 1.3.0 pack. No visual-artistic acceptance is implied. Claude/DeepSeek Harness/WorkBuddy profiles have configuration/SDK coverage, not verified host UI/model turns.

Two independent review rounds covered the rc2 delta. Round one found overwritten manifest code on category changes (high) and incomplete short-line entry (medium); both were reproduced and fixed. Round two found retirement before the N+2 first glyph and broken Arabic shaping (both medium); both were fixed with regressions, without a third independent review. Manual screenshot review additionally found Chromium's opaque iframe backdrop; theme compositing now has a browser pixel regression and exports retain transparency. The delivery includes SHA256SUMS, corresponding source and detailed local evidence; GitHub-hosted CI itself has not yet been run.

Use `npm run style:tools:source` to prepare the corresponding source archive and a binary-safe patch against the recorded base commit without changing the user's index or creating a commit. Review `contribution.json` before applying the patch to a clean contribution branch. No generated installers, local paths containing credentials, or wallpaper artwork should be committed.

## Release scope and limits

The contribution branch targets `chthollyphile/folia-major` `main`, integrated on `cc6226e464050a456a2913e062374f23d3844cc5` (player 0.7.26). Typecheck and 216 tests passed on this base, including the style-pack suite, command/storage/registry contracts and the upstream Machi beat/tuning tests. The rc2 installer and browser evidence above were produced before this upstream refresh; the contribution preserves the upstream player version and changes.

- Independent toolkit candidate, not an official player release; the player version number and release publishing destinations remain unchanged.
- Existing player builds need the new loader before they can import API 2 packs. The installed Studio is usable independently.
- MCP never executes submitted renderer code; Studio and the player execute it under the documented isolation/runtime limits.
- Motion diagnostics inspect supplied numeric samples, not the video itself. Visual acceptance still requires continuous observation.
- Windows x64 installer is unsigned. Other platforms use the source-based service and exported profiles; no native installers claimed.
- Built-in source references and corresponding project source retain the project license. Third-party dependencies retain their license files; Node's complete license is included.

Review the contribution against the recorded upstream base. Generated installers and private reconstruction artwork remain outside the source change; the Windows candidate workflow builds review artifacts without publishing a player release.
