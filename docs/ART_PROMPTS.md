# ART_PROMPTS — 画像生成プロンプト全種 v1

運用: **テンプレート×変数表**方式。Codexは各テンプレートに変数表の行を代入して展開・実行する。
生成前に ART_PIPELINE.md の規格(サイズ・シート・ワークフロー)を確認すること。

---

## 0. 共通スタイルアンカー(全プロンプト先頭に必ず付与)

```
STYLE: 32px-grid pixel art, SNES-plus era fidelity, top-down 2D game asset,
dreamlike ancient forest theme, palette of deep mossy greens and violet mist
with bioluminescent cyan and gold accents, soft rim glow on magic elements,
clean 1px dark outline, readable silhouette, transparent background, no text
```

共通ネガティブ(対応モデルのみ):
```
NEGATIVE: photo, 3d render, blurry, anti-aliased gradients, text, watermark,
frame border, cropped, multiple characters, background scenery
```

**運用ルール**
- §1の「基準立ち絵」を最初に確定し、以降の同系統生成は必ずその画像を参照に添付(--sref / image ref / seed固定)
- 高解像度(1024px)で生成 → nearest neighborで規格サイズへ縮小
- 1アセットにつき4バリアント生成→選抜→必要ならドット清書

---

## 1. 基準立ち絵(スタイルアンカー確立用・最優先で5枚)

テンプレート:
```
[STYLE] + full-body pixel art character, {DESC}, facing down (toward viewer),
standing idle pose, 48x48 sprite proportions (chibi 2.5-head ratio, body height
~36px), centered, feet at bottom-center
```

| class | DESC | 優先 |
|---|---|---|
| warrior | stout armored knight with one-hand sword and round shield, mossy green cloak, weathered iron armor with gold trim | ★M1 |
| mage | slender arcane mage in violet hooded robe, holding a gnarled wooden staff with floating cyan runes, mysterious | ★M1 |
| thief | agile hooded rogue in dark leather, twin daggers sheathed, sly posture, faint gold coin pouch glint | ★M1 |
| priest | gentle cleric in ivory-and-gold vestments, holding a glowing lantern-censer, serene warm aura | M3 |
| ranger | lean forest sniper with long recurve bow and quiver, camouflage cloak of leaves, sharp watchful eyes | M3 |

## 2. プレイヤーキャラ スプライトシート

### 2-A. シート直接生成(ピクセルアート特化ツール向け・推奨)
```
[STYLE] + character sprite sheet for top-down 2D game, {CLASS_DESC from §1},
3 directions (down, side, up) x 6 animation states:
idle 4 frames, walk 6 frames, attack 5 frames, cast 4 frames, hit 2 frames,
death 6 frames. Layout: rows = state x direction in order
(idle-down, idle-side, idle-up, walk-down, ...), columns = frames.
48x48 per frame, feet anchored at bottom-center of every frame, consistent
palette and proportions across all frames, transparent background
```

### 2-B. キーフレーム下絵生成(汎用モデル向けフォールバック)
基準立ち絵を参照画像に添付した上で、1枚ずつ:
```
[STYLE] + same character as reference, {POSE}, facing {DIR}, identical palette
and proportions to reference, 48x48 sprite proportions
```
| POSE | 用途 |
|---|---|
| mid-stride walking, left foot forward | walk中割り元 |
| mid-stride walking, legs crossing | walk中割り元 |
| weapon raised overhead, wind-up | attack起点 |
| weapon swung through, follow-through with motion arc | attack終点 |
| arms raised channeling glowing energy | cast |
| flinching backward, eyes shut | hit |
| collapsed on ground, fading | death終点 |
DIR ∈ {down, side, up}。中割り・清書はAsepriteで行う(ART_PIPELINE §4-3-B)。

## 3. モブ(M1は wolf のみ、M2で全種)

テンプレート(シート):
```
[STYLE] + monster sprite sheet, {MOB_DESC}, 3 directions x 4 states
(idle 4, walk 4, attack 4, death 4 frames), {SIZE}x{SIZE} per frame,
rows = state x direction, columns = frames, consistent across frames
```

