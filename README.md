# dotfiles

Terminal / launcher configurations for macOS.

## Structure

```
dotfile/
├── Brewfile              # ghostty, herdr, raycast, font, node
├── install.sh
├── ghostty/
│   ├── config            # Ghostty config
│   └── ghostty_image.jpeg
├── herdr/
│   └── config.toml       # Herdr config (keybindings, theme)
├── raycast/
│   └── herdr-workspaces/ # Raycast extension source
├── wezterm/
│   └── wezterm.lua       # WezTerm config
└── iterm/
    └── profile.json      # iTerm2 profile (JSON)
```

## Setup

```bash
bash install.sh
```

`brew bundle` でアプリを導入し、各設定をシンボリックリンクし、Raycast 拡張を
ビルドする。何度実行しても安全（既存の実体は `.bak.<timestamp>` へ退避）。

実行後、Ghostty で `cmd+shift+,` を押して設定を再読み込みすること。

## Ghostty

`config` と `ghostty_image.jpeg` を `~/.config/ghostty/` へリンクする。

配色は Ghostty 同梱の `TokyoNight`（ダーク固定）で、Herdr 側の
`theme = "tokyo-night"` と揃えてある。片方だけ変えると Ghostty のペイン内と
Herdr のサイドバーで色味が分かれるので注意。同梱テーマなのでリポジトリに
テーマファイルを持つ必要はなく、`themes/` は置いていない。

`background-image` は相対パス。Ghostty は config ファイルのあるディレクトリを
基準に解決するため、画像を config と同じ階層に置いておけばマシンを問わず動く。

## Herdr

**`config.toml` 単体のリンク。** `~/.config/herdr/` には `herdr.sock` /
`herdr-client.sock` / `herdr-server.log` / `session.json` が同居しているので、
ディレクトリごとリンクすると実行中のセッションが壊れる。

サーバーが起動していれば `install.sh` が `herdr server reload-config` まで実行する。

### キーバインドは Ghostty 側とセット

macOS では `cmd` 系のキーを Ghostty が先に処理するため、Herdr に届かせるには
Ghostty 側で `unbind` する必要がある。**`ghostty/config` の `unbind` を消すと
Herdr のショートカットが無言で死ぬ。**

| キー | Herdr の動作 | Ghostty 側で unbind したもの |
| --- | --- | --- |
| `cmd+b` | prefix | （デフォルト未使用） |
| `cmd+t` | 新規 workspace | `new_tab` |
| `cmd+shift+t` | 新規 tab | `undo` |
| `cmd+opt+←` / `→` | 前 / 次の tab | `goto_split:left` / `right` |
| `cmd+opt+↑` / `↓` | 前 / 次の workspace | （デフォルト未使用） |

`cmd` の転送は Ghostty の kitty keyboard protocol 経由。Herdr は crossterm の
`PushKeyboardEnhancementFlags` でこれを有効化している。

キーバインドを壊して prefix が入力できなくなった場合は `herdr config reset-keys`
でデフォルトへ戻せる。

## Raycast

拡張のソースは `raycast/herdr-workspaces/`。

`ray build` はローカルビルドのみで Raycast への登録は行わない。登録は
`ray develop` がビルド成功時に投げる `raycast://cli/<ext>/build-success`
ディープリンクによって行われるため、`install.sh` は `npm ci` の後に
`ray develop` をバックグラウンドで起動し、ログに "built extension
successfully"(= ディープリンクを投げた直後)が出た時点で kill している。
一度登録されれば develop プロセスを常駐させ続ける必要はない。

**ソースを `~/.config/raycast/extensions/` の下に置かないこと。** あそこは
Raycast 自身のビルド出力先で、ソースを置くと `ray develop` がそこへ書き戻して
`assets/` や `eslint.config.js` を消し、拡張側の `node_modules/react` が
二重ロードされて `Cannot read properties of null (reading 'useRef')` で落ちる。

Raycast 本体の設定（ホットキー、エイリアス、拡張の順序）は plist と内部 DB に
あるため、このリポジトリでは管理できない。移行するなら Raycast の
"Export Settings & Data" を使う。

## iTerm2

iTerm2 does not support symlinks for profiles. Import manually:

1. Open iTerm2
2. Preferences → Profiles → Other Actions → Import JSON Profiles
3. Select `iterm/profile.json`
