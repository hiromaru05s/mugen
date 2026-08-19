# ART_PIPELINE — アート規格 v1(画像生成の前に必読)

## 0. アートスタイル決定: 32px基準のピクセルアート(SNES+世代)

理由(変更するなら全部に反論すること):
1. AI生成との相性が最良 — HD手描き調はフレーム間の一貫性が崩壊するが、ピクセルアートは
   低解像度が「揺れ」を吸収する
2. トップダウン2D・大量アセット・少人数開発の工数現実
3. 「夢幻」の幻想性はパレットと発光表現で出す(スタイルの制約と矛盾しない)

**パレット方針**: 深緑〜苔色の森 / 紫がかった霧・夢幻要素 / 生物発光のシアン・金のアクセント /
枯死域は彩度を抜いた灰紫。1タイルセットあたり32色以内を目安。

## 1. サイズ規格(px)

| アセット | キャンバス | 実体サイズ目安 | 備考 |
|---|---|---|---|
| 地形タイル | 32×32 | — | タイルシートは 256×256(8×8タイル)単位 |
| プレイヤーキャラ | **48×48/フレーム** | 身長32〜40px | 足元中央を原点(24,44) |
| 小型モブ | 48×48 | 24〜32px | |
| 大型モブ | 64×64 | 48〜56px | |
| ドラゴン | 256×256(本体)+部位64×64×4 | — | 部位=頭・両翼・尾(別スプライト) |
| スキルアイコン | 64×64 | — | 表示は32px、Retina用に2x |
| アイテムアイコン | 32×32 | — | |
| ポートレート(職選択) | 256×256 | — | ピクセルアート大判 |
| VFX | 48×48 or 96×96 | — | 予兆円・HPバーは**プログラム描画**(生成しない) |
| ロゴ | 1024×512 | — | 唯一の非ピクセル(ベクター調可) |

## 2. アニメーション仕様

### 方向: 3方向+反転(down / side / up、side左右はコード反転)
生成・作画するのは3方向のみ。8方向は作らない(MVP判断)。

### 状態とフレーム数(プレイヤー全職共通)
| 状態 | フレーム数 | fps | ループ |
|---|---|---|---|
| idle | 4 | 6 | ○ |
| walk | 6 | 10 | ○ |
| attack | 5 | 12 | × |
| cast(詠唱/スキル) | 4 | 10 | × |
| hit(被弾) | 2 | 10 | × |
| death | 6 | 8 | × |

モブは idle 4 / walk 4 / attack 4 / death 4 に簡略化。
ドラゴンは idle 4 / attack×3種 各6 / 部位破壊 4 / death 8。

### スプライトシートレイアウト(厳守)
- 1職業=1シート。**行=状態×方向、列=フレーム**
- 行順: idle-down, idle-side, idle-up, walk-down, walk-side, walk-up, attack-down, ... death-up
- プレイヤーシート寸法: 48×6列 = 288px幅、48×18行 = 864px高
- 余白なし、透過PNG、フレーム間の位置ブレ禁止(足元原点固定)

## 3. 命名規則
```
art/characters/char_{class}_sheet.png        # class: warrior|mage|priest|ranger|thief
art/characters/char_{class}_sheet.json       # Phaserアトラス定義(自動生成)
art/mobs/mob_{name}_sheet.png                # 例: mob_wolf_sheet.png
art/dragon/dragon_body_sheet.png / dragon_part_{head|wing_l|wing_r|tail}.png
art/tiles/tileset_band{0|1|2}.png / tileset_core.png / tileset_withered.png
art/props/prop_{name}.png                    # 例: prop_chest_rare.png
art/icons/skill_{class}_{skillid}.png / item_{itemid}.png
art/portraits/portrait_{class}.png
art/branding/logo.png / keyart.png
```

## 4. AI生成の運用手順(Codex実行フロー)

**重要な現実**: 汎用画像生成モデルは「一貫したスプライトシート」を一発では作れない。
以下のワークフローで運用する。

1. **スタイルアンカーを最初に確定**: ART_PROMPTS.md §1 で各職1枚の「基準立ち絵」を生成
   → 以降すべての生成でその画像を参照(image reference / --sref / seed固定)に使う
2. **生成解像度は高く、最後に縮小**: 「32px pixel art style」を高解像度(1024px)で生成し、
   nearest neighbor で目標サイズへ縮小するのが最も安定(直接小サイズ生成は崩れる)
3. **アニメーションは2択**:
   - A案(推奨): ピクセルアート特化ツール(PixelLab / Retro Diffusion 等、スプライトシート
     生成対応のもの)にART_PROMPTS.mdのプロンプトを投入 → シート直接生成
   - B案: 汎用モデルでキーフレーム(idle1枚, walk接地/交差の2枚, attack振り上げ/振り抜きの2枚)
     を参照付きで生成 → 中割りとドット清書は手動/Aseprite。※フレーム完全一貫は汎用モデルでは
     保証されないため、B案は「下絵生成」と割り切る
4. **タイルはシームレス指定**を必ず入れ、生成後にオフセット確認(§ART_PROMPTS 5)
5. **QAチェックリスト**(取り込み前に全項目):
   - [ ] 透過PNG / 余白規格通り / 足元原点ズレなし
   - [ ] 縮小後に輪郭が潰れていない(1pxアウトライン維持)
   - [ ] パレットが基準立ち絵から逸脱していない
   - [ ] シートの行列順がレイアウト仕様と一致
   - [ ] タイルの四辺シームレス確認

## 5. Phaser取り込み
- キャラ: `this.load.spritesheet(key, path, { frameWidth: 48, frameHeight: 48 })`
- アニメ定義は `docs/anim_manifest.json`(状態×方向→フレーム範囲)から自動登録するローダを書く
- タイル: Tiled(.tmj)で編集、`load.tilemapTiledJSON`
- 予兆サークル・HPバー・ダメージ数字・ミニマップは **Graphics/BitmapTextでプログラム描画**。
  画像アセット化しない(色・サイズをデータ駆動で変えるため)