| mob | MOB_DESC | SIZE | 優先 |
|---|---|---|---|
| wolf | spectral forest wolf with faint violet mist trailing, glowing cyan eyes | 48 | ★M1 |
| sprout | small hostile walking sprout creature, mossy body, snapping leaf jaws | 48 | M2 |
| treant | large ancient treant, bark armor, one glowing hollow eye | 64 | M2 |
| wisp | floating bioluminescent wisp, gentle glow, no legs (hover bob) | 48 | M2 |
| husk | withered-zone corrupted husk beast, desaturated grey-violet, cracked skin with ember glow | 64 | M2 |

## 4. ドラゴン(M2)

本体(256×256, idle 4 / attack 3種×6 / death 8):
```
[STYLE] + colossal ancient forest dragon boss sprite, top-down view, moss and
crystal growths on emerald scales, wings folded, coiled around a glowing
hexagonal seal, bioluminescent gold-cyan chest core, 256x256, menacing but
dreamlike, {STATE}
```
STATE ∈ { idle breathing loop 4 frames / head-sweep flame attack 6 frames /
wing-gust attack 6 frames / tail-slam attack 6 frames / collapsing death 8 frames }

部位(64×64, 各 idle2+破壊4):
```
[STYLE] + dragon body-part sprite for destructible boss segment, {PART},
matching the reference dragon's palette, intact state and shattering sequence
```
PART ∈ { armored head crest / left wing membrane / right wing membrane / crystal-tipped tail }

## 5. タイルセット(M2、各 256×256=8×8タイル)

テンプレート:
```
[STYLE] + seamless top-down tileset sheet, {BAND_DESC}, 32x32 tiles arranged
8x8: ground variants (4), thick grass (2), path/dirt (2), tree trunk base (2),
canopy shadow (2), rock (2), water edge set (9-slice), cliff edge set (9-slice),
hiding bush (2, visually distinct puffy shape), decorative flora (rest),
all edges tileable, consistent lighting from top-left
```

| tileset | BAND_DESC | 優先 |
|---|---|---|
| band0 | bright outer forest, young trees, soft morning light, gentle greens | M2 |
| band1 | mid forest, denser canopy, violet mist creeping, scattered ruins stones | M2 |
| band2 | deep ancient forest, giant roots, heavy mist, bioluminescent mushrooms | M2 |
| core | dragon's lair clearing, cracked stone, glowing hexagonal seal patterns, gold-cyan light | M2 |
| withered | withered corruption zone, desaturated grey-violet, dead trees, ember cracks | M2 |

## 6. プロップ(単品スプライト)

テンプレート:
```
[STYLE] + single game prop sprite, {PROP_DESC}, top-down 2D angle (3/4 view),
{SIZE}, centered, transparent background
```

| prop | PROP_DESC | SIZE | 優先 |
|---|---|---|---|
| chest_common | wooden chest with iron bands, closed + open (2 sprites) | 32×32 | ★M2 |
| chest_rare | ornate gold-violet chest with glowing runes, closed + open | 32×32 | M2 |
| gimmick_seal | ancient mechanism pedestal with rotating hexagonal rune rings, locked + unlocked | 64×64 | M2 |
| trap_thief | subtle leaf-covered snare trap, armed (barely visible) + triggered | 32×32 | ★M1 |
| merchant | hooded merchant NPC at a small stall with hanging lanterns and wares | 64×64 | M2 |
| quest_npc | lost traveler NPC sitting by a dim campfire | 48×48 | M2 |
| shrine | small mossy shrine with offering bowl, faint gold glow | 48×48 | M2 |
| gold_pile | small / medium / large gold coin piles (3 sprites) | 16-32 | M2 |

## 7. スキルアイコン(64×64、M1=3職×4=12枚 → M3で20枚)

テンプレート:
```
[STYLE] + skill icon, {ICON_DESC}, 64x64, bold central symbol readable at 32px,
subtle dark vignette inside a thin gold hexagonal frame, no letters
```

| class | skill | ICON_DESC | 優先 |
|---|---|---|---|
| warrior | slash | sweeping silver sword arc | ★M1 |
| warrior | bash | round shield with radiating impact lines | ★M1 |
| warrior | charge | forward-lunging boot with speed lines | ★M1 |
| warrior | warcry | stylized roaring mouth with sound rings | ★M1 |
| mage | fireball | orb of violet-core flame | ★M1 |
| mage | blink | two afterimage silhouettes with cyan trail | ★M1 |
| mage | slowzone | clock face melting into mist | ★M1 |
| mage | wall | rising translucent arcane barrier | ★M1 |
| thief | stab | dagger with venom drip | ★M1 |
| thief | trap | coiled snare with leaf camouflage | ★M1 |
| thief | detect | eye with radar rings | ★M1 |
| thief | vanish | dissolving hooded silhouette | ★M1 |
| priest | heal / barrier / purify / beacon | (M3で同形式追加) | M3 |
| ranger | snipe / mark / smoke / reposition | (M3で同形式追加) | M3 |

