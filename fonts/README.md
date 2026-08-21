# Bundled reading fonts

Each font lives in its own folder **with its license file**, the same layout as the shiju project. Faces load only when selected in the Aa panel; a missing file falls back to the system stack without breaking anything.

| Folder | Font | License | Shipped in repo |
|---|---|---|---|
| `huiwen-mincho/` | 汇文明朝体 (Huiwen Mincho) | 免费商用（见 授权说明.txt，来源：猫啃网 maoken.com） | Yes |
| `zhuque-fangsong/` | 朱雀仿宋 (Zhuque Fangsong) | SIL OFL 1.1（见 LICENSE.txt） | Yes |
| `im-fell-english/` | IM Fell English | SIL OFL（见 OFL.txt） | Yes |
| `special-elite/` | Special Elite | Apache 2.0（见 LICENSE.txt） | Yes |
| `kinghwa-oldsong/` | 京華老宋体 (KingHwa OldSong) | 免费商用（见 授权说明.txt） | **No — local only** |

## 京華老宋体（本地可选）

The 32 MB face is too heavy to ship in the repository, so only its folder and license note are committed. To enable it locally, download 京華老宋体 (e.g. from 猫啃网), and place the font file at:

```text
fonts/kinghwa-oldsong/kinghwa-oldsong.ttf
```

`.gitignore` keeps the binary out of commits. Without the file, the 京華老宋 option simply renders with the system serif stack.

## Adding another font

1. Create `fonts/<kebab-name>/` with the font file **and its license file**.
2. Add an `@font-face` rule in `styles.css` (set `font-display:swap`).
3. Add a key to `FONT_FAMILIES` in `src/core/reader-parity.js`, with system fallbacks after the new face.
4. Add an `<option>` in the `fontFamily` select in `index.html`.

Only fonts whose licenses allow redistribution may be committed; anything else follows the kinghwa-oldsong local-only pattern.
