# ADR-003: 行動自動待機・Python継続実行・実行予算

- **Status**: Accepted — Issue #4 技術Go
- **Date**: 2026-10-10
- **Decision owners**: Micro Survivor project
- **Related**: Issue #4 / Gate A、[ADR-002](./ADR-002-pyodide.md)、[ADR-004](./ADR-004-shared-contracts.md)、[PYTHON_API.md](../PYTHON_API.md)

## Context

プレイヤーには、`async`/`await`や毎回の`wait_ticks(6)`を要求せず、通常の同期Pythonとして次のコードを書ける必要がある。

```python
while True:
    attack_nearest()
```

行動関数はActionを提出した後、Pythonのローカル変数と呼び出しスタックを保持して次の6 tick判断境界まで待つ。状態確認とPython計算はゲーム世界を進めず、決定論的な実行予算だけを消費する。予算内に制御を返さないコードは構文や内容を個別判定せず一律停止し、予算計数で捕捉できない処理には実時間watchdogを最後の保護として使う。

## Decision

### 同期継続

Pyodide 314.0.7のJavaScript Promise Integration（JSPI）を採用する。Workerはユーザープログラムを`runPythonAsync()`から開始し、Pythonの同期APIは`pyodide.ffi.run_sync()`でWorker側Promiseを待つ。

- `act(Action)`と`attack_nearest()`はActionを検証・提出し、次の6 tick境界まで自動待機する。
- `wait_ticks(n)`は`6 * ceil((current_tick + n) / 6)`で求めた境界まで待つ。
- JSPIがWebAssembly/Pythonスタックを退避するため、通常関数、ネストした呼び出し、クラス、ループのローカル状態を保持できる。
- Player Pythonに`async`/`await`を公開しない。
- Controllerが登録済みなら継続側の行動関数は`ControlModeError`とし、監視用継続と`decide()`は1つのWorkerキューで直列化する。

### 決定論的な実行予算

固定したPyodide/CPython上で、プレイヤーファイルに発生するPythonの`call`/`line` trace eventを予算単位とする。初期Spike値は1境界あたり50,000 eventである。

- 状態確認、ループ、関数呼び出し、再帰、generator等は予算を消費する。
- Action提出、`wait_ticks()`、Controller returnの各境界で予算をリセットする。
- 予算超過はすべて`ExecutionBudgetExceeded`へ正規化する。
- AST文字列や`while True: pass`等の特定構文は検査しない。
- 計算中はObservationを固定し、simulation tickを進めない。

CPythonのC実装内で長時間を費やしtrace eventを発生しない処理は、この予算だけでは停止できない。そのためRenderer側の`PythonWorkerClient`が初期値2,000 msの実時間watchdogを持ち、超過時はWorkerを強制終了する。watchdogはゲーム内時間や決定論的予算ではなく、UI/アプリ保護の別レイヤーである。最終閾値はIssue #18の負荷試験で確定する。

### Stop / Restart

`PythonWorkerClient`は実行開始時のファイルsnapshot、ランタイムURL、実行設定をWorker外に保持する。予算超過後またはwatchdogによる強制終了後は、古いWorkerを破棄して新しいsession IDのWorkerを生成し、保存済みsnapshotから再初期化する。Pythonメモリ、継続スタック、tickは引き継がない。

### 攻撃クールダウン

Action提出頻度と発射頻度を分離する。Pythonが6 tickごとに標的を再提出しても、Simulation側の15 tickクールダウンだけが発射可否を決める。Spikeではtick 0〜35に標的を保持した結果、発射tickが`0, 15, 30`になる契約テストを追加した。

## Security boundary

Issue #4で次を確認・強化した。

- Electron Rendererは`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`を維持する。
- Browser permission request/checkはMainで一律拒否する。
- CSPを`connect-src 'self'`に固定し、外部HTTP/WebSocket接続を許可しない。
- 製品版Electron SpikeでPlayer PythonからNode.jsの`require`/`process`が見えないこと、Pyodide MEMFSから`C:/Windows`が見えないこと、外部`fetch`が拒否されることを確認する。
- Pyodideのロード先は同一originの`/pyodide/`に限定する。
- Worker request/responseはZod schema、session ID、単調増加request IDで検証する。

Player PythonはブラウザWorker内の`js` moduleおよび登録済み`microgame_bridge`を技術的には参照できる。bridgeはAction/wait/Controller登録に必要な最小関数だけを公開し、すべての入力を再検証する。ただしWorker/Pyodideを悪意あるコードに対する完全なOSサンドボックスとは扱わない。モジュール許可リスト、時刻・乱数、ログ、メモリ、追加のJS到達経路はIssue #18で再監査する。

## Evidence

2026-10-10の開発機で以下を確認した。

- `act()`のtick 0→6自動再開、`wait_ticks(1)`の0→6、`wait_ticks(7)`の18→30への丸め。
- ネスト関数のローカル変数を複数回のAction/wait後も保持。
- tight loop、深い再帰、generatorによる長時間計算が同じ`ExecutionBudgetExceeded`になる。
- 監視継続とControllerの直列実行、Controller登録後のAction競合拒否。
- watchdogで応答しないWorkerを強制終了し、新Workerへ同じソースsnapshotを再送。
- 製品版Electron: Pyodide 314.0.7、Controller 1,001回、同期継続3境界。最終確認の観測値はload 9,160 ms、1,001境界 6,965 ms。
- 自動テスト10ファイル・19件、lint、typecheck、buildに合格。

検証入口:

```text
npm test
npm run build
npm run verify:electron-spike
```

## Alternatives considered

### AST変換 / generator化

すべての呼び出し元をyield可能に変換する必要があり、import、再帰、例外、クラス、標準ライブラリとの互換性が複雑になるため不採用。

### Player APIをasync/awaitへ変更

実装は単純になるが、初心者の通常Python体験と合意済み同期APIを壊すため不採用。

### `Atomics.wait()`でWorker全体をブロック

Pythonスタックは保持できるが、同じWorkerのメッセージ処理・Controller直列化・診断が難しく、SharedArrayBufferの配布要件も増えるため不採用。

## Consequences

- **Go**: 合意済みの同期Python体験は、現行Electron/Pyodideで実装可能と判断する。Issue #5以降はこの境界契約を前提に進めてよい。
- Electron/ChromiumがJSPIを提供することが配布要件になるため、製品ビルドの継続テストを必須にする。
- trace event予算は同じpin済みランタイム内での決定論を対象とし、Pyodide/CPython更新時は再調整する。
- watchdog超過runは正常完走した決定論的結果として扱わない。
- Issue #18まで、50,000 event / 2,000 msは安全側のSpike初期値であり、最終UX値ではない。

## References

- [Pyodide: JavaScript Promise Integration](https://blog.pyodide.org/posts/jspi/)
- [Pyodide: Interrupting execution](https://pyodide.org/en/stable/usage/keyboard-interrupts.html)
