# ADR-002: オフライン Pyodide Worker と Controller API の技術検証

- **日付**: 2026-10-10
- **状態**: Controller 方式は採用可能。ランタイム最終採用は Issue #4 / Gate A の結果待ち
- **対象 Issue**: #3

## 背景

プレイヤーの Python は Electron Main / Renderer で直接評価せず、専用 Worker 内で実行する必要がある。MVP はネットワーク接続なしで起動でき、同じ Controller インスタンスを判断境界ごとに繰り返し呼び出せなければならない。また、一般的な Python の関数・クラス・再帰・標準ライブラリと、ゲーム内の複数 `.py` ファイルを利用できる必要がある。

本 ADR は判断関数型 Controller の成立性だけを扱う。同期 `while ... wait_ticks()` の継続・中断、無限ループの強制停止、実行予算と安全性の最終判断は Issue #4 の範囲である。

## 決定

1. Pyodide `314.0.7` を完全一致で固定する。
2. npm パッケージ内の次の5ファイルをビルド前に `public/pyodide/` へコピーし、Vite の成果物へ同梱する。
   - `pyodide.mjs`
   - `pyodide.asm.mjs`
   - `pyodide.asm.wasm`
   - `python_stdlib.zip`
   - `pyodide-lock.json`
3. 製品ビルドは `app://bundle/` の標準・secure カスタムスキームから配信する。Worker は同一 origin の `/pyodide/` だけをランタイム取得先として許可し、CDN fallback は持たない。
4. Renderer は専用 module Worker へ `initialize` / `boundary` / `terminate` を送る。全メッセージに `sessionId` と単調増加する `requestId` を付け、Zod で境界検証する。
5. `initialize` でファイルを Pyodide の MEMFS へ書き、`main.py` をコンパイルする。`controller.decide(state)` またはトップレベルの `decide(state)` を一度解決し、同じ callable を後続境界で再利用する。
6. Python の戻り値は `Action`（`move_x`, `move_y`, `target_enemy_id`）として検証し、それ以外のゲーム内部状態は Worker に渡さない。
7. Python 例外は Worker 内で捕捉し、例外名・メッセージ・traceback・最後のユーザーファイル名・行番号を診断 DTO に変換する。例外後も Worker と Controller は次の境界を処理できる。

## 検証結果

### 自動検証

実 Pyodide を Worker ハンドラーへ接続した統合テストで、次を確認した。

- `main.py` から `utils.py` を import できる。
- `math`、関数、クラス、再帰を同時に利用できる。
- 同一 `Controller` インスタンスを 1,001 回呼び出し、呼び出し回数の状態が保持される。
- 各戻り値が `Action` 契約を満たす。
- 1,002 回目に意図的な `RuntimeError` を発生させ、`main.py` の行番号付き診断へ変換できる。
- 例外の次の 1,003 回目を処理でき、Worker 処理系が落ちない。
- 不正メッセージ、別 session、非単調な request ID を拒否する。

### Electron 製品ビルドでの観測

`npm run build` 後、`npm run verify:electron-spike` でビルド済み Electron と実ブラウザ Worker を起動し、外部 URL を使わずに次を観測した。

| 項目 | 観測値 |
|---|---:|
| Pyodide バージョン | 314.0.7 |
| Worker 初期化（Pyodide load + 2ファイル compile） | 2,454–7,838 ms |
| 1,001 境界の往復 | 588–3,344 ms |
| 同梱ランタイム5ファイル | 13,531,207 bytes（約12.9 MiB） |
| 初期 WASM linear memory | 31,457,280 bytes（30 MiB） |

時間は 2026-10-10 の開発機での2回の観測範囲であり、性能保証値ではない。バックグラウンド負荷による差が大きいため、起動中の進捗表示が必要である。WASM linear memory は診断時に Pyodide の非公開 `_module.HEAP8.buffer.byteLength` を読み取った値なので、製品コードの契約には使用しない。Chromium のプロセス working set には Renderer、Worker、V8、GPU 等も含まれるため、この Spike では安定した Pyodide 単独値へ分離できなかった。配布候補機での起動時間とプロセス全体のメモリ測定は Issue #20 で再実施する。

## 手動オフライン確認

依存関係と Electron 実行ファイルを事前に取得した状態で次を行う。

1. `npm run build` を実行する。
2. ネットワークを切断する。
3. `npm run verify:electron-spike` を実行する。
4. `PASS — Pyodide 314.0.7 / 1001 calls / ...` が表示されることを確認する。

検証スクリプトは loopback の Chromium debugging endpoint だけを観測し、Pyodide 資産は `app://bundle/pyodide/` から読み込む。通常画面には検証 UI を出さず、`?python-spike=1` の場合だけ結果パネルを表示する。

## 制約と残存リスク

- Pyodide Worker は OS レベルの完全なサンドボックスではない。Worker 分離だけを安全性の根拠にしない。
- 今回は通常終了する判断関数だけを検証した。無限ループ中は同じ Worker のメッセージ処理が進まないため、強制 terminate と再生成は Issue #4 で検証する。
- Python の時刻・乱数・ネットワーク API の制限、ログ量、実行時間、メモリ上限は未確定である。
- `Action` は Spike 用の既存 DTO を検証している。公開 Python API の最終スキーマと tick 統合は Issue #5 / #11 / #17 で確定する。
- 同梱サイズは Pyodide のコアと標準ライブラリだけの値で、追加パッケージを含まない。

## 参照

- [Pyodide — Using Pyodide in a web worker](https://pyodide.org/en/stable/usage/webworker.html)
- [Pyodide JavaScript API — `loadPyodide`](https://pyodide.org/en/stable/usage/api/js-api.html)
- [Pyodide — Accessing files](https://pyodide.org/en/stable/usage/accessing-files.html)
