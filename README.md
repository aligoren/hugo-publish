# Hugo Publisher

**English** · [Türkçe](README.tr.md)

A desktop app for writing, configuring and publishing [Hugo](https://gohugo.io) sites: a visual Markdown editor, forms for `hugo.toml` and theme settings, a live preview rendered by Hugo itself, and git commit and push. It is meant to work with any Hugo site and any theme. Built with [Tauri 2](https://v2.tauri.app), React and Rust, for Windows, macOS and Linux.

> [!IMPORTANT]
> **Status: pre-release (0.1.0).** The features below are implemented and covered by tests, and the app is being tried on real sites. There are **no releases yet**; you can [build it from source](#building-from-source).

![Writing a post, with the site's own theme rendering it live on the right](.github/screenshots/editor-preview.png)

## Features

**Writing**
- A writing screen that puts the text first: a large title, then the post. Date, categories and tags sit in one line under the title; post settings, checks and the preview open in a side panel when you want them.
- Markdown editor with live formatting (CodeMirror 6): no Markdown syntax needed, toolbar and `/` menu, alert boxes (`> [!NOTE]`), right-to-left blocks with an Arabic font, tables, task lists, image thumbnails, raw mode, focus mode.
- Hugo shortcodes as chips with a parameter form; unknown shortcodes are locked so they cannot be broken by accident.
- `[[` internal link completion, clean paste from Word and Google Docs, image paste and drag & drop (metadata removed).
- Spellcheck for Turkish and English with a personal dictionary; word count and reading time.
- Front matter form for YAML and TOML: dates in their own format, taxonomies with autocompletion, images, theme page parameters, any other field; source view.
- User-defined snippets (citation card, product card…) with forms, from scratch or from a shortcode.
- Local version history with diff and restore, rename/move with automatic `aliases`, new post wizard with archetypes and language-aware slugs.
- Optional AI help (off by default, your own Anthropic API key in the OS keychain): title, description, alt text and translation suggestions.

**Preview and site**
- Preview with your own theme through `hugo server`, following the page you are editing; desktop, tablet and phone widths.
- Overview, content list with filters and bulk actions, pages & menus, categories & tags (rename, merge, similar terms), translations for multilingual sites.
- Media library: find and remove EXIF/GPS and other metadata without re-encoding, resize, unused images.

**Settings and theme**
- All of `hugo.toml` (or `config/`) as forms that keep comments and formatting; source and effective values, environments, migration assistant for deprecated keys, presets, permalink tester, menu editor with drag & drop, raw mode. Every change is shown as a diff and checked with Hugo before it is written.
- Theme settings for any theme: ready-made schemas, template scanning and theme defaults with a generic editor as the fallback; colours, custom CSS, theme texts (i18n), overridden files.
- Theme update with drift detection and three-way merge of overridden files, theme gallery and switching.

**Publishing and checks**
- Git: changes grouped in plain language, diff, suggested commit message, pull and push (never force-push). gh-pages publishing, deploy status from GitHub checks, live page check, notifications, scheduled rebuilds for future posts, draft share links.
- Pre-publish checks and site health: content checks, internal and external links, privacy audit (external requests, git identity, time zones in dates), share card preview, feeds and robots, "what will change", config warnings.
- Hugo version management: detection, download with checksum verification, version pinning and parity with your host.
- New site wizard, recent sites and site switching, command palette (Ctrl+K), backups, English and Turkish interface.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src=".github/screenshots/overview.png" alt="Overview"><br><b>Overview</b>: published, draft and scheduled posts, recent edits, what is waiting to be published and what Hugo warns about.</td>
    <td width="50%"><img src=".github/screenshots/editor-settings.png" alt="Post settings"><br><b>Post settings</b>: a form for the front matter, with dates kept in their own time zone and the final address of the post.</td>
  </tr>
  <tr>
    <td><img src=".github/screenshots/site-settings.png" alt="Site settings"><br><b>Site settings</b>: all of <code>hugo.toml</code> as forms, with the value Hugo actually uses and the default next to each field.</td>
    <td><img src=".github/screenshots/theme.png" alt="Theme settings"><br><b>Theme</b>: the theme's own parameters, found in its templates, with what each one does.</td>
  </tr>
  <tr>
    <td><img src=".github/screenshots/publish.png" alt="Publish"><br><b>Publish</b>: changes in plain language, checks before publishing, a suggested commit message, then commit and push.</td>
    <td><img src=".github/screenshots/health.png" alt="Site health"><br><b>Site health</b>: content, links, privacy, share cards, feeds and what publishing will change.</td>
  </tr>
</table>

## Principles

- **Files are the source of truth.** No database. You can keep editing the same site in VS Code; the app notices outside changes.
- **Bytes you don't touch don't change.** Comments, quoting, line endings (LF/CRLF), BOM and time zones in dates stay exactly as they were. Markdown is never regenerated from scratch.
- **Show before writing.** Config changes are shown as a diff first, and everything can be undone.
- **No telemetry.** The app goes online only for what you use: git fetch and push, downloading Hugo or a theme, link checks, deploy status, the update check at startup (can be turned off in Preferences), and AI help if you turn it on.

## Platforms

Windows is the main development platform. macOS and Linux builds compile and pass the tests in CI on every push, but they are **experimental**: the maintainers develop on Windows and have no Mac or Linux machine to test on. If you use macOS or Linux, trying a build and filing a [platform report](https://github.com/aligoren/hugo-publish/issues/new?template=platform-report.yml) helps a lot.

| Platform | Files (once releases exist) |
|---|---|
| Windows x64 | `*_x64-setup.exe` (NSIS installer), `*_x64_en-US.msi` |
| macOS (Apple Silicon and Intel) | `*_universal.dmg`, `*.app.tar.gz` |
| Linux x64 | `*_amd64.AppImage`, `*_amd64.deb`, `*.x86_64.rpm` |

Hugo Publisher uses the `git` and `hugo` (extended edition recommended) installed on your system. Neither is bundled.

## Installing an unsigned build

Releases are **not code-signed**: there is no paid certificate. Instead, every file is built by a public GitHub Actions workflow from a tagged commit, listed in `SHA256SUMS.txt`, and has a signed build-provenance attestation (see [Verifying a download](#verifying-a-download)). Your operating system will warn you once, the first time you open the app.

**Windows.** SmartScreen shows "Windows protected your PC". Click **More info**, then **Run anyway**.

**macOS 15 and later.** The app is ad-hoc signed but not notarized by Apple, so the first launch is blocked. Click **Done**, open **System Settings → Privacy & Security**, scroll down to the message about Hugo Publisher and click **Open Anyway**, then confirm. Or, in Terminal, after copying the app to Applications:

```sh
xattr -dr com.apple.quarantine "/Applications/Hugo Publisher.app"
```

**Linux.**

```sh
chmod +x Hugo.Publisher_*_amd64.AppImage && ./Hugo.Publisher_*_amd64.AppImage
sudo apt install ./Hugo.Publisher_*_amd64.deb      # Debian, Ubuntu
sudo dnf install ./Hugo.Publisher-*.x86_64.rpm     # Fedora
```

If the AppImage does not start, install FUSE 2 (`libfuse2`, or `libfuse2t64` on Ubuntu 24.04 and later).

## Verifying a download

Check the SHA-256 against `SHA256SUMS.txt` from the same release:

```sh
sha256sum -c --ignore-missing SHA256SUMS.txt         # Linux
shasum -a 256 -c --ignore-missing SHA256SUMS.txt     # macOS
```

```powershell
# Windows: compare the output with the line for that file in SHA256SUMS.txt
(Get-FileHash .\Hugo.Publisher_0.1.0_x64-setup.exe -Algorithm SHA256).Hash
```

Check where a file was built, with the [GitHub CLI](https://cli.github.com):

```sh
gh attestation verify Hugo.Publisher_0.1.0_x64-setup.exe --repo aligoren/hugo-publish
```

This proves that the file was produced by this repository's release workflow on GitHub Actions and shows the commit it was built from. `SHA256SUMS.txt` itself is attested too.

## Building from source

If you would rather not run a binary you did not build, the scripts in [`scripts/`](scripts/) build the app on your machine. They are short; please read them first. They install nothing without asking: missing tools are reported with the command to install them. Dependencies are installed from the lock files (`npm ci`, `cargo build --locked`) and the tool versions are pinned in [`rust-toolchain.toml`](rust-toolchain.toml) and [`.nvmrc`](.nvmrc).

Prerequisites:

- **All:** [Rust via rustup](https://rustup.rs) (then run `rustup toolchain install` in the repository to get the pinned version), Node.js 24 or newer, git.
- **Windows:** [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++". WebView2 ships with Windows 11.
- **macOS:** Xcode Command Line Tools (`xcode-select --install`).
- **Linux:** WebKitGTK 4.1, librsvg and friends ([list](https://v2.tauri.app/start/prerequisites/#linux)). `bash scripts/build.sh --install-deps` shows the right command for apt, dnf, pacman or zypper and asks before running it.

```sh
git clone https://github.com/aligoren/hugo-publish.git
cd hugo-publish

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -CheckOnly   # prerequisites only
powershell -ExecutionPolicy Bypass -File scripts\build.ps1

# macOS, Linux
bash scripts/build.sh --check-only
bash scripts/build.sh
```

The bundles end up in `src-tauri/target/release/bundle/`; the script prints their paths and SHA-256. Your hashes will not match the release files, because the builds are not bit-for-bit reproducible. An app you built yourself is not quarantined, so macOS opens it without the "Open Anyway" step.

## Development

Same prerequisites as above, plus `hugo` (extended) for the integration tests.

```sh
npm install
npm run tauri dev     # run the app with hot reload

npm test              # front-end tests (Vitest)
npm run lint          # oxlint
npm run typecheck

cd src-tauri
cargo test            # Rust tests
```

The Rust integration tests run the real `hugo`. When `hugo` is not on your `PATH` they are skipped; set `HUGO_PUBLISHER_REQUIRE_HUGO=1` to make that an error, as CI does. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all of the above on Windows, macOS and Linux.

## License

[MIT](LICENSE)
