# Developing Hear Me Out

- Use the Node and pnpm versions pinned in `.node-version` and `package.json`. Start with `pnpm check`, `pnpm test`, and `pnpm verify:matrix`.
- Use the loopback browser fixtures for gameplay and provider failure scenarios. They run the real game and media code with deterministic providers. See the [browser test guide](tests/browser/README.md) and [protocol](docs/PROTOCOL.md).
- Preserve private mic checks outside scoring, complete judge playback before admitting a rematch, and preserve shared results across reconnects. The release owner reviews any change to those acceptance outcomes. [Audio acceptance](docs/AUDIO_ACCEPTANCE.md)
- Run `pnpm verify:release --sha <full-sha>` on an interactive Apple silicon Mac. Save qualification evidence locally by SHA and use `pnpm release:check --sha <full-sha>` before the release owner promotes it. [Render runbook](docs/RENDER.md)
