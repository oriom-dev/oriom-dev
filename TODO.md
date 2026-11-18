# TODO

oriom.dev の作業メモ。README はプロフィール用なので、進捗はここで管理する。

## 済

- [x] Markdown からのビルド（ページごとの `.md` 版、512 KB・1 リクエストの自動検査）
- [x] 全色相で検証した OKLCH の単色パレット（毎回ランダムな色相）
- [x] 2D（年ごとの列に実績・記事・バッジのカード）と 3D（ノイズ生成のブロックの世界・WebGPU / WebGL 2）
- [x] 各ページは 2D / 3D の上に 1D の体裁のポップアップで開く（URL は変わるが遷移しない）
- [x] 3D で実績・記事の URL を直接開くと、その看板の前でポップアップが開いた状態で始まる
- [x] 3D の看板は同心円の弧に自動配置（増えたら外側の輪へ）
- [x] 線画（輪郭に当てはめたベジェ曲線と角丸図形、全 13 点で 7.8KB）
- [x] サーバー：HTTP/0.9（caddy-l4）〜HTTP/3、CoAP、Gopher、Gemini、ライブ統計、訪問カウンター
- [x] Service Worker / PWA（オフラインでも同じ合成）
- [x] standard.site（公開ツール、Team JISAKU など仲間の記事の取り込みと所有証明の検証）
- [x] Bluesky の返信をコメント欄に
- [x] Open Badges（表示のみ。トップの #badges）
- [x] Nix パッケージ・NixOS モジュール、podman-cluster-config の `oriom-dev-site` ブランチ
- [x] 国高祭（2021 年度）の実績

- [x] 3D の看板の重なり・読みやすさを第三者（サブエージェント）が 4 回確認し、指摘をすべて修正
- [x] 3D：所属の看板、時系列の看板と年の札、ステータスバーと方角、WASD でマウス操作、月の満ち欠け
- [x] 実名をリポジトリと履歴から除去（push 前に書き換え済み）

## 待ち（判断が必要）

- [ ] 公開：GitHub への push、クラスタのデプロイ、Cloudflare の DNS（プロキシはオフ）
- [ ] standard.site への初回公開：`ATP_APP_PASSWORD=… node tools/publish.ts`（全体の完成後）
- [ ] Open Badges の受領者の証明（検証機能はいったん外した）

## いつか

- [ ] 3D のランプが点灯した状態の確認（本番のクラスタのデータが必要）

## 開発メモ

```sh
nix develop                      # Node.js 24、線画用の Python、libcoap
npm run dev                      # ビルドして http://127.0.0.1:8080 で起動（dist の変更で読み直し）
npm test                         # 512 KB・1 リクエスト・配置・各プロトコルなど
```

- 3D で記事が増えたときの並び：`/?v=3d&debug&fake=30`（今日から 1 か月ずつさかのぼる仮の記事を 30 件足す）
- 3D の別の時刻の空：`/?v=3d&debug&at=2026-11-24T23:00`
- クラスタのメーターとランプ：`node tools/fake-agent.ts /tmp/agent.sock &` のあと `CLUSTER_AGENT_SOCKET=/tmp/agent.sock npm run dev`
- 線画：`nix develop -c python3 tools/lineart.py [slug]`、一覧は `node tools/artpreview.ts > sheet.svg`
