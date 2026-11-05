# UI comparison board

A local development tool for reviewing immutable Before/After screenshots and pinning feedback. It uses the repository's Node version, native ES modules, and existing Playwright dependency. It does not start the game or call providers.

## Start and select a review

From the repository root:

```sh
pnpm ui:review
pnpm ui:review --review output/ui-review/<review-id> --port 5190
pnpm ui:review --review output/ui-review/<review-id> --check
```

The default is `http://127.0.0.1:5192`, using `output/ui-review/LATEST`. Put a review directory name such as `20261031T075732Z` in `LATEST`; relative values resolve beside that file. Existing absolute pointers remain supported. Explicit `--review` paths resolve from your working directory. Running the server directly from another directory still finds this repository's default `LATEST`.

Review archives are local and are not included in a fresh checkout. Create a review using the format below, or restore an existing archive and select it with `--review`. Keep the same hostname, port and review ID when restarting: pending browser drafts belong to that origin and review. The tool never silently switches reviews or overwrites unreadable feedback. Use `--help` for CLI options. `--check` verifies the review without creating progress or listening on a port.

Before restarting an occupied port, verify its process is the review server and stop only that process. The server binds to loopback; writes require same-origin JSON requests. No cloud upload or public hosting is involved.

On shutdown, the server closes lingering connections after one second and drains accepted atomic feedback/progress writes before exiting. A connection can close before its save acknowledgement arrives, so retain and retry any browser-side pending draft. Synthetic server tests hold an atomic write across shutdown, then restart the server to verify comments, numbering, tombstones and viewed captures. Repeated shutdown and speculative connections are tested separately.

## Review and saved feedback

Next follows **Desktop frames → Phone frames → next state**, grouped into seven flows. Previous reverses that order. A shorter version holds its final image while the other continues. Fit contains the whole screenshot; 100% allows panning, linked or independent through More. Comments open on demand.

Captures count as viewed after both images decode and both panes remain at least 75% visible for 500ms in a focused, visible tab. All captures in both sizes complete a state. Legacy manual review marks remain honored separately. **Viewed means seen, not approved**; it never resolves comments.

Click an image or focus its pane and press Enter to create a pin. Arrow keys move a focused pin; Shift moves farther. New empty pins stay local until text is entered; existing empty comments survive. Text saves as typed. More contains JSON/Markdown export, including pending text and progress. Save failures retain a browser queue and offer Retry; unavailable browser storage is reported explicitly.

Each review directory contains:

| File                         | Purpose                                                                |
| ---------------------------- | ---------------------------------------------------------------------- |
| `manifest.json`, image files | Immutable capture identities and screenshots                           |
| `sealed.json`                | SHA-256 hashes of immutable files                                      |
| `feedback.json`              | Comments, IDs/numbers, tombstones, coordinates and legacy review marks |
| `progress.json`              | Automatic viewed capture IDs; created on first saved view              |

Browser keys remain `hmo-review:<id>` for drafts, `hmo-progress:<id>` for queued progress, and session storage `hmo-position:<id>` for tab-local navigation. Keep these when moving an existing review. Automatic progress merges by union; saved comments retain their existing timestamp merge behavior.

## Create a compatible review

There is no new screenshot-capture framework. Use your capture workflow to produce matched, actual Before/After images, then package them as follows:

1. Create a new, unique directory under `output/ui-review/`. Never recapture into an existing review ID: pins and progress attach to immutable capture IDs.
2. Capture both `desktop` and `phone`, `before` and `after`, for every state. Keep names, content, timers and animation settings matched. Include continuation images when actual scroll containers contain more content. Number each version's frames consecutively from zero; unequal frame counts are supported.
3. Write the manifest using the contract below. Image dimensions must match the image files. Compute each image's SHA-256; assign a stable, unique capture ID. Keep provenance metadata or source snapshots in this ignored review directory as needed.
4. Initialize `feedback.json` with the matching review ID, schema version 1, revision 0, empty `comments: []` and `reviewed: {}`. `progress.json` is optional; if supplied, use schema version 1, matching `reviewId`, and `viewedCaptureIds: []`.
5. Write `sealed.json` with `reviewId`, `sealedAt`, and `hashes`, mapping review-relative filenames to their SHA-256. Include `manifest.json`, every image, and any immutable snapshots. Exclude `feedback.json`, `progress.json`, `sealed.json` itself, backups, and mutable reports. Viewer code is shared from `tools/ui-review/`, so new reviews need no bundled viewer.
6. Run `pnpm ui:review --review output/ui-review/<review-id> --check`. Only after validation, set `LATEST` to the directory name to make it the default.

