# dotfiles

Terminal emulator configurations.

## Structure

```
dotfiles/
├── wezterm/
│   └── wezterm.lua       # WezTerm config
└── iterm/
    └── profile.json      # iTerm2 profile (JSON)
```

## Setup

```bash
bash install.sh
```

### WezTerm

Symlinks `wezterm/wezterm.lua` to `~/.config/wezterm/wezterm.lua`.

### iTerm2

iTerm2 does not support symlinks for profiles. Import manually:

1. Open iTerm2
2. Preferences → Profiles → Other Actions → Import JSON Profiles
3. Select `iterm/profile.json`