アイテムアイコン(32×32)も同テンプレートで: 剣/盾/杖/短剣/弓(各tier2色替え)、
回復ポーション、マナポーション、鍵、地図片、素材(木の実/鉱片/霧の結晶)。

## 8. ポートレート(256×256、職選択画面・5枚、M3)

```
[STYLE] + large pixel art bust portrait of {CLASS_DESC from §1}, 256x256,
dramatic rim light from bioluminescent forest glow, subtle animated-ready
layered look, dark vignette background, personality forward: {MOOD}
```
MOOD: warrior=fearless grin / mage=calm calculating gaze / thief=smug sideways smirk /
priest=serene warmth / ranger=cold focus

## 9. UI・VFX(生成するもの / しないもの)

**プログラム描画(生成禁止)**: 予兆サークル・扇形視界・HPバー・ダメージ数字・ミニマップ・
リング(枯死域)境界 — データ駆動で色/径を変えるため画像化しない(ART_PIPELINE §5)

生成するVFX(48×48 or 96×96、4〜6フレーム横並び):
```
[STYLE] + VFX sprite strip, {VFX_DESC}, {N} frames left to right, {SIZE} per
frame, transparent background, additive-blend friendly (bright on transparent)
```
| vfx | VFX_DESC | N | SIZE | 優先 |
|---|---|---|---|---|
| slash_arc | crescent sword slash arc dissipating | 4 | 48 | ★M1 |
| fireball_proj | violet-core fireball with trailing sparks | 4 | 48 | ★M1 |
| explosion | violet-gold magical burst | 6 | 96 | ★M1 |
| heal_glow | rising gold motes with soft ring | 6 | 48 | M3 |
| arrow_proj | glowing arrow with cyan tracer | 2 | 48 | M3 |
| stealth_puff | leaf-scatter vanish puff | 4 | 48 | ★M1 |
| levelup | ascending hexagonal gold rings | 6 | 96 | M2 |

UI画像素材(最小限): ボタン3態(normal/hover/pressed, 9-slice 48×48)、
パネル背景(9-slice、暗色すりガラス+金縁)、スキルスロット枠(64×64)。
```
[STYLE] + game UI {ELEMENT}, dark translucent panel with thin gold border and
subtle hexagonal corner motif, 9-slice friendly (uniform edges), no text
```

## 10. ブランディング(M3以降)

ロゴエンブレム(文字はフォントで組む。Cinzel等のセリフ+和文は明朝):
```
[STYLE - pixel constraint relaxed] + game logo emblem, a dark dreamlike forest
forming a circular frame, a dragon silhouette coiled at the center around a
glowing hexagonal seal, violet mist and gold-cyan bioluminescence, elegant
dark fantasy, emblem only, no text, 1024x512
```

キーアート:
```
[STYLE - pixel constraint relaxed] + key art illustration: three small
adventurers (armored warrior, hooded mage, crouching thief) standing at the
misty threshold of an endless ancient forest, colossal dragon eye glowing far
in the depths between trees, violet mist, gold-cyan light beckoning deeper,
sense of greed and dread, space at top for logo
```

---

## 11. 生成順序(Codex実行プラン)
1. §1 基準立ち絵 ×3(warrior/mage/thief) → スタイル確定・以降の参照画像に
2. §2 3職シート(A案ツールで。不可ならB案キーフレーム) + §7 スキルアイコン12枚 + §9 VFX★分
3. §6 trap_thief、§3 wolf → **ここまででM1が動く**
4. M2着手時: §5 タイルセット5種 → §6 残プロップ → §4 ドラゴン
5. M3: §1/§2 priest・ranger追加 → §8 ポートレート → §10 ブランディング

各ステップの成果物は ART_PIPELINE §4-5 のQAチェックリストを通してからコミットする。
