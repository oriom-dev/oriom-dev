---
title: Mosimo Protocol
date: 2026-10-18
kind: hackathon
team: Team JISAKU
role: [プロトコル設計, 組込, バックエンド]
tech: [TypeScript, Nix, C++, AT Protocol, Nostr, ESP32]
summary: いつものアプリが、もしもの通信網になる。災害時に端末から端末へ署名付きの投稿を中継する共通プロトコル。
awards:
  - { date: 2026-10-18, name: "JPHACKS 2026 Hack Day 仙台 Audience Award" }
  - { date: 2026-10-18, name: "三菱重工業 航空機・飛昇体事業部賞" }
  - { date: 2026-11-15, name: "JPHACKS 2026 Award Day Best Audience Award" }
  - { date: 2026-11-15, name: "Bluesky PBC 賞 / HUAWEI JAPAN 賞 / SoftBank 賞" }
links:
  - { label: サイト, url: "https://mosimo.jisaku.dev/" }
  - { label: タイムライン, url: "https://mosimo.oriom.dev/" }
  - { label: GitHub, url: "https://github.com/jphacks/sd_2607" }
  - { label: デモ動画, url: "https://www.youtube.com/watch?v=piaNsc6ilBI" }
image: https://mosimo.jisaku.dev/images/mosimo-protocol.png
stat: mosimo
---

災害で基地局が止まっても、スマートフォンどうしが Bluetooth と Wi-Fi で投稿を **store / carry / forward** し、署名を保ったまま届ける仕組みです。
AT Protocol と Nostr の両方に載るので、既存のアプリが対応するだけで「もしもの通信網」の一部になれます。

構成は Android アプリ、ESP32 / M5Stack の中継ノード、PDS 兼 Nostr リレー、AppView（HappyView）、Web クライアント、Rust / Tauri のシミュレーターです。
私はプロトコル設計、組込の中継ノード、そして [自前の VPS](/stats) で動いているサーバー群を担当しました。
