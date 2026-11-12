# Contributing to Folia

[简体中文](CONTRIBUTING.md) | [English](CONTRIBUTING.en.md)

Thank you for contributing to Folia. You can help by reporting issues, providing reproduction steps, verifying fixes, improving documentation, or submitting code. This guide sets out the requirements for contributions to the mainline. Please read it before making changes or submitting a pull request (PR).

## Understand the boundaries of mainline contributions

**Personal modifications and mainline contributions are two different things.** Folia is opinionated software with its own design direction and architectural preferences. The mainline does not aim to satisfy every user's needs, and feature acceptance is not decided solely by how many people support it.

Even if many users consider a feature necessary, it will not be merged into the mainline if it does not align with the maintainers' design preferences or architectural direction. Submitting a PR does not mean the maintainers have committed to accepting it; a complete implementation and passing tests do not guarantee a merge. You are welcome to maintain your own modifications in a fork.

For new features, interaction changes, architectural changes, or new dependencies, we recommend opening an issue first to explain the actual need, use cases, and proposed approach. Confirm the direction before investing in implementation. Small, straightforward fixes and documentation corrections can be submitted directly as PRs.

**We do not recommend contributing code directly to the mainline if you are completely unfamiliar with software development, Git, or basic code review processes, even if you have an agent tool that can write code automatically.** First learn to modify, debug, review, and verify changes in your own fork. Reporting problems, providing feedback, and helping reproduce issues are also useful contributions.

## AI tools and submission responsibility

**Folia allows and welcomes AI coding tools, but every PR must involve a human in the final verification. The person submitting the code is responsible for its contents and must be able to clearly explain the PR's overall design, why it is being proposed, and what real, existing problem it solves.**

Using AI to generate code, tests, or review feedback does not transfer the submitter's responsibility. You should understand the final diff, verify the tool's conclusions, and personally confirm that the changes behave as described in actual use. A tool claiming that work is complete or tests pass is no substitute for human verification.

**Every PR must first undergo a code review locally, and all review findings must be manually verified.** AI and other tools may assist with review, but a human must assess each finding, decide whether it is valid and requires a fix, and verify the outcome.

If a submitted PR cannot even perform its claimed functionality correctly in direct use, we have reason to suspect that it was submitted by an automated system and will close it.

**Automated pull requests initiated by anything other than this repository's own infrastructure will be closed immediately, regardless of their contents.** This rule applies to automatically initiated PRs. Contributors using AI assistance must still complete their own review and human verification and take responsibility for the submission.

## Reporting issues and proposing ideas

Before opening an issue, search existing issues and PRs to avoid duplicates. A bug report should include, where possible:

- The Folia version, platform, and whether you are using the web or desktop application.
- Repeatable reproduction steps, expected behavior, and actual behavior.
- Relevant screenshots, error logs, and necessary configuration details.
- Whether the issue can be reproduced in a version without your personal modifications.

Feature proposals should describe specific use cases, shortcomings in the current behavior, and the desired outcome. Keep discussions focused on the problem and respect the time of maintainers and other participants.

Do not expose account credentials, cookies, tokens, API keys, or other personal information in issues, PRs, logs, or screenshots.

## PR scope and dependencies

- **One PR should address one topic.** Include the implementation, tests, and documentation needed for that problem. Do not bundle unrelated refactoring, formatting, or features.
- **Backend provider dependencies must be integrated through normal dependency management. Importing an entire backend's source code into this repository is prohibited.** Declare dependencies in the appropriate manifest and update the necessary lockfiles. Do not copy an entire backend project as a substitute for dependency management.
- Do not commit local credentials, secrets from environment configuration, debug artifacts, or generated files unrelated to the topic.

## Review and verification

Before submitting a PR, review the entire local diff, confirm that every file and change belongs to the topic, and manually verify all review findings. Verification must cover the problem the PR claims to solve or the functionality it claims to provide; checking whether the code compiles is insufficient.

Before opening a PR, run `npm run lint:fix-style` at the repository root. It fixes only the layout (indentation, quotes, line breaks) of the files you changed and does not change what the code means; the first run installs ESLint's separate environment. Use `npm run lint` to see the problems it cannot fix. CI annotations with a `D` code come from the Dedicatus architecture checks; see [`dev/dedicatus/README.md`](dev/dedicatus/README.md). If a Dedicatus contract test fails in the unit tests, add the registration its message asks for under `dev/dedicatus/` (for example, a new IPC channel goes in `ipcChannels.mjs` and a new persisted key in `storageKeys.mjs`).

Accurately report the checks you ran and their results in the PR. Also state any unverified environments, known limitations, or remaining problems.

## Submitting a pull request

The PR title should clearly summarize its topic. The description should include at least:

- **Problem and motivation:** What real, existing problem does it solve, and why is the change needed? Link related issues where applicable.
- **Overall design:** What approach did you take, how does key behavior change, and what tradeoffs are involved?
- **Verification results:** Describe the local code review, manual verification of all review findings, verification in actual use, and the results.
- **Impact and limitations:** Identify affected platforms or use cases and anything still unverified. Screenshots or demonstrations help reviewers assess UI changes.

Before submitting, confirm that your branch is based on the latest mainline and contains no unrelated files or accidental changes. Address maintainers' review feedback and repeat the necessary review and verification for subsequent changes.

Maintainers may request a different approach, ask you to narrow the scope, or close a PR because it conflicts with the design direction, lacks actual verification, or has a design the submitter cannot explain. Do not repeatedly submit the same proposal to bypass an explicit decision.

## Maintainer exemption

**The repository Owner and maintainers who have been granted Collaborator permissions are not subject to the mandatory restrictions of the ordinary contribution process.** Maintainers may determine branching, submission, review, and merging procedures according to the project's maintenance needs.

## License

By submitting a contribution, you confirm that you have the right to provide its contents and agree to release it under this repository's [license](LICENSE). When introducing third-party code, assets, or dependencies, confirm license compatibility and retain any required attribution and license notices.
