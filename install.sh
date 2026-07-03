#!/bin/bash
set -e

DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"

# Wezterm
echo "Setting up Wezterm config..."
mkdir -p ~/.config/wezterm
ln -sf "$DOTFILES_DIR/wezterm/wezterm.lua" ~/.config/wezterm/wezterm.lua
echo "  -> ~/.config/wezterm/wezterm.lua"

# iTerm2
echo ""
echo "Setting up iTerm2 profile..."
echo "  Open iTerm2 -> Preferences -> Profiles -> Other Actions -> Import JSON Profiles"
echo "  Import: $DOTFILES_DIR/iterm/profile.json"

echo ""
echo "Done!"
