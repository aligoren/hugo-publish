#!/usr/bin/env bash
# Build Hugo Publisher from source on macOS or Linux. Please read it before you run it.
#
#   bash scripts/build.sh                  check prerequisites, then build
#   bash scripts/build.sh --check-only     only check prerequisites
#   bash scripts/build.sh --install-deps   Linux: show the package install command, ask, run it
#   bash scripts/build.sh --bundles deb    only some bundle types (Linux: appimage,deb,rpm; macOS: app,dmg)
#
# What it does, in order:
#   1. Checks the tools it needs and prints how to install anything that is missing.
#      It installs nothing by itself; --install-deps shows the exact sudo command and asks first.
#   2. npm ci                       exact JavaScript packages from package-lock.json
#   3. npx tauri build -- --locked  exact Rust crates from src-tauri/Cargo.lock
#   4. Prints the files it built and their SHA-256.
# Tool versions are pinned in rust-toolchain.toml (Rust) and .nvmrc (Node.js).
# On Linux, `tauri build` downloads the AppImage tools (linuxdeploy) on first use;
# --bundles deb,rpm skips the AppImage.

set -euo pipefail
cd "$(dirname "$0")/.." # repository root

check_only=0 install_deps=0 bundles=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check-only) check_only=1 ;;
    --install-deps) install_deps=1 ;;
    --bundles) bundles="${2:?--bundles needs a value, e.g. deb,rpm}"; shift ;;
    -h | --help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

os=$(uname -s)
missing=0
have() { command -v "$1" >/dev/null 2>&1; }
ok() { printf '  ok       %s\n' "$1"; }
miss() { printf '  MISSING  %s\n           -> %s\n' "$1" "$2"; missing=$((missing + 1)); }

# System packages Tauri needs on Linux (https://v2.tauri.app/start/prerequisites/#linux).
# On Arch, update the system first (sudo pacman -Syu); partial upgrades are not supported there.
linux_deps_cmd() {
  if have apt-get; then
    echo "sudo apt-get update && sudo apt-get install build-essential pkg-config curl wget file libwebkit2gtk-4.1-dev libssl-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev"
  elif have dnf; then
    echo "sudo dnf install gcc gcc-c++ make pkgconf-pkg-config curl wget file webkit2gtk4.1-devel openssl-devel libxdo-devel libappindicator-gtk3-devel librsvg2-devel"
  elif have pacman; then
    echo "sudo pacman -S --needed base-devel curl wget file webkit2gtk-4.1 openssl xdotool appmenu-gtk-module libappindicator-gtk3 librsvg"
  elif have zypper; then
    echo "sudo zypper install gcc gcc-c++ make pkg-config curl wget file webkit2gtk3-devel libopenssl-devel libappindicator3-1 librsvg-devel"
  fi
}

if [ "$install_deps" = 1 ]; then
  if [ "$os" != Linux ]; then echo "--install-deps is only for Linux." >&2; exit 2; fi
  cmd=$(linux_deps_cmd)
  if [ -z "$cmd" ]; then
    echo "No apt-get, dnf, pacman or zypper found. Install the packages listed at" >&2
    echo "https://v2.tauri.app/start/prerequisites/#linux and run this script again." >&2
    exit 1
  fi
  printf 'This will run:\n\n  %s\n\n' "$cmd"
  read -r -p "Run it now? [y/N] " answer || answer=""
  if [[ "$answer" =~ ^[Yy]$ ]]; then sh -c "$cmd"; else echo "Skipped."; fi
  echo
fi

echo "Checking prerequisites ($os)..."

# Rust through rustup, at the version pinned in rust-toolchain.toml.
rust_channel=$(sed -n 's/^channel *= *"\(.*\)"/\1/p' rust-toolchain.toml)
if ! have rustup; then
  miss "rustup" "install it from https://rustup.rs, then run 'rustup toolchain install' in $PWD"
elif ! rustup toolchain list | grep "^${rust_channel}-" >/dev/null; then
  miss "Rust $rust_channel (rust-toolchain.toml)" "run in $PWD: rustup toolchain install"
else
  ok "$(rustc --version)"
fi

# Node.js at least the major version in .nvmrc, plus npm and git.
read -r node_want <.nvmrc || true # tolerate a missing final newline
node_want=${node_want#v}
node_want=${node_want%%.*}
if ! have node; then
  miss "Node.js $node_want or newer" "install Node.js $node_want LTS from https://nodejs.org (or: nvm install $node_want)"
elif [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$node_want" ]; then
  miss "Node.js $node_want or newer (found $(node --version))" "install Node.js $node_want LTS from https://nodejs.org (or: nvm install $node_want)"
else
  ok "Node.js $(node --version)"
fi
if have npm; then ok "npm $(npm --version)"; else miss "npm" "it comes with Node.js; reinstall Node.js"; fi
if have git; then ok "$(git --version)"; else miss "git" "macOS: xcode-select --install; Linux: install the 'git' package"; fi

if [ "$os" = Darwin ]; then
  if xcode-select -p >/dev/null 2>&1; then
    ok "Xcode Command Line Tools ($(xcode-select -p))"
  else
    miss "Xcode Command Line Tools" "run: xcode-select --install"
  fi
elif [ "$os" = Linux ]; then
  linux_missing=0
  for tool in cc pkg-config; do
    if have "$tool"; then ok "$tool"; else miss "$tool" "see the package command below"; linux_missing=1; fi
  done
  if have pkg-config; then
    for lib in webkit2gtk-4.1 javascriptcoregtk-4.1 libsoup-3.0 librsvg-2.0 openssl; do
      if pkg-config --exists "$lib"; then
        ok "$lib $(pkg-config --modversion "$lib")"
      else
        miss "$lib (development package)" "see the package command below"
        linux_missing=1
      fi
    done
  fi
  if [ "$linux_missing" = 1 ]; then
    echo "  Install the system packages with: bash scripts/build.sh --install-deps (shows the command, asks first)"
    cmd=$(linux_deps_cmd)
    if [ -n "$cmd" ]; then echo "  or run it yourself: $cmd"; fi
  fi
else
  echo "Unsupported system '$os'. On Windows use scripts/build.ps1." >&2
  exit 2
fi

if [ "$missing" -gt 0 ]; then
  printf '\n%s prerequisite(s) missing. Install them and run this script again.\n' "$missing"
  exit 1
fi
echo "All prerequisites found."
if [ "$check_only" = 1 ]; then exit 0; fi

marker=$(mktemp) # files newer than this are the ones this run built
trap 'rm -f "$marker"' EXIT

printf '\n==> npm ci\n'
npm ci

tauri_args=(build)
if [ -n "$bundles" ]; then tauri_args+=(--bundles "$bundles"); fi
printf '\n==> npx tauri %s -- --locked\n' "${tauri_args[*]}"
npx tauri "${tauri_args[@]}" -- --locked # everything after -- goes to cargo

sha256() { if have sha256sum; then sha256sum "$1"; else shasum -a 256 "$1"; fi; }
bundle_dir="$PWD/src-tauri/target/release/bundle"
printf '\nBuilt (SHA-256  file):\n'
while IFS= read -r -d '' file; do
  sha256 "$file"
done < <(find "$bundle_dir" -maxdepth 2 -type f -newer "$marker" \
  \( -name '*.dmg' -o -name '*.AppImage' -o -name '*.deb' -o -name '*.rpm' \) -print0)
find "$bundle_dir" -maxdepth 2 -type d -name '*.app' -newer "$marker" -exec echo "app bundle: {}" \;

printf '\nHugo Publisher needs git and Hugo (extended edition) on your PATH at run time.\n'
