# ゲームサーバー移設 — 手順書

Cloudflare無料プランは韓国からの接続を **LAX(米西海岸)** で処理するため、ping の下限が
往復130ms超になっていた。試合の WebSocket だけをソウル/東京の VM に移すと **10〜40ms** になる。

## 構成(ハイブリッド)

| | 担当 | 置き場所 |
|---|---|---|
| 静的配信・ログイン・戦績DB・ランキング | Cloudflare Workers | 世界中のエッジ(そのまま) |
| **試合(WebSocket)** | **このサーバー** | **ソウル or 東京の VM** |

ゲーム本体は `workers/src/game.mjs` の1つだけで、Workers版(Durable Object)と
Node版(このサーバー)が同じコードを共有する。**ルールが二重管理にならない。**

RP の精算は試合終了時に1回だけ Workers 側へ中継する(`/api/gs/record`)。
往復の遅さはゲーム体験に影響しない。

```
ブラウザ ──HTTPS──> Cloudflare Workers  (ページ・ログイン・戦績)
   │                      ▲
   └──── WSS ────> VM(Caddy → Node) ──┘  (試合。RP精算だけWorkersへ)
```

## 事前に必要なもの

1. **VM** — 以下のいずれか
   - Oracle Cloud Always Free の ARM インスタンス(ソウル `ap-seoul-1` / 東京 `ap-tokyo-1`)。永久無料
   - その他 VPS(月数百円〜)。ソウルか東京リージョンであれば何でもよい
2. **ドメイン名** — ブラウザは HTTPS のページから `ws://` に繋げない(mixed content)ため
   `wss://` が必須で、そのためには証明書＝ドメインが要る。
   独自ドメインが無ければ DuckDNS などの無料サブドメインでもよい。
   **Cloudflare のプロキシ(オレンジ雲)は必ず OFF(DNS only / グレー雲)にすること。**
   ONにすると再び LAX 経由になり、移設の意味が消える。
3. VM のファイアウォールで **80/tcp と 443/tcp** を開けておく(Oracle は
   セキュリティリストとインスタンス内 iptables の両方に穴が要る)

> アカウント作成・課金情報の入力・DNS 設定は本人が行うこと。

## 手順

### 1. 共有秘密を作って Workers に登録する

```bash
openssl rand -hex 32
```

出た値を控えて、Workers 側に登録する:

```bash
cd workers && npx wrangler secret put GAME_SERVER_SECRET
```

### 2. VM 側をセットアップ

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && newgrp docker
git clone <このリポジトリ> mugen-no-mori && cd mugen-no-mori/gameserver
cp .env.example .env && nano .env      # GS_DOMAIN / WORKERS_ORIGIN / GAME_SERVER_SECRET を埋める
docker compose up -d --build
```

### 3. 動作確認(証明書の取得に数十秒かかる)

```bash
curl https://<GS_DOMAIN>/health
# => {"ok":true,"rooms":0,"clients":0}
```

### 4. クライアントの接続先を切り替える

```bash
cd workers
npx wrangler deploy --var GAME_SERVER_WSS:wss://<GS_DOMAIN>
```

または `wrangler.jsonc` の `vars` に `"GAME_SERVER_WSS": "wss://<GS_DOMAIN>"` を足して `npm run deploy`。

これで新規の試合は VM 側で動く。ゲーム内の **PING 表示**で効果を確認できる。

### ロールバック

`GAME_SERVER_WSS` を空にして deploy し直すだけで、即座に Workers(DO)側へ戻る。
クライアントの再配布は不要。

## 運用

```bash
docker compose logs -f game     # ログ
docker compose restart game     # 再起動
docker compose up -d --build    # 更新を反映(進行中の試合は落ちる)
curl https://<GS_DOMAIN>/health # 稼働確認
```

- **試合状態はメモリのみ**。再起動で進行中の試合は消える(RPは永続化済み)。
  これは移設前(Durable Object)と同じ割り切り。
- 空きロビーは15分、人間不在の試合は約2分で自動解散する。
- **上限**: ルーム40 / 同時接続300 / 同一IP 6接続 / 10秒12回まで。超えた接続は拒否され、
  進行中の試合には影響しない。`.env` で変更可能(通常は不要)。
  VMは月額固定なので、接続が殺到しても請求は増えない(重くなるだけ)。

## ローカルでの検証

```bash
# ゲームサーバー単体(22項目: Workers版と同じ挙動か)
cd gameserver && npm install && npm test

# Workers連携込み(10項目: RPがCloudflare側に永続化されるか)
npm run test:integration
```

ブラウザで通しで見る場合は `.claude/launch.json` の `workers-dev-migrated`
(Workers を :8787、ゲームサーバーを :8080 に向けた構成)を使う。
