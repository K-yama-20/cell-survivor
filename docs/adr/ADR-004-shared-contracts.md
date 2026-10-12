# ADR-004: Python / Simulation共有契約と境界検証

- **Status**: Accepted — Issue #5 / Gate A Go
- **Date**: 2026-10-13
- **Decision owners**: Micro Survivor project
- **Related**: Issue #5、[ADR-002](./ADR-002-pyodide.md)、[ADR-003](./ADR-003-python-continuations.md)、[PYTHON_API.md](../PYTHON_API.md)

## Context

Python Worker、将来のSimulation Worker、Renderer間では、同じゲーム状態とActionをJSONとして転送する。Issue #3〜4のSpikeではWorker実行を優先したため、Observationは任意の辞書、ActionとEnvelopeのスキーマはPython領域に局在し、公開Python型への変換も一部が`SimpleNamespace`だった。このままでは後続Issueが異なる型、ID規則、無効値処理を実装する危険がある。

また、仕様は任意の有限移動ベクトルをSimulation側で正規化すると定める一方、SpikeのActionスキーマは各成分を`[-1, 1]`へ制限していた。この矛盾をGate A完了前に解消する必要があった。

## Decision

### 一つのDTO正本

`src/shared/contracts.ts`をPython / Simulation間のDTO正本にする。ZodスキーマからTypeScript型を推論し、`Vec2DTO`、`EnemyViewDTO`、`ObservationDTO`、`ActionDTO`、Envelope identity、制御モード、yield reason、診断コードを定義する。Python Worker固有のrequest / response unionだけを`src/python/protocol.ts`で組み立てる。

- 数値は有限値を要求し、tick、HP、ID、request IDには整数範囲を定める。
- entity IDとrequest IDは正整数。敵IDは一意かつ昇順。
- `nearest_enemy_id`は距離最小、同距離ならID最小の敵と一致する。
- Envelopeの`boundary.tick`は`ObservationDTO.tick`と一致させる。
- オブジェクトはstrict schemaとし、未知フィールドを黙って受け入れない。

### Python公開型へのコピー

Worker境界で検証済みのObservationDTOを、frozen dataclassの`Vec2`、`EnemyView`、`Observation`へコピーする。`enemies`はタプル、`nearest_enemy`は同じタプル内のEnemyViewまたは`None`である。Controllerの`decide(state)`とManualの`get_state()`は同じObservationオブジェクト表現を受ける。

PythonのAction dataclassまたは互換辞書はJSON化した後、Controller / Manualとも同じ`validateActionDto()`を通る。移動入力は任意の有限値を許可し、長さ1超過の正規化はSimulation側で行う。構造不正、NaN / Infinity、不正ID、Observationに存在しない・死亡済み標的はAction全体を無行動へ置換し、`INVALID_ACTION` warningを正常な境界結果へ添付する。

### Envelopeと診断

全メッセージは`Envelope(sessionId, requestId, type, payload)`で運ぶ。Workerは初期化sessionを固定し、別sessionと単調増加しないrequest IDをprotocol errorとして拒否する。Renderer clientはRestart前の古いsession応答をpayload検証より先に破棄し、現行sessionの壊れた応答はWorkerを停止する。

診断は`kind`、安定した`code`、`severity`、`name`、`message`を必須とする。特に次を機械的に区別できる。

| 状況 | 境界表現 |
|---|---|
| 行動関数の自動待機 | `yieldReason=action`, `resumeTick` |
| 任意の`wait_ticks()` | `yieldReason=wait`, `resumeTick` |
| Controller判断 | `mode=controller`, `yieldReason=decision` |
| 実行予算超過 | `kind=budget`, `code=EXECUTION_BUDGET_EXCEEDED` |
| 無効Action | `kind=validation`, `code=INVALID_ACTION`, `severity=warning` |
| 制御権競合 | `code=CONTROL_MODE_ERROR` |

## Consequences

- Issue #6以降はPython実装へ依存せず共有DTOをimportしてSimulationを構築できる。
- JSON転送、NaN / Infinity、型、ID、順序、session / request、Controller / Manual共通Actionを契約テストで固定できる。
- strict schemaの変更は互換性変更になるため、公開仕様、型、契約テストを同じPRで更新する。
- `target_enemy_id`の生存判定はObservation時点の契約である。Action適用後に敵が死亡した場合の「移動継続・射撃対象のみ喪失」はSimulation側で扱う。
- Zod検証は信頼境界の整合性を保証するが、Pyodideを完全なOSサンドボックスにはしない。ADR-003のwatchdog・権限残存リスクは継続する。

## Gate A conclusion

ADR-002のオフラインPyodide、ADR-003のJSPI継続・予算・watchdog、本ADRのDTO / Envelope契約と異常系テストが揃ったため、Gate Aは**Go**とする。P2の決定論的Simulation Coreへ進める。