The [small synthetic fixture](tests/fixtures/manifest.json) is a complete example, including unequal continuations. Its images are test patterns, not game screenshots. Extra provenance fields from existing reviews remain supported.

Minimum manifest structure (the capture shown must be repeated for both versions and sizes):

```json
{
  "id": "unique-review-id",
  "baseline": "before-revision",
  "created": "2026-01-01T00:00:00Z",
  "browser": "Browser and version",
  "reducedMotion": true,
  "media": "Synthetic media",
  "scenarios": [
    {
      "id": "entry",
      "title": "Create a room",
      "group": "Entry & setup",
      "note": ""
    }
  ],
  "captures": [
    {
      "id": "entry:desktop:before:0",
      "scenario": "entry",
      "viewport": "desktop",
      "version": "before",
      "frame": 0,
      "file": "images/entry-desktop-before-0.png",
      "width": 1440,
      "height": 900,
      "sha256": "<64 lowercase hexadecimal characters>"
    }
  ]
}
```

Allowed groups are **Entry & setup, Lobby, Coin & topics, Gameplay, Results, Recovery, Shared UI**. Keep unique state IDs and capture IDs, safe relative file paths, and one capture per state/size/version/frame. State order follows the manifest within each flow, with the existing result examples ordered together by the viewer. Screenshots use PNG. Seals are checked on every startup, including older reviews that sealed their own historical viewer files.

All generated reviews, snapshots, test artifacts and backups belong under ignored `output/`. Do not copy real comments or captures into the committed fixture directory. Only synthetic fixtures belong in source control.

## Back up and restore

- Export JSON from the board before closing it if drafts are pending. Browser-only drafts are not included in a filesystem backup; Markdown is for reading, not full restoration.
- Stop the verified server for that review, then copy the **complete review directory** into a new ignored `output/ui-review/backups/<backup-name>/` directory. Preserve its manifest, images, seal, feedback and progress together. Retain a checksum listing with the backup.
- To restore, stop the server and first back up any newer data. Restore the matching directory without changing its review/capture IDs or immutable files; run `--check`, then restart on the original hostname and port. Do not overwrite newer comments blindly.
- Feedback/progress can be restored separately only when their review ID and capture hashes match the unchanged immutable review. Progress is optional for old backups; never recreate missing feedback silently. Keep exported pending drafts safe and the original browser storage intact until recovery is confirmed.

## Tests

```sh
pnpm exec playwright install --with-deps chrome webkit
pnpm test:ui-review
```

Unit/server tests use Node's test runner. Browser tests use an isolated Playwright configuration with retries disabled: headless Chromium/Chrome and WebKit, plus a headed Chromium focus check with Playwright focus emulation disabled. The focus check requires a desktop display (or an existing virtual display on Linux). The dedicated CI job follows the repository's macOS runner convention.

For a targeted run:

```sh
node --test tools/ui-review/tests/*.test.mjs
pnpm exec playwright test --config tools/ui-review/playwright.config.mjs --project=webkit
pnpm exec playwright test --config tools/ui-review/playwright.config.mjs --project=chromium-focus
```

Tests copy the small synthetic fixture into disposable directories before writing. They need no existing reviews, source snapshots, provider credentials, or gameplay servers. Reports, failure traces and visual evidence go to `output/ui-review-tests/`. Legacy feedback, empty comments, tombstones, marks and browser draft keys are covered. Real-review migration checks must use disposable copies of mutable data and verify original hashes before and after; never point mutating tests at a user's feedback.
