# TODO

oriom.dev の作業メモ。README はプロフィール用なので、進捗はここで管理する。

## 済

- [x] Markdown からのビルド（ページごとの `.md` 版、512 KB・1 リクエストの自動検査）
- [x] 全色相で検証した OKLCH の単色パレット（毎回ランダムな色相）
- [x] 2D（実績の DAG を自由スクロール）と 3D（ノイズ生成のブロックの世界・WebGPU / WebGL 2）
- [x] 各ページは 2D / 3D の上に 1D の体裁のポップアップで開く（URL は変わるが遷移しない）
- [x] 3D で実績・記事の URL を直接開くと、その看板の前でポップアップが開いた状態で始まる
- [x] 3D の看板は同心円の弧に自動配置（増えたら外側の輪へ）
- [x] 線画（ロゴの輪郭と数式の図案、なめらかな複数の線）
- [x] サーバー：HTTP/0.9（caddy-l4）〜HTTP/3、CoAP、Gopher、Gemini、ライブ統計、訪問カウンター
- [x] Service Worker / PWA（オフラインでも同じ合成）
- [x] standard.site（公開ツール、Team JISAKU など仲間の記事の取り込みと所有証明の検証）
- [x] Bluesky の返信をコメント欄に
- [x] Open Badges（発行元での再検証、ブラウザ内でのメールアドレス照合）
- [x] Nix パッケージ・NixOS モジュール、podman-cluster-config の `oriom-dev-site` ブランチ
- [x] 国高祭（2021 年度）の実績

## 進行中

- [ ] 3D の看板の重なり・読みやすさの第三者チェックと修正
- [ ] 実名を履歴から除去（push 前に履歴を書き換える）

## 待ち（判断が必要）

- [ ] 公開：GitHub への push、クラスタのデプロイ、Cloudflare の DNS（プロキシはオフ）
- [ ] standard.site への初回公開：`ATP_APP_PASSWORD=… node tools/publish.ts`（全体の完成後）
- [ ] Open Badges の受領者の証明方法（メールアドレスを公開するかどうか）

## いつか

- [ ] キリ番風の訪問カウンター表示
- [ ] 3D の記事の看板に、記事が増えたときの掲示板エリア
