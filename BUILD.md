# Build


## Prerequisites

### General

Grain-Nest is built and used on macOS (Apple Silicon). The Playwright tests
also run on Linux in CI.

- **Node 20+:** [Node.js](https://nodejs.org), or `brew install node`.
- **Python 3.7.9 and up** — only needed to rebuild native modules from source.
- **RUST** setup rust via https://rustup.rs/ - mainly for used for plugins - currently not used in this repo.

### MACOS

[Install Homebrew](https://docs.brew.sh/Installation), then:
```shell
xcode-select --install
brew install boost
brew install node    # or install Node 20+ from https://nodejs.org
```

Node.js 20+ is required to run `npm install` and the app from source. Boost
and the Xcode command-line tools are only needed if you ever rebuild the
native modules from source (`npm run rebuild-native`); the prebuilds
shipped via npm work without them for typical use.

### LINUX (CI tests only)

See `.github/workflows/playwright.yml`. The tests need Node and the system
libraries Electron uses (`npx playwright install-deps chromium`); nothing is
compiled, so no compiler or Boost is needed.

### Possible Problems

- close-and-open all command shells and your IDE to activate the latest setup

## Building

```sh
git clone https://github.com/cut-on-fold/Grain-Nest
cd Grain-Nest
npm install
npm run build
npm run start
```

### Transferring between platforms

`node_modules/` is platform-specific (it contains a compiled Electron
binary and native modules built for the host OS) and is gitignored for
that reason. Don't copy it between machines; if a project folder arrives
with one from another computer, delete it and run `npm install` again.

### Rebuild

```sh
# If you change the electron-related files (web files, javascript), a build with
npm run build

# If you change the the Minkowski files (the `.cc` or `.h` files):
npm run build-all
```

### Running

- `npm run start`

### Clean builds

```sh
npm run clean  && npm run build

# full clean, incl. `node_modules`
npm run clean-all && npm install && npm run build
```

### Running the tests

First, one-time setup:

```sh
npx playwright install chromium
```

Without this, you may encounter tests timing out after 30000 milliseconds.

Then, simply run `npm run test`.

### Add tests via playwright codegen

To create new tests you can run:

```sh
npm run pw:codegen
```

or

```sh
node ./helper_scripts/playwright_codegen.js
```

### Create the Mac app (Grain-Nest.app)

On an Apple Silicon Mac:

```sh
npm run dist

# During development, you can combine `clean-all, build and dist` via:
npm run dist-all
```

The app is written to `out/Grain-Nest-darwin-arm64/Grain-Nest.app`, with
the icon from `icon.icns`. It is ad-hoc signed (not signed with an Apple
developer certificate), so the first launch needs the steps in
[docs/USAGE.md](docs/USAGE.md#opening-the-mac-app-the-first-time).

To share it as one file, make a disk image like the release does:

```sh
mkdir -p dmg && ditto out/Grain-Nest-darwin-arm64/Grain-Nest.app dmg/Grain-Nest.app
ln -s /Applications dmg/Applications
hdiutil create -volname Grain-Nest -srcfolder dmg -ov -format UDZO Grain-Nest.dmg
```

### Builds on GitHub

- **Every change** (push to `main` or a pull request): `playwright.yml` runs
  the tests on Linux.
- **Mac app**: `build.yml` builds `Grain-Nest.app` (arm64) on a macOS
  machine. It only runs when started by hand (Actions → *build* → *Run
  workflow*; the disk image appears under *Artifacts* on the run page) or when a
  release is published (a Mac app is only needed for a release).
- **Releases**: publishing a GitHub release runs `build_release.yml`, which
  builds the app and attaches `grain-nest-v<version>-macos-arm64.dmg` to the
  release. Or run it by hand (Actions → *build release* → *Run workflow*)
  with a version tag such as `v1.1.0`: it builds the app, creates that
  release if it doesn't exist yet, and attaches the disk image. Bump `version` in
  `package.json` to match first (`npm version 1.1.0 --no-git-tag-version`),
  since the disk image is named after it.

## Debugging

If the environment variable "deepnest_debug" has a value of "1", deepnest will open the browser dev tools (debugger/inspector).
