---
name: prepare-folia-release
description: Prepare a new stable Folia release from the commits since the latest reachable stable vA.B.C tag. Use when entering a new-version or Realeco release flow, drafting user-facing changes, updating NewFeaturesIntro content and locales, bumping desktop and Docker versions, synchronizing realeco-release/package metadata, or producing paste-ready Markdown release notes.
---

# Prepare Folia Release

Prepare release files and hand the user paste-ready notes. Do not commit, tag, push, publish, or trigger a workflow unless the user explicitly requests that separate action; pushing `realeco-release` on `main` can start the production release workflow.

## 1. Establish the release range

1. Inspect `git status --short` and preserve all pre-existing user changes.
2. Find the newest stable tag reachable from `HEAD`. Only accept tags matching `^v[0-9]+\.[0-9]+\.[0-9]+$`; ignore channel tags such as `limo` and prerelease tags.
3. Treat `<base-tag>..HEAD` as the release range. Record the base tag and full HEAD SHA.
4. Inspect both commits and actual changes:

```bash
git log --reverse --format='%H%x09%s' <base-tag>..HEAD
git diff --stat <base-tag>..HEAD
git diff --name-only <base-tag>..HEAD
```

Read the implementation behind candidate features. Do not derive release notes from commit subjects alone. Keep uncommitted changes outside the release-range analysis unless the user explicitly asks to include them.

## 2. Draft user-facing changes

- Describe observable capabilities, improvements, compatibility changes, and meaningful fixes in user language.
- Exclude dependency bumps, refactors, tests, CI, debug helpers, and internal maintenance unless they materially change user experience.
- Do not overstate partial or provider-limited support. Preserve limitations that users need to know.
- Consolidate related commits into one item and avoid implementation details.
- Select roughly 3–6 primary items for the in-app feature cards. The Markdown release notes may include additional meaningful fixes.

Determine the target desktop version before writing. It must be a stable `A.B.C` version greater than the base stable version. If the user did not provide it, propose the appropriate SemVer bump and confirm it before modifying files.

## 3. Update NewFeaturesIntro-related files

Use the desktop target version consistently:

1. In `src/components/modal/newFeaturesRelease.ts`:
   - set `i18nKey` to `releaseNotes.vA_B_C`;
   - replace the feature cards with the selected release items;
   - reuse suitable `lucide-react` icons and remove only imports made unused by this edit;
   - for a major (codenamed) update the user names, set `majorUpdate: { codename: '<Name>' }` so the intro shows the "<Name> Update · major update" label (text in `help.majorUpdateLabel`, codename untranslated), and also name the update in each locale's `intro` (precedent: 0.7.1 Pleiades, 0.7.17 Spica); otherwise remove `majorUpdate`.
2. In every locale returned by `rg -l '"releaseNotes"' src/i18n/locales`:
   - add a new `vA_B_C` object without deleting historical releases;
   - add `intro` plus matching `title` and `description` keys for every card ID;
   - write in that locale's existing language and tone. The current locales are `en.ts`, `in.ts`, and `zh-CN.ts`.
3. Set `USER_GUIDE_AUTO_OPEN_VERSION` in `src/components/modal/userGuideContent.ts` to `A.B.C`.

Keep card IDs identical across the release definition and all locales.

## 4. Update release versions

Desktop/Realeco and Docker are independent version streams. Never copy one version into the other merely for consistency.

For desktop/Realeco, write the same stable `A.B.C` value to:

- `package.json` → `version`;
- `package-lock.json` → the top-level `version` and `packages[""].version`;
- `realeco-release` → exactly one version line with a trailing newline.

For Docker, update `deploy/docker/VERSION` to a stable version greater than its current value. If the user did not specify a Docker version, propose the next patch version separately and confirm it before writing.

The eventual release commit's complete message must be exactly `release: vA.B.C`; extra body text fails `.github/workflows/electron-release.yml`. Report this requirement, but do not create the commit without explicit authorization.

## 5. Validate the prepared release

1. Confirm every edited version is plain SemVer and increases from its own previous value.
2. Confirm `package.json`, both root lockfile version fields, and `realeco-release` match.
3. Confirm every feature card has text in every locale and `USER_GUIDE_AUTO_OPEN_VERSION` matches the desktop version.
4. Run:

```bash
git diff --check
npm run test:unit -- test/unit/realecoReleaseMetadata.test.ts
bash deploy/docker/scripts/validate-version.sh deploy/docker/VERSION <previous-docker-version>
```

5. Follow `skills/testing-strategy/SKILL.md` for any additional validation. Do not run a full Electron package by default. If a dev server is already running, inspect its errors instead of starting another build.
6. Review `git diff` and ensure only intended release-preparation files changed.

## 6. Return the handoff

Report the comparison range, desktop version, Docker version, changed files, and validation results. Then provide a directly copyable Markdown block, written for users rather than developers:

```markdown
## 更新说明

- <最重要的新功能或改进>
- <其他用户可感知变化>
- <必要的限制或重要修复>
```

End with the required future commit message: `release: vA.B.C`. Keep the Markdown notes aligned with the in-app cards, while allowing extra user-relevant fixes that do not merit a card.
