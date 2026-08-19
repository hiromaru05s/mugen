# M3 — ロビー + Bot補充 + RP永続化 (SPEC §6 M3 / 身内テスト準備)

「**身内3人で成立する**」を実装で担保する版: 何人で来ても開始時にサーバーサイドBotが
埋めて常に3v3。RPは名前に紐づいて累積される。

## 動かし方(要 Node 18+)
```bash
cd m3/server
npm install
node index.js        # ws://localhost:2570
```
`m3/client/index.html` を開く → 名前+職を選ぶ → 待機ロビー → 「マッチ開始」で不足分をBotが補充。
友達と遊ぶ: 同じWi-Fiなら `index.html#ws://<ホストのIP>:2570` で参加。

## 追加要素
- **待機ロビー**: 参加者ロースター表示。誰かが開始を押すとBot補充→3v3で開戦、以後参加ロック
- **Bot AI**(プロトタイプaiThinkの移植): 予兆回避最優先 / 視界ルール準拠の索敵(ブッシュ・煙幕・壁LoSに正直) /
  職別スキル運用(僧侶=回復優先、遠距離=カイト+狙撃、盗賊=装置解除チャネル) / リーダー追従+時間で深部へ /
  枯死域からの脱出 / ポーション自己使用。移動は`u.input`に書くだけなので人間と完全に同じ経路でシミュレートされる
- **RP永続化**: 試合結果を `server/data/players.json` に累積(rp/matches/wins)。リザルトに累計表示。
  `SUPABASE_URL`+`SUPABASE_KEY` を設定すると同じデータをSupabase RESTへupsert(テーブル: players(name pk, rp, matches, wins))

## 統合テスト済み
1人(ヒロマル/ranger)で参加→ロビー→開始でBot5体補充(僧侶/魔法/遠距離/盗賊/近接) /
Botが自律移動・宝箱回収 / 竜討伐 → result受信 / players.jsonに「ヒロマル: 1000RP 1戦1勝」永続化 — 全パス。

## 残り(M3完了までのユーザー作業)
1. Supabaseプロジェクト作成 → playersテーブル → 環境変数2つ設定(コードは対応済み)
2. サーバーのホスティング(Colyseus Cloud / fly.io / 任意のVPS。`PORT`環境変数対応済み)
3. クライアントの静的配信(GitHub Pages / itch.io) — `#ws://<サーバー>` で接続先指定可能
