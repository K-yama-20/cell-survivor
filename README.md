# Micro Survivor（仮題）

Pythonでスライムの行動をプログラミングし、四方から迫る細菌の群れを60秒生き延びる、コード駆動型2Dオートサバイバルゲームです。

ゲームとしての面白さを最優先にしながら、Python未経験者は動くサンプルの改造から始められ、経験者は関数・クラス・独自アルゴリズム・複数ファイルを使って戦略を深められることを目指します。

## 開発状況

現在はMVPの初期基盤です。実装は [ROADMAP.md](docs/ROADMAP.md) の20 Issueで進めます。最初の重要な判断ゲートは、Pyodideで2種類のPython実行方式と安全な停止を実証することです。

## 正本となる仕様

- [PRODUCT.md](docs/PRODUCT.md): プロダクトの目的・対象・MVP範囲
- [GAME_DESIGN.md](docs/GAME_DESIGN.md): ゲームルール・数値・決定論
- [ARCHITECTURE.md](docs/ARCHITECTURE.md): 技術構成・実行境界・セキュリティ
- [PYTHON_API.md](docs/PYTHON_API.md): プレイヤー向けPython API
- [ROADMAP.md](docs/ROADMAP.md): 20 Issueと完了条件

仕様の優先順位は、合意済みプロダクト方針 → GAME_DESIGN → PYTHON_API → ARCHITECTURE → ROADMAPです。

## 技術スタック（第一候補）

- Electron + Vite + React + TypeScript
- Phaser（2Dゲーム表示）
- Monaco Editor（ゲーム内コード編集）
- Pyodide + Web Worker（ローカルPython実行、技術Spikeで最終判断）
- Vitest（テスト）

Windows 64-bit向けのオフラインデスクトップMVPを最初の対象にします。

## セットアップ

Node.js 22以上を推奨します。

```powershell
npm ci
npm run dev
```

## 品質チェック

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

## 現在の最小画面

初期基盤では、全面のPhaserキャンバス上にReactのHUDと仮エディタを重ねます。ここからロードマップ順に、Pythonランタイム、決定論的シミュレーション、Monaco、フローティングウィンドウ、配布ビルドを追加します。

## コントリビューション

[AGENTS.md](AGENTS.md) と [CONTRIBUTING.md](CONTRIBUTING.md) を確認し、対応するIssueの受け入れ条件を満たす小さなPull Requestを作成してください。
