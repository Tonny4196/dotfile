#!/bin/bash
set -e

DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"

# 既存の実体があれば .bak.<timestamp> へ退避してからリンクを張る。
# 既にシンボリックリンクなら張り直すだけなので何度実行しても増殖しない。
# ディレクトリを ln -sfn で上書きしようとして中に潜り込む事故もこれで防ぐ。
link() { # link <src> <dest>
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if [ -L "$dest" ]; then
    rm -f "$dest"
  elif [ -e "$dest" ]; then
    mv "$dest" "$dest.bak.$(date +%Y%m%d%H%M%S)"
    echo "  backed up existing $dest"
  fi
  ln -s "$src" "$dest"
  echo "  -> $dest"
}

# Homebrew
echo "Installing dependencies via Homebrew..."
if command -v brew >/dev/null 2>&1; then
  if ! brew bundle --file "$DOTFILES_DIR/Brewfile"; then
    echo "  WARNING: brew bundle failed."
    echo "  Raycast を手動インストール済みの場合は次で取り込めます:"
    echo "    brew install --cask --adopt raycast"
  fi
else
  echo "  WARNING: brew not found, skipping. https://brew.sh"
fi

# Ghostty
echo ""
echo "Setting up Ghostty config..."
link "$DOTFILES_DIR/ghostty/config" ~/.config/ghostty/config
link "$DOTFILES_DIR/ghostty/ghostty_image.jpeg" ~/.config/ghostty/ghostty_image.jpeg

# Herdr
# config.toml だけをリンクする。~/.config/herdr/ には herdr.sock / *.log /
# session.json といった実行時状態が同居しているのでディレクトリごと置き換えない。
echo ""
echo "Setting up Herdr config..."
link "$DOTFILES_DIR/herdr/config.toml" ~/.config/herdr/config.toml
if command -v herdr >/dev/null 2>&1 && herdr status server >/dev/null 2>&1; then
  herdr server reload-config >/dev/null && echo "  reloaded running herdr server"
fi

# Raycast 拡張 (herdr-workspaces)
# `ray build` はビルドするだけで Raycast への登録は行わない。登録は
# `ray develop` がビルド後に Raycast 本体と通信して行うため、常駐する
# ウォッチャとして起動しっぱなしにする必要がある(終了すると登録も外れる)。
echo ""
echo "Starting Raycast extension watcher (herdr-workspaces)..."
if [ -d /Applications/Raycast.app ]; then
  (
    cd "$DOTFILES_DIR/raycast/herdr-workspaces"
    npm ci
    pidfile=".ray-develop.pid"
    if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
      echo "  watcher already running (pid $(cat "$pidfile"))"
    else
      nohup npx ray develop >.ray-develop.log 2>&1 &
      echo $! >"$pidfile"
      disown
      echo "  watcher started (pid $!, log: raycast/herdr-workspaces/.ray-develop.log)"
    fi
  )
else
  echo "  WARNING: Raycast.app not found, skipping."
fi

# Wezterm
echo ""
echo "Setting up Wezterm config..."
link "$DOTFILES_DIR/wezterm/wezterm.lua" ~/.config/wezterm/wezterm.lua

# iTerm2
echo ""
echo "Setting up iTerm2 profile..."
echo "  Open iTerm2 -> Preferences -> Profiles -> Other Actions -> Import JSON Profiles"
echo "  Import: $DOTFILES_DIR/iterm/profile.json"

echo ""
echo "Done!"
echo ""
echo "Manual steps:"
echo "  1. Ghostty で cmd+shift+, を押して設定を再読み込みする。"
echo "     これを踏まないと super+t などの unbind が効かず、Ghostty が"
echo "     キーを先に食って Herdr 側のショートカットが動かない。"
echo "  2. Raycast のホットキー / エイリアスは plist と内部 DB 側にあるため"
echo "     このスクリプトでは復元できない。Raycast 上で再設定すること。"
