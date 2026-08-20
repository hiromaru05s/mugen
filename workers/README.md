# Workers版 — Cloudflare Workers + Durable Objects デプロイ (m3の移植)

m3サーバー(Colyseus/Node常駐プロセス)をCloudflareの**無料プラン**で動く形に移植した版。
ゲームロジック・Bot AI・視界/interest管理・全メッセージ仕様はm3と同一。

## 構成

| ファイル | 役割 |
|---|---|
| `src/room.mjs` | ForestRoom DO = **1試合1インスタンス**。冒頭の`Room`クラスがColyseusのRoom APIを模倣する薄いシムで、その下のゲームロジックはm3のほぼ写し |
| `src/registry.mjs` | Registry DO(シングルトン)= マッチメイキングのポインタ管理 + **RP永続化(DOストレージ=SQLite)** + 戦績ページ(`/stats`, `/players.json`) |
| `src/index.mjs` | Workerエントリ。`/join` `/reconnect`をルームDOへ、他は静的アセットへルーティング |
| `public/` | クライアント(m3/clientのコピー + `net.js`=colyseus.js代替シム)。**Workerと同一オリジンで配信** |
| `config.json` | m3と同じバランスノブ(バンドルに同梱。変更したら再デプロイ) |

m3からの構造変更点:
- 通信: Colyseusプロトコル → 素のWebSocket + JSON `{t: type, d: data}`(`public/net.js`が旧APIを再現するのでクライアントコードはほぼ無変更)
- RP永続化: `data/players.json` → Registry DOのストレージ(起動時読み戻しも解決)。`SUPABASE_URL`/`SUPABASE_KEY`設定時はミラー(任意)
- 戦績ページ: port+1の別サーバー → 同一オリジンの `/stats`
- 再接続: Colyseusのreconnectionトークン → `<ルーム名>.<sessionId>.<secret>` 形式の自前トークン(挙動は同じ: 切断→Bot代行→120秒以内復帰)

## ローカル開発

```bash
cd workers
npm install
npm run dev        # http://localhost:8787 (テスト用チート: npx wrangler dev --var M2_DEV:1)
npm test           # スモークテスト21項目(wrangler devを自動起動して検証・GitHub Actions CIも同じ)
```

## デプロイ(初回)

```bash
cd workers
npx wrangler login   # ブラウザが開く→Cloudflareアカウントで認可
npm run deploy       # https://mugen-no-mori.<アカウント名>.workers.dev に公開
```

以後の更新は `npm run deploy` のみ。ログは `npm run tail`。

## 無料枠の目安(2026-08時点の公式値で試算)

- DO稼働: 13,000 GB-s/日 ≒ 1試合(8分)60 GB-s → **200試合/日以上**
- リクエスト: 10万/日(WS受信20メッセージ=1換算、送信は無料)。クライアントのinput送信は
  「変化時+2秒ハートビート(攻撃中のみ毎tick)」に間引き済みで、実測アイドル0.5回/秒 —
  リクエスト面はほぼ制約にならず、**実質の上限はDO稼働時間の約200試合/日**
- ロビー/リザルト画面はスナップショット4Hz、放置ロビーは15分で自動解散(稼働時間の節約)
- ストレージ: 5GB(RP戦績には事実上無制限)

超えたらWorkers Paid($5/月)へ。

## 招待リンク

ロビーの「🔗 招待リンクをコピー」で `?p=<合言葉>` 付きURLをコピーできる。
開いた友達はパーティ欄が自動入力され、**開くだけで同チーム保証**。

## スマホ対応(タッチ操作)

タッチデバイスを自動検出して(`pointer: coarse`)タッチUIに切り替わる:
- **左下スティック**で移動(16方向量子化=送信削減と両立)
- **⚔ボタン**で攻撃 — 照準は**自動**(520px内の最寄りの可視敵。いなければ向いている方向)
- **スキル/薬は枠をタップ**(自動照準先へ発動)。デスクトップでも枠クリック=カーソル位置へ発動
- **F/Gボタン**は文脈表示(装置解除QTE・蘇生・商人購入・砥石。近くにいる時だけ出る)
- **📍ボタン**で定型ピン(集合/危険/装置/竜)を自分の現在地に送信(デスクトップはZ/X/C/Vのまま)
- **死亡後は観戦モード**: 👁ボタン(デスクトップはTab)で生存者を巡回、観戦対象名をHUD表示
- iOSの音はじめ初回タップでAudioContextを解錠。キーボード/マウス操作はデスクトップでそのまま

## その他のQoL

- 名前・パーティ合言葉・スキンはlocalStorageに記憶され、次回アクセス時に自動入力
- 人間が全員切断した試合はBotだけで8分回さず、再接続窓(120秒)経過後に自動打ち切り(無料枠節約)

## 注意(プロトタイプとしての割り切り)

- 試合状態はDOのメモリ上のみ。**デプロイやDOの再起動で進行中の試合は消える**(RPは永続)
- 全人間プレイヤーが切断した試合は、DOが休止すると再接続(120秒)が保証されないことがある
