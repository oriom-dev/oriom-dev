<div align="center">

# oriom

**Web・モバイル・バックエンド・クラウド・セキュリティ、ときどき量子アニーリング**

東北大学 工学部 電気情報物理工学科 4 年 · 微小光学研究室 · [一般社団法人とんペディア](https://org.tompedia.jp/) 理事 · [Team JISAKU](https://jisaku.dev)

[![oriom.dev](https://img.shields.io/badge/oriom.dev-portfolio-000?style=flat-square)](https://oriom.dev)
[![Bluesky](https://img.shields.io/badge/Bluesky-@oriom.dev-0285FF?style=flat-square&logo=bluesky&logoColor=white)](https://bsky.app/profile/oriom.dev)
[![Team JISAKU](https://img.shields.io/badge/Team-JISAKU-555?style=flat-square)](https://jisaku.dev/)

</div>

> [!NOTE]
> このページは [oriom.dev](https://oriom.dev) と同じ内容を GitHub 向けにまとめたものです。サイトはアクセスするたびに **1 次元・2 次元・3 次元** のどれかのデザインで表示されます。末尾に `.md` を付けると Markdown 版を読めます。

## 🏆 実績

| | プロジェクト | 担当 | 技術 |
|---|---|---|---|
| 📡 | **[Mosimo Protocol](https://mosimo.jisaku.dev/)**<br><sub>JPHACKS 2026 Best Audience Award ほか 7 賞</sub> | プロトコル設計・組込・バックエンド | TypeScript · Nix · C++ · AT Protocol · Nostr |
| 🐷 | **[とんペディア](https://info.tompedia.jp/)**<br><sub>東北大生のための非公式アプリ</sub> | 開発リーダー・立ち上げ・設計・アプリ・バックエンド | Flutter · Next.js · Supabase · Cloudflare |
| 🧊 | **[Kytos Orchestration](https://altema.is.tohoku.ac.jp/q_universe/apps/158/)**<br><sub>Quantum Infinity for You 表彰</sub> | 設計・バックエンド・SA | Nuxt · Cloudflare · 量子アニーリング |
| ⛰️ | **[Q-Sherpa](https://altema.is.tohoku.ac.jp/q_universe/apps/156/)**<br><sub>Quantum Infinity for You 表彰</sub> | バックエンド・SA・ホスティング | Next.js · Cloudflare |
| 🎓 | **[Labo-Match](https://altema.is.tohoku.ac.jp/q_universe/apps/159/)**<br><sub>Quantum Infinity for You 表彰</sub> | ホスティング | Cloudflare |
| 💊 | **[IFG Pathleader](https://play.google.com/store/apps/details?id=jp.ifg.pathleader)** | シリアル通信・CI/CD・リリース | Kotlin · Ruby |
| 🔳 | **[QR GENERATOR.](https://qr.oriom.dev/)** | フロントエンド | Vue.js |
| ⚖️ | **[ドイツ相続法情報室](https://erb.tchiba.info/)** | Web サイト開発 | Astro · Netlify |
| 🏢 | **[株式会社リンクエム](https://www.linkm0403.com/)** | リファクタリング・ホスティング | Astro · Cloudflare |
| 🔍 | **[LENS](https://github.com/Lens-expand-your-horizons/LENS)**<br><sub>東北大学ビジネスアイデアコンテスト enspace 賞</sub> | 設計・Web アプリ・バックエンド | Nuxt · AWS Lambda |

<details>
<summary><b>🗓️ 年表</b></summary>

```mermaid
timeline
    2023 : LENS（enspace 賞）
         : とんペディア 発足
    2024 : とんペディア Web 版
         : ドイツ相続法情報室
    2025 : とんペディア iOS / Android
         : 一般社団法人とんペディア 設立
         : Kytos / Q-Sherpa / Labo-Match（Quantum Infinity for You）
    2026 : IFG Pathleader
         : QR GENERATOR.
         : Mosimo Protocol（JPHACKS 2026）
```

</details>

## 🛠️ 技術

<p>
<img alt="TypeScript" src="https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white">
<img alt="Rust" src="https://img.shields.io/badge/-Rust-000?style=flat-square&logo=rust&logoColor=white">
<img alt="Dart" src="https://img.shields.io/badge/-Flutter-02569B?style=flat-square&logo=flutter&logoColor=white">
<img alt="Kotlin" src="https://img.shields.io/badge/-Kotlin-7F52FF?style=flat-square&logo=kotlin&logoColor=white">
<img alt="Vue.js" src="https://img.shields.io/badge/-Vue.js-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white">
<img alt="Svelte" src="https://img.shields.io/badge/-Svelte-FF3E00?style=flat-square&logo=svelte&logoColor=white">
<img alt="Nix" src="https://img.shields.io/badge/-Nix-5277C3?style=flat-square&logo=nixos&logoColor=white">
<img alt="Cloudflare" src="https://img.shields.io/badge/-Cloudflare-F38020?style=flat-square&logo=cloudflare&logoColor=white">
<img alt="PostgreSQL" src="https://img.shields.io/badge/-PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white">
<img alt="Bluesky" src="https://img.shields.io/badge/-AT_Protocol-0285FF?style=flat-square&logo=bluesky&logoColor=white">
</p>

## 🌐 oriom.dev の作り

```mermaid
flowchart LR
    md[content/*.md] --> build[build: テンプレート + ページ]
    build --> server[Node.js サーバー]
    server -->|HTTP/1.0–3| caddy[Caddy]
    server -->|HTTP/0.9| l4[caddy-l4]
    server -->|CoAP| udp[(UDP 5683)]
    build --> sw[Service Worker]
    sw -.->|オフラインでも同じ合成| browser((ブラウザ))
    caddy --> browser
    posts[記事] -->|site.standard.document| pds[(AT Protocol PDS)]
```

- **1 リクエスト・512 KB 以内**：どのページ、どのデザインも、画像やスクリプトを含めて HTML 1 枚に収まります（テストで常に検査）。
- **毎回違う色**：OKLCH の明度と彩度を全色相で検証済みの値に固定し、色相だけをランダムにしています。どの色でも文字のコントラストは 7:1 以上です。
- **standard.site**：記事は AT Protocol のレコードとしても公開し、Team JISAKU の記事もこのサイトから読めます。

### 進捗

- [x] コンテンツのパイプライン（Markdown → テンプレート × ページ、`.md` 版）
- [x] 全色相で検証した OKLCH パレット
- [x] 512 KB・1 リクエストの自動検査
- [x] 1 次元デザイン（一筆書きのベジェ曲線）
- [x] 2 次元デザイン（技術の DAG を自由スクロール）
- [ ] 3 次元デザイン（ノイズ生成のボクセル世界・WebGPU / WebGL 2）
- [x] サーバー（HTTP/0.9–3、CoAP、ランダム配信、ライブ統計）
- [x] Service Worker / PWA（完全オフライン）
- [ ] standard.site への公開とチーム記事の集約
- [ ] Open Badges の検証
- [ ] VPS へのデプロイ

---

<div align="center"><sub>この README は <a href="https://github.com/oriom-dev/oriom-dev">oriom-dev/oriom-dev</a> のサイトのソースと一緒に管理しています。</sub></div>
