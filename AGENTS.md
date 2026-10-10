# AGENTS.md

この指示はリポジトリ全体に適用します。

## 1. 正本と優先順位

変更前に対象領域の仕様を読み、実装と同じPull Requestで必要な文書を更新してください。

1. 合意済みのプロダクト方針と `docs/PRODUCT.md`
2. `docs/GAME_DESIGN.md`
3. `docs/PYTHON_API.md`
4. `docs/ARCHITECTURE.md`
5. `docs/ROADMAP.md` と対象GitHub Issue

仕様と実装が衝突した場合、暗黙に要件を縮小・変更しないでください。IssueまたはADRに選択肢・影響・検証結果を記録し、合意を得ます。

## 2. 非交渉事項

- ゲームの面白さを最優先にし、Python文法クイズや特定構文をクリア条件にしない。
- 全面Phaserキャンバスの上にReact製の仮想フローティングエディタを重ね、左右固定分割にしない。
- 判断関数型 `set_ai(controller)` と同期の継続実行型を両立させる。継続型の行動関数はActionを提出して次の6 tick判断境界まで自動休止し、`wait_ticks(n)`は任意の追加待機に使う。
- シミュレーションは純TypeScript、固定30 tick/秒、AI境界6 tick、1ステージ1,800 tick、固定seedで決定論的にする。攻撃頻度はPython呼び出し回数でなくゲーム側クールダウンで決める。
- 状態確認とPython計算は固定Observation上で決定論的な実行予算を消費し、シミュレーションtickを進めない。制御を返す前に予算を超えたコードは内容を問わず一律停止する。
- Pythonは読み取り専用ObservationとActionだけを通じてゲームへ影響する。
- ElectronのRendererへNode.js権限を露出せず、限定されたpreload IPCだけを使う。
- MVPはWindows 64-bitでオフライン動作し、Stop/Restart後もユーザーコードを保持する。

## 3. モジュール境界

- `src/game/simulation`: React、Phaser、Electron、実時間に依存しない純粋な状態遷移。
- `src/game/rendering`: 読み取り専用スナップショットを表示し、描画結果をゲーム状態へ戻さない。
- `src/python` と `src/workers`: Pyodide、プレイヤーAPI、Worker通信。ゲーム本体と分離する。
- `src/session`: tick barrier、sessionId、Run/Pause/Stop/Restartの調停。
- `src/editor` / `src/ui`: ワークスペースと表示。UI操作はシミュレーション結果を変えない。
- `electron`: Main/Preloadとローカル永続化。Rendererから任意パスを受け取らない。
- `src/shared`: DTO、スキーマ、定数。境界で必ず入力を検証する。

依存方向はドメイン側からUIやElectronへ向けないでください。

## 4. 実装ルール

- TypeScriptのstrict設定を維持し、`any`の導入は理由を明記する。
- `Date.now()`、`Math.random()`、描画FPS、カメラ状態をシミュレーションへ入力しない。
- Entity処理、衝突、同距離の候補は安定したID順で解決する。
- Workerメッセージには `sessionId` と単調増加する `requestId` を持たせ、境界で検証する。
- ユーザーPythonをMain/Rendererで直接評価しない。Pyodide Workerも完全なOSサンドボックスとは主張しない。
- 公開Python APIを変える場合、`docs/PYTHON_API.md`、型、契約テスト、サンプルを同時更新する。
- UI変更では、エディタフォーカスとゲーム入力の衝突、画面外ウィンドウの復旧、コード保持を確認する。
- 依存追加時は目的、配布サイズ、オフライン同梱、安全性への影響をPRへ記載する。

## 5. テストとDefinition of Done

対象Issue固有の受け入れ条件に加え、原則として次をすべて通します。

```text
npm run lint
npm run typecheck
npm test
npm run build
```

- 挙動追加には自動テストを付ける。困難な場合は理由と手動手順を残す。
- シミュレーション変更には固定seed・固定Action列の再現性テストを付ける。
- UI変更にはスクリーンショットまたは動画と操作確認を付ける。
- 安全性に関わる変更は、権限、停止、異常系、データ保持をレビューする。
- 実行していない確認を「合格」と記載しない。

## 6. GitHub運用

- 基本は1 Issue = 1 feature branch = 1 Pull Request。
- PR本文に `Closes #<番号>`、変更概要、実行テスト、残存リスク、必要な画像を含める。
- コミットは1目的に絞り、生成物・`node_modules`・個人のセーブデータ・ログを含めない。
- Gate AがGoになる前にP2以降の大規模実装を進めない。
