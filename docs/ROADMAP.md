# ROADMAP.md — Micro Survivor（仮題）MVP開発ロードマップ

> **文書バージョン**: v0.1 / 2026-10-09  
> **用途**: GitHub Issueへの分割・依存管理・Codexへの実装委任・受け入れ確認  
> **対象**: Windows 64-bit / Steam販売を見据えたオフライン・デスクトップMVP  
> **ステータス**: **実装計画案**。ここに記す20件はGitHubへは未登録。Issue番号 `#01`～`#20`は仮の通し番号であり、実際のGitHub Issue番号とは別。
>
> **参照仕様**: [PRODUCT.md](./PRODUCT.md) / [GAME_DESIGN.md](./GAME_DESIGN.md) / [ARCHITECTURE.md](./ARCHITECTURE.md) / [PYTHON_API.md](./PYTHON_API.md)

---

## 0. 目的と、何をMVP完成と呼ぶか

**完成体験**: ゲーム画面全体に微小世界が広がるWindowsアプリで、プレイヤーが自由配置の複数Pythonエディタを使ってスライムを制御する。スライム1体が四方から迫る細菌を回避・攻撃し、固定seedの1ステージを60秒（1,800 tick）生き残ればクリア。初心者は最初から動くコードを改良でき、上級者は独自の関数・クラス・アルゴリズム・複数`.py`ファイルを使える。

**MVPで守る非交渉事項**:

1. **ゲームの面白さが最優先**。Python文法の強制クイズや特定構文によるクリア判定は行わない。
2. **全画面Phaser + Reactの仮想フローティングエディタ**。左右固定分割を採用しない。
3. **ハイブリッドPython**。`set_ai(obj)`での判断関数型と、行動関数が次の6 tick判断境界まで自動待機する継続実行型の両方が使える。`wait_ticks(n)`は任意の追加待機として残し、JSPI実装はIssue #4で技術Go。
4. **純TypeScriptの固定tick決定論シミュレーション**。30 tick/秒、AI境界は6 tickごと、ステージは1,800 tick。固定seedを変更するUI/APIはMVPに設けない。
5. **Windowsオフライン動作**。Python実行環境は配布ビルドに同梱。アプリを正常停止・再起動でき、ユーザーのコードが消えない。
6. **Pythonがゲーム内部を直接操作しない**。観測 `Observation` を読み、行動 `Action` を提出する。Electron権限は隔離する。
7. **複数スライムの協調AIはMVP後**。キャラクターのアート完成度をクリティカルパスにしない。

**文書の優先順位**: プロダクトの合意事項 → `GAME_DESIGN.md`のルール → `PYTHON_API.md`の公開API → `ARCHITECTURE.md`の実装案 → 本ロードマップ。数値は既存文書の暫定案を基準にし、変更は該当仕様と同じPRで行う。

---

## 1. マイルストーンと判断ゲート

| Phase | Issue | ゴール / 実演可能な成果物 | 進行条件 |
|---|---|---|---|
| **P1 技術成立性** | 01–05 | ElectronでローカルPythonを動かし、2つの実行方式・停止・権限境界を検証 | **Gate A (Go/No-Go)**: Issue 03–04の技術要件を実証しADRで決定 |
| **P2 決定論的ゲーム本体** | 06–10 | UI無しでも同一Action列から同一の1,800 tick結果を再現できる | **Gate B**: ヘッドレス再現性テスト・基本ゲームルール合格 |
| **P3 プレイ可能な統合体験** | 11–15 | Pythonでスライムを動かし、フローティングエディタとカメラで観察できる | **Gate C**: コード変更に応じて戦闘が変化し、UI操作で戦闘結果が変わらない |
| **P4 遊べるWindows MVP** | 16–20 | 実行・停止・デバッグ・教材的導線・オフライン配布が成立 | **Gate D**: E2E・異常系・別Windows環境でのオフライン動作を検収 |

- **Phase P1完了前はP2以降の大規模実装を始めない**。特に行動関数の同期的な自動待機と決定論的な実行予算のPoCに失敗したままゲームの周辺機能を作り込まない。
- 各Phaseの終わりにプレイ・実演して残りIssueを見直す。ただし未承認の仕様削減はしない。
- Issue数は20件を目安とし、Spikeの結果や複雑さによって分割・追加は許可する。「20に合わせるための巨大Issue」は作らない。

### Gate A — 最重要: Python実行方式

**結果: Go（Issue 03〜05で検証・契約固定済み）**。Pyodide JSPI方式、決定論的実行予算、実時間watchdog、共有DTO/Envelope契約を採用する。ADR-002〜004を判断記録とする。

- Electron製品相当の実行環境で、**CDNなし**にローカル同梱PyodideをWorkerでロードできる。
- 同じAIインスタンスの`decide()`を1,000回以上呼び、クラス変数・インスタンス状態が維持される。
- `while True`内の行動関数が、**ローカル変数と呼び出し状態を保持して次の6 tick判断境界まで自動で中断・再開**できる方式を実証する。任意の`wait_ticks(1)→tick 6`、`wait_ticks(7)→tick 12`も確認する。
- 状態確認やPython計算中は世界を進めず、決定論的な実行予算だけを消費する。予算内に制御を返さない複数種類のコードを内容によらず一律停止し、実時間watchdogからもStop/Restartで制御回復できる。アプリとコードは失われない。
- `main.py`から`utils.py`のimport、標準ライブラリの計算用途、通常の関数・クラス・再帰を検証する。
- 同じ入力からのAction列再現性を確認。ホストファイル・ネットワーク・Electron権限に関する残存リスクを明記する。

**No-Go時**: `docs/adr/ADR-003-python-continuations.md`に検証コード・再現手順・失敗理由・候補（AST変換、協調コルーチン、別ランタイム等）とAPI互換性の影響を残す。**同期的な行動関数と`wait_ticks`を黙って`async/await`に変更しない**。ユーザーに設計判断を確認し、関連仕様を改訂するまで該当依存Issueを停止する。`Pyodide`が不適ならライブラリ選定を変更してよいが、プレイヤーのPython自由度と停止可能性を優先する。

---

## 2. 共通のIssue運用規約

### 2.1 作業の単位

- 基本は **1 Issue = 1 feature branch = 1 PR**。対象Issueの受け入れ条件を満たしたらmerge。
- Codexには「Issue本文 + 関連する仕様書 + `AGENTS.md`」を参照させる。依存IssueのPRがmainにmergeされていることを確認する。
- **仕様を変更するコード変更は必ず同じPRで関連`docs/*.md`を修正**。仕様と異なる代替案は勝手に採用しない。
- 依存関係上の後続Issueは、先行Issueの検証が完了するまで着手しない。ただし衝突のないテスト・アセット準備は別途可能。
- レビュー後のmergeは原則人間が承認。設計・セキュリティ・ランタイムの変更PRではGemini等の独立レビューを追加する。

### 2.2 リポジトリの初期ルール（Issue 01で作成）

```text
AGENTS.md
README.md
package.json
package-lock.json
docs/
  PRODUCT.md
  GAME_DESIGN.md
  ARCHITECTURE.md
  PYTHON_API.md
  ROADMAP.md
  adr/
src/
  game/simulation/       # Phaser/Electronに依存しない純TypeScript
  game/rendering/        # Phaser
  session/               # tickバリア、Run/Stop等
  python/                # microgame/runner/worker/DTO
  editor/                # Monaco + workspace
  ui/                    # floating windows, HUD, console
  shared/                # DTO、検証スキーマ
src/workers/
electron/                    # main/preload
public/                      # 配布に同梱する静的資産
tests/unit/
tests/integration/
tests/e2e/
.github/workflows/
.github/ISSUE_TEMPLATE/
.github/pull_request_template.md
```

実際のディレクトリ名は初期実装時に若干調整してよいが、**純粋なSimulationとRenderer、Python Runtime、Electronの権限境界**は分離する。

### 2.3 全Issue共通Definition of Done（DoD）

- [ ] Issueの目的・実装範囲・Out of scopeを満たしている。
- [ ] 追加した振る舞いに応じた自動テストを追加/更新した（自動化困難なら手動再現手順と理由を記録）。
- [ ] `npm run lint` / `npm run typecheck` / `npm test` / `npm run build` が通る。コマンドはIssue 01で整備し、以降維持する。
- [ ] PRに`Closes #<GitHubの実Issue番号>`、変更概要、実行テスト、スクリーンショット/動画（UI変更時）、残存リスクを記載。
- [ ] 公開Python APIとシミュレーションの挙動が変わる場合は関連仕様と契約テストを同じPRで修正。
- [ ] Electron/Pythonの安全性に関わる変更は権限・異常系をレビュー。
- [ ] 計画だけでなく動作する実装または検証結果がある。自動テスト未実行なのに「合格」と記載しない。

### 2.4 共通ラベル・Issueテンプレート

推奨ラベル: `phase:P1`〜`phase:P4`, `type:foundation`, `type:spike`, `type:gameplay`, `type:python`, `type:ui`, `type:test`, `type:release`, `priority:P0`, `priority:P1`, `blocked`, `needs-adr`。

各GitHub Issue本文に含める項目:

```md
## Objective
## Scope
## Acceptance Criteria
- [ ] （外部から検証できる条件）
## Tests / Verification
## Dependencies
## Out of scope
## Docs / ADR to update
```

---

## 3. Issue詳細（20件）

### P1 — 技術成立性（Issue 01–05）

#### Issue 01 — Desktop project bootstrap & CI

- **目的**: Windows向けデスクトップ開発の最小基盤を作る。
- **実装**: Electron + Vite + React + TypeScriptの起動、Phaser/Monaco導入準備、npm scripts、eslint、型チェック、Vitest、GitHub Actions、`.gitignore`、`AGENTS.md`、docs配置、PRテンプレート。
- **受け入れ条件**:
  - [ ] `npm ci`で依存を再現でき、開発用Electronウィンドウが起動する。
  - [ ] `npm run lint` / `npm run typecheck` / `npm test` / `npm run build`がCIで実行される。
  - [ ] Renderer側にNode.js APIが直接露出しない初期設定（`nodeIntegration: false`, `contextIsolation: true`, sandbox）を用意する。
  - [ ] 4仕様書と本ロードマップが`docs/`へ配置され、`AGENTS.md`から参照できる。
- **検証**: 起動確認、CI green、権限設定のチェック。
- **依存**: なし。 **Out of scope**: Python実行、戦闘処理。

#### Issue 02 — Fullscreen gameplay shell & overlay skeleton

- **目的**: 全画面ゲーム+自由配置UIの描画レイヤーを成立させる。
- **実装**: Phaser Canvasをウィンドウ全面へ敷く。React Overlay上に仮のHUD/エディタ枠を重ねる。画面リサイズ連動と入力イベントの境界を準備。
- **受け入れ条件**:
  - [ ] ウィンドウリサイズ後もPhaserが背景全面を描画する。
  - [ ] Reactの重ね合わせUIがゲームキャンバスから独立して表示される。
  - [ ] オーバーレイ上で操作すると、背後のPhaserへ意図しない操作が伝播しない。
- **検証**: 最小UIスモークテストと実画面確認。
- **依存**: 01。 **Out of scope**: 完成したWindow Manager、Monaco編集、敵描画。

#### Issue 03 — Offline Pyodide Worker & controller Spike

- **目的**: 第一候補ランタイムのオフライン実行と、判断関数型APIの成立性を実測する。
- **実装**: バージョンを固定してPyodide資産をローカル同梱し、Rendererから専用Workerへ`initialize/boundary/terminate`を送る実験。Pythonの`decide()`、クラス状態、基礎的な標準ライブラリを確認。ロード時間・メモリの観測手順も整備。
- **受け入れ条件**:
  - [x] ネットワークOFFでPython Workerを起動でき、CDNアクセス不要である。
  - [x] 同一インスタンスの`decide()`を1,000回以上呼んでも状態が継続し、Actionを返す。
  - [x] `math`、関数、クラス、再帰、`main.py`から`utils.py`のimportを検証できる。
  - [x] Worker内の例外がアプリ全体を落とさず、ファイル名/行番号等の診断へ変換される。
  - [x] PoCコード・計測・確認した制約を`docs/adr/ADR-002-pyodide.md`に残す。
- **検証**: Worker統合テスト + オフライン手動検証。
- **依存**: 01, 02。 **Out of scope**: 本番の完全なゲームループ・任意Pythonの安全性保証。

#### Issue 04 — Action auto-wait, execution budget & security Spike

- **目的**: ハイブリッド実行の最大リスクをゲーム本体の開発前に決着させる（**Gate A最重要**）。
- **実装**: 行動関数が次の6 tick判断境界まで同期的に自動待機する再開機構を実験し、関数内のローカル変数・クラス・呼び出し状態を保持。任意の`wait_ticks`、世界を進めない決定論的実行予算、内容に依存しない予算超過停止、実時間watchdog、Worker再生成、権限/ネットワーク/OSアクセスを評価する。判断関数との同居と制御権も試す。
- **結果**: Pyodide JSPI方式を採用し、`docs/adr/ADR-003-python-continuations.md`で**技術Go**。初期値は50,000 trace event/境界、watchdog 2,000 ms。
- **受け入れ条件**:
  - [x] tick 0の`act(Action)`または高水準行動関数が、明示的な待機なしでActionを提出しtick 6から再開する。
  - [x] 任意の同期`wait_ticks`で中断/再開できる。0→`wait_ticks(1)`=tick6、0→`wait_ticks(7)`=tick12。
  - [x] ループ内ローカル変数、関数呼び出し、クラス状態を再開後も保持できる。
  - [x] 状態確認とPython計算はObservationとsimulation tickを進めず、決定論的な実行予算だけを消費する。
  - [x] tight loop、深い再帰、長時間計算等の予算内に制御を返さないコードを、構文別の特例なしで同じ予算超過として一律停止する。
  - [x] 実時間watchdog超過もStopでき、コードを失わず新しいWorkerでRestartできる。
  - [x] `decide()`と継続処理を直列実行し、同一スライムの行動競合を検知できる。
  - [x] ホストファイル・ネットワーク・JS bridgeなどの許可/遮断の実測と残存リスクを`docs/adr/ADR-003-python-continuations.md`に記録する。
  - [x] **Go/No-Goを明文化**。失敗時は代替案と変更影響を提示し、05以降の依存作業を止める。
- **検証**: 再現PoC、強制停止の操作試験、権限試験、決定論的Action列の複数回比較。
- **依存**: 03。 **Out of scope**: 仕様を無断で非同期APIへ変更すること、無条件の完全サンドボックス保証。

#### Issue 05 — Shared contracts, validators & architecture decision

- **目的**: Python/Simulation間のAPI契約を固定し、後続Issueが並行開発可能な境界を作る。
- **実装**: `ObservationDTO`/`ActionDTO`、`Envelope(sessionId, requestId, type, payload)`、Zod等での検証、型定義、型とログ/エラー仕様のテスト。`microgame`の`Observation`/`Action`への変換契約、実行方式に関するADRを確定。
- **結果**: `src/shared/contracts.ts`をDTO正本とし、frozen Python型への変換、統一Action検証、protocol/validation/python/budget診断を実装。ADR-004でGate AをGoとして確定。
- **受け入れ条件**:
  - [x] 既存`PYTHON_API.md`の`Vec2`/`EnemyView`/`Observation`/`Action`へ対応するDTOと変換契約がある。
  - [x] NaN/Infinity/不正ID/不正型/古いsessionId/不正requestIdが安全に拒否される。
  - [x] Controller/Manualで一つのAction表現と制御権ルールを共有する。
  - [x] 行動関数の自動待機、任意の`wait_ticks`、実行予算超過をWorker境界で識別できる契約と診断がある。
  - [x] Gate AがGoで、ADRと仕様の矛盾が解消されている。
- **検証**: JSON転送・スキーマ境界・型契約の単体テスト。
- **依存**: 03, 04。 **Out of scope**: ゲーム世界の描画や戦闘実装。

### P2 — 決定論的ゲーム本体（Issue 06–10）

#### Issue 06 — Headless fixed-tick Simulation Core

- **目的**: 画面非依存の再現可能なゲーム時計・状態遷移を作る。
- **実装**: `SimulationState`、固定seedのPRNG、安定したEntity ID、`step(state, action)`、30 tick/秒、AI境界6tick、状態シリアライズとハッシュ。Simulation Workerアダプタの基礎。
- **受け入れ条件**:
  - [ ] Phaser/React/Electronをimportせずヘッドレス実行できる。
  - [ ] 同一初期状態+同一行動列から複数回同一state hash列が得られる。
  - [ ] 30TPS/6tick境界/1,800tickの終了境界を検証できる。
  - [ ] シミュレーションに実時間時計、描画FPS、UI位置を入力しない。
- **検証**: 1,800tickリプレイとゴールデンハッシュ比較。
- **依存**: 05。 **Out of scope**: スライム/敵の完成ルール。

#### Issue 07 — Slime state, movement & arena boundaries

- **目的**: Actionで制御できるスライム1体を実装する。
- **実装**: HP/位置/速度/半径、移動ベクトルの正規化、アリーナ境界、基本初期状態。ゲームデザインの暫定値を集中管理。
- **受け入れ条件**:
  - [ ] `Action(move_x, move_y, target_enemy_id)`の移動成分で決められた距離だけ移動する。
  - [ ] 正規化・停止・壁での座標補正が再現可能。
  - [ ] 不正な行動でも状態や位置がNaNに汚染されない。
- **検証**: 単位ベクトル・境界値・同一Action列の単体テスト。
- **依存**: 06。 **Out of scope**: Pythonエディタ、戦闘エフェクト。

#### Issue 08 — Bacteria entities, chase AI & deterministic spawning

- **目的**: 四方から細菌が出現し、スライムへ迫る基本脅威を作る。
- **実装**: 追跡型細菌、敵ID順の移動、スポーンの固定seed/固定スケジュール、観測データの敵一覧。高速型はP1余地として設計。
- **受け入れ条件**:
  - [ ] 予定tickで敵が発生し、IDを再利用せず固定順序で行動する。
  - [ ] `Observation.enemies`がID昇順、最寄り敵の同距離判定がID昇順になる。
  - [ ] 同一seed・同一Action列で出現位置と移動軌跡が一致する。
- **検証**: スポーン・最寄り敵タイブレーク・スナップショットテスト。
- **依存**: 06, 07。 **Out of scope**: 複数敵種の完成、複数ステージ。

#### Issue 09 — Attack, projectile, collision & damage rules

- **目的**: スライムが攻撃し、敵を倒し、接触でダメージを受ける戦闘を成立させる。
- **実装**: ターゲット選択、射程/クールダウン、弾/命中順序、接触判定、敵撃破、HP減少、統計。1tickの順序は`GAME_DESIGN.md` §5.2に従う。
- **受け入れ条件**:
  - [ ] 射程外や無効ターゲットには不正な命中が発生しない。
  - [ ] 同一tickの複数衝突でも判定順序が安定する。
  - [ ] 撃破数、被ダメージ、残りHPが一貫して更新される。
  - [ ] 攻撃/被弾の状態変更が毎回同一ハッシュになる。
- **検証**: エッジケース（接触同時、HP0、同時弾命中、ID順）単体テスト。
- **依存**: 07, 08。 **Out of scope**: 画面演出、音声。

#### Issue 10 — Single-stage wave schedule, win/lose & results

- **目的**: 1ステージ60秒をヘッドレスで完走できるようにする（**Gate B**）。
- **実装**: ステージ設定・難易度推移、1,800tickのクリア、HP0失敗、結果DTOと統計、既定Action戦略でのスモーク再生。細菌は追跡型を基本とする。
- **受け入れ条件**:
  - [ ] 1,800tickの最後のダメージ処理まで評価してからクリア判定する。
  - [ ] HP0の失敗と60秒生存のクリアが区別され、ログ・結果DTOを得られる。
  - [ ] 固定seed・固定Action列で同じ最終結果とstate hash列を得られる。
  - [ ] ゲームの暫定バランス数値は設定に集約されている。
- **検証**: 成功/失敗境界テスト、ヘッドレス完走再現テスト。
- **依存**: 06–09。 **Out of scope**: プレイヤーへのPython教育チュートリアル。

### P3 — プレイ可能な統合体験（Issue 11–15）

#### Issue 11 — Python ↔ Simulation bridge & session orchestration

- **目的**: 1本のプレイヤーPythonからスライムを戦わせる縦断的な体験を成立させる。
- **実装**: `GameSessionCoordinator`、`sessionId`付きWorker通信、tick境界barrier、Python観測スナップショット、Action検証・適用、Controller/Manualの制御権、古い応答破棄。
- **受け入れ条件**:
  - [ ] Controller型で6tickごとに判断し、次境界まで行動を保持する。
  - [ ] Manual型の`act(Action)`と高水準行動関数がActionを境界で確定し、次の6 tick判断境界まで自動待機する。`wait_ticks()`は任意の追加待機として動く。
  - [ ] 状態確認・Python計算・Python応答待ちにゲームtickが進まず、遅延によって行動tickがずれない。
  - [ ] 同じソース+固定seedで複数回同一結果。古いsessionIdのActionを無視。
- **検証**: 擬似Workerによる統合テストと実Pyodideを使った縦断スモークテスト。
- **依存**: 05, 10。 **Out of scope**: 完成エディタ、複数スライム。

#### Issue 12 — Monaco editor, Python files & workspace store

- **目的**: プレイヤーがゲーム内でPythonを編集できるようにする。
- **実装**: Monaco Editor、`main.py`初期テンプレート、ファイル一覧、`.py`新規作成/名前変更、単一ソースのWorkspace Store、編集内容のスナップショット。複数ファイルを開くためのモデル共有。
- **受け入れ条件**:
  - [ ] `main.py`のコードを編集し、Run対象スナップショットへ反映できる。
  - [ ] `utils.py`を作成でき、同じファイルを別表示しても内容が矛盾しない。
  - [ ] コード編集・ファイル切替がゲームシミュレーションから独立している。
- **検証**: Workspace Storeテスト、エディタ基本操作の手動/自動UIテスト。
- **依存**: 02, 05。 **Out of scope**: フローティングの全操作、永続化、ホットリロード。

#### Issue 13 — Floating Window Manager

- **目的**: プレイヤーがゲーム画面上に好きな数のコードウィンドウを置けるようにする。
- **実装**: 移動/リサイズ/重なり順/最小化/復元/閉じる、ファイルごとの開閉、Console用ウィンドウ型の共通コンポーネント、画面外のウィンドウ救済、レイアウトの状態管理。
- **受け入れ条件**:
  - [ ] `main.py`と`utils.py`を別位置・別サイズで同時表示できる。
  - [ ] クリックによる最前面化、最小化/復元、閉じた後の再表示が機能する。
  - [ ] 閉じてもファイル内容は消えず、画面外に配置したウィンドウを回復できる。
  - [ ] ウィンドウを操作してもシミュレーション状態が変化しない。
- **検証**: ドラッグ/リサイズ/フォーカス/UI状態テスト。
- **依存**: 02, 12。 **Out of scope**: OSレベルの複数Electronウィンドウ、無限数表示の性能保証。

#### Issue 14 — Workspace persistence, virtual imports & local data boundary

- **目的**: 複数ファイルのPythonプロジェクトを再現可能・安全に保存/読込する。
- **実装**: Electron preloadの限定IPC、userData保存（ファイル名検証、原子的更新、破損時の回復方法）、ワークスペースとウィンドウ配置の永続化、実行時VFSスナップショット、`import utils`、新規Run時のPython状態初期化。
- **受け入れ条件**:
  - [ ] `main.py`で`import utils`が動作する。
  - [ ] アプリ再起動で`.py`ソースと各ウィンドウの配置・開閉が復元される。
  - [ ] 実行中にソースを変更しても当該Runは変わらず、MVPでは実行中編集をロックする。
  - [ ] Pythonから任意のホストパスを直接読むAPIを公開しない。
- **検証**: 保存→再起動→import、パス操作への拒否テスト、IPC権限確認。
- **依存**: 03, 11, 12, 13。 **Out of scope**: Steam Cloud、外部Pythonパッケージの自由インストール。

#### Issue 15 — Phaser gameplay rendering, camera controls & HUD

- **目的**: ゲーム挙動を見て改善できる表示を実現する（**Gate C**）。
- **実装**: スライム・細菌・弾を単純図形で描画、スナップショット補間、ズーム/パン、スライムへフォーカス、HP/経過時間/撃破数HUD、React/Monacoとのホイール・キーボードフォーカス調整。
- **受け入れ条件**:
  - [ ] 背景全面で戦闘が見え、カメラのズーム/パンが機能する（倍率の初期案0.15〜4.0）。
  - [ ] エディタ上のホイール操作ではエディタがスクロールし、裏のPhaserはズームしない。
  - [ ] カメラ位置・ウィンドウ配置・描画FPSを変えてもヘッドレス結果が同一。
  - [ ] Pythonコードを変えるとスライム行動が視認できる形で変わる。
- **検証**: UI操作E2E、カメラ独立性の再現性テスト、プレイ動画。
- **依存**: 10, 11, 13。 **Out of scope**: 高品質キャラクターアート、複雑なVFX。

### P4 — 遊べるWindows MVP（Issue 16–20）

#### Issue 16 — Run/Pause/Resume/Stop/Restart & result UX

- **目的**: Python実行とステージを安全に開始・停止・再挑戦できるようにする。
- **実装**: セッション状態機械（IDLE/LOADING/READY/RUNNING/PAUSED/FINISHED/ERROR）、実行ボタン、結果表示、Worker再起動、処理中の操作禁止/許可、終了時のコード保持。
- **受け入れ条件**:
  - [ ] Run中は編集ロック、Stop後は編集可能。Restartではtick/seed/Python状態を初期化する。
  - [ ] Pause/Resumeを挟んでも同一Action系列からの結果が変わらない。
  - [ ] HP0は失敗、最終tickを生き残ればクリアと表示する。
  - [ ] Workerが応答しない場合もStop操作が可能で、ゲームアプリは閉じない。
- **検証**: 状態遷移テスト、強制停止テスト、再挑戦E2E。
- **依存**: 11, 14, 15。 **Out of scope**: 実行中のコードhot reload。

#### Issue 17 — `microgame` public API: beginner helpers & low-level controls

- **目的**: 初心者には数行、上級者には独自アルゴリズムの自由度を提供する。
- **実装**: `Vec2` / `EnemyView` / `Observation` / `Action`、`Action.flee()`、`nearest_enemy()`、`self_position()`、`get_state()`、`act()`、`attack_nearest()`、`set_ai()`、`wait_ticks()`の公開契約とエラー/診断を整備。行動関数は次の判断境界まで自動待機し、実際の攻撃間隔はゲーム側のクールダウンへ委ねる。
- **受け入れ条件**:
  - [ ] `PYTHON_API.md`の3サンプル（初期継続、if回避、クラスController）が一貫したAPIで実行できる。
  - [ ] 初心者向けヘルパーを使わずに座標/敵情報から自作Actionを生成できる。
  - [ ] `ControlModeError`/`InvalidWaitError`/`ExecutionBudgetExceeded`/無効Action警告など仕様通りに診断できる。
  - [ ] 標的・距離同率・正規化・行動関数の自動待機・`wait_ticks(1/6/7)`・ゲーム側クールダウンの契約テストがある。
- **検証**: Python契約テスト、具体例の実行・行動比較。
- **依存**: 11, 14, 16。 **Out of scope**: NumPy・外部パッケージ、複数スライムAPI。

#### Issue 18 — Safety hardening, debug console & diagnostics

- **目的**: プレイヤーコードのエラーに強く、試行錯誤しやすい実行体験に仕上げる。
- **実装**: フローティングConsole、`print()`のtick付き表示、SyntaxError/ImportError/RuntimeErrorのファイル・行番号リンク、過剰ログ抑制、Python timeout/Worker terminate、Electron IPCスキーマ・CSP・権限境界の再監査、禁止操作テスト。
- **受け入れ条件**:
  - [ ] 構文/実行時エラーが正しいファイル・行に関連付けられ、コードが保持される。
  - [ ] 内容を問わず予算超過・watchdog超過したコードでもUIとStopが機能し、Restartできる。
  - [ ] 大量ログでUIが無反応にならず、制限がプレイヤーへ示される。
  - [ ] ElectronのNode権限・ホストファイル・ネットワーク到達性の検証結果を`docs/SECURITY.md`に記録する。
- **検証**: 異常系E2E、Python負荷テスト、セキュリティチェックリスト。
- **依存**: 04, 14, 16, 17。 **Out of scope**: 未検証の「完全サンドボックス」主張。

#### Issue 19 — First-run experience, balancing & playtest

- **目的**: Python未経験者が楽しく始められ、経験者にも工夫する余地がある1ステージにする。
- **実装**: 初期`main.py`（動くサンプル）、任意ヒント、必要最小限のAPIヘルプ、経過時間帯で増える敵、撃破/被弾の簡単な演出、プレイテスト記録とパラメータ調整。
- **受け入れ条件**:
  - [ ] Python未経験でもRunで戦闘開始でき、コード中の数値/条件を変更して行動の違いを観察できる。
  - [ ] 特定の文法を強制せず、少なくとも単純戦略と改善戦略の2通りを比較できる。
  - [ ] 60秒クリア可能な戦略例が存在し、初期コードには改善余地がある。
  - [ ] 初心者/経験者それぞれの小規模プレイテストで詰まりどころと対応を記録した。
- **検証**: 人間のプレイテスト、固定seedの戦略比較、E2Eスモーク。
- **依存**: 15–18。 **Out of scope**: 強制Python講義、複数ステージ、複数スライム。

#### Issue 20 — Windows offline distribution, full regression & MVP sign-off

- **目的**: 別のWindows PCで配布ビルドを起動し、オフラインで最初から最後まで遊べる状態にする（**Gate D**）。
- **実装**: electron-builder等によるWindows x64パッケージ、Pyodide・ゲームアセット同梱、製品ビルド起動テスト、基本インストーラ、ライセンス表示、E2E回帰、リリース候補チェックリスト、必要文書最終更新。
- **受け入れ条件**:
  - [ ] 新規Windows環境でネットワークOFFのまま起動・Python実行・60秒クリア/失敗・保存/再起動を試せる。
  - [ ] Controller/Manual/ハイブリッドのサンプル、複数`.py` import、停止/再開を実際の配布物で試験した。
  - [ ] 固定seedで同一コードの複数run結果が再現し、UI操作で変化しない。
  - [ ] セキュリティ/ライセンス/残存リスク一覧があり、既知の重大なクラッシュやデータ消失がない。
  - [ ] `npm run lint` / `typecheck` / `test` / `build` と主なE2E結果をPRに添付し、人間がMVP完成を承認する。
- **検証**: CI + Playwright/Electron E2E + **別Windowsマシンの手動オフライン受入試験**。
- **依存**: 01–19。 **Out of scope**: Steamへの公開申請、販売用ストアページ、実績/Cloud、価格決定、多言語版。

---

## 4. 依存関係一覧（着手順の目安）

```text
01 bootstrap
 ├── 02 fullscreen shell ────────────────┐
 │    └── 03 offline Python Worker       │
 │          └── 04 continuation + safety Spike [Gate A]
 │                 └── 05 contracts ─────┼── 06 fixed-tick core
 │                                       │     └── 07 slime
 │                                       │           └── 08 bacteria
 │                                       │                 └── 09 combat
 │                                       │                       └── 10 stage [Gate B]
 │                                       │                             └── 11 Python bridge
 │                                       └── 12 Monaco/files ──┐           │
 │                                                            └── 13 floating windows
 │                                                                      │
 └──────────────────────────────────────────────────────────────────────┤
                                                                        ├── 14 persistence/import
                                                                        └── 15 rendering/camera [Gate C]
                                                                              └── 16 controls/results
                                                                                    └── 17 public API
                                                                                          └── 18 debug/security
                                                                                                └── 19 playtest
                                                                                                      └── 20 release [Gate D]
```

※上図は概略。**正確なDepends onは各Issue本文を正とする**。UIの基礎（12、13）はGate A通過後、純粋なSimulation開発（06–10）と一部並行可能。技術リスクを引き受けない限りGate A前に大規模なUI実装へ進まない。

---

## 5. 各フェーズのデモ / テスト合格条件

| Gate | 開発者が見せられるデモ | 自動化/実機検証の柱 |
|---|---|---|
| **A** | オフラインのElectron Workerで、クラス判断と行動関数の自動待機が中断再開し、予算超過コードを一律停止できる | 1000回判断、行動/wait境界、実行予算、watchdog、import、権限調査、ADR |
| **B** | ヘッドレスでスライムvs細菌の60秒を計算し、結果を出力 | 1800tick、勝敗境界、全tick hashリプレイ |
| **C** | エディタでPythonを書き換えると、画面全面のスライムが違う動きをする | UIイベント分離、Camera非干渉、Python bridge同一結果 |
| **D** | 別Windows PCでオフライン起動、編集→Run→60秒プレイ→Restart→保存復元 | CI、E2E、異常系、製品ビルド検証、セキュリティ残存リスク |

**重要な非機能テスト**:

- **再現性**: 同一ビルド/環境、同一Pythonソースと固定seedで、生存tick・撃破数・最終HPが一致する。まず固定Action列のstate hash一致を保証する。
- **AI境界**: tick 0/6/12...でのみ更新し、行動関数は次境界まで自動待機する。`wait_ticks(1)`と`wait_ticks(7)`の丸め規則も守る。
- **UI非干渉**: エディタ数・配置、ゲームズーム/パン、画面リサイズ、Pause/Resumeがシミュレーション結果を変えない。
- **保護**: 不正Action、構文エラー、予算内に制御を返さないコード、過剰ログでゲーム本体を落とさず復旧できる。
- **真正な製品試験**: 開発サーバーではなく配布パッケージでオフライン実行する。権限制限の成否を思い込みで済ませない。

---

## 6. ChatGPT → GitHub → Codex → Review → Merge運用

1. **ChatGPTでIssueの仕様確認**: 参照節、変更対象、対象外、受け入れ条件を定義。20件全部を起票しても後半は見直し可能。
2. **Issue登録**: `Objective`/`Scope`/`Acceptance Criteria`/`Tests`/`Dependencies`/`Out of scope`を本文に明記。実Issue番号を相互リンク。
3. **Codexへ1件ずつ実装委任**: `AGENTS.md`とIssue、関連仕様を確認してからブランチを作成。必要に応じて、実装前に短い変更計画を提示させる。
4. **Codexが実装・テスト・コミット・push・PR作成**: PRには実行したコマンドと結果、未確認項目、更新した仕様を記載。
5. **GitHub Actionsが客観検証**: lint/typecheck/tests/buildと必要なE2E。テストが通ったことと仕様を満たしたことは区別する。
6. **レビュー**: 一般Issueは人間が差分と動作を確認。Python継続実行/セキュリティ/契約変更/再現性についてはGeminiなど第二の視点でレビュー。
7. **修正→人間がmerge**: PRで「必要な変更をしたか」「余計な変更をしていないか」「コードと仕様が一致するか」を確認。
8. **PhaseごとにChatGPTで再評価**: Gate A/B/C/Dで動作・失敗点・残リスクを確認し、未着手Issueの条件を必要に応じて改訂。

### Codexへの推奨Issue依頼テンプレート

```text
GitHub Issue #<実Issue番号> を実装してください。

1. 最初に AGENTS.md と docs/PRODUCT.md, docs/GAME_DESIGN.md,
   docs/ARCHITECTURE.md, docs/PYTHON_API.md, docs/ROADMAP.md の
   関連節を読んでください。
2. 対象IssueのScopeとAcceptance Criteriaに限定して実装してください。
3. 公開Python API / tick規則 / Electron権限の変更が必要なら
   独断で変更せず、設計上の衝突点を報告してください。
4. テストを追加・実行し、実行コマンドと合否をPRへ記載してください。
5. 仕様変更時は関連docsとテストを同じPRで更新してください。
6. commit/pushしてPRを作成してください。mainへのmergeは行わず、
   レビュー可能な状態で止めてください。
```

---

## 7. スコープの管理 / MVP後のバックログ

**MVP必須（P0）**: 1スライム/1ステージ60秒、Controller+Manualハイブリッド、固定seed/30TPS、コード保存/複数import、複数フローティングエディタ、ズーム/パン、Stop/Restart/エラー表示、Windowsオフライン配布。

**余力があれば（P1、MVP必須の後）**: 高速型の2種類目の細菌、ヒントUIの改善、詳細な行動ログ、戦闘結果比較、視覚演出の充実。

**MVP後（P2）**: 複数スライムの協調AI、複数ステージ/seed選択/ランダムチャレンジ、高速リプレイとタイムラインデバッグ、Steam実績/Cloud、ランキング、3D表現、複雑な進化/ビルド要素、追加Pythonライブラリの配布検討。

**Steamで販売可能な製品**はMVPと同義ではない。MVP受け入れ後、価格・ストアページ・法務/ライセンス・ローカライズ・操作性・アクセシビリティ・より広い環境での品質・プロモーション等を別計画として用意する。

---

## 8. 未決事項と次のアクション

| 未決事項 | いつ決めるか | 判断材料 |
|---|---|---|
| 行動関数の同期的な自動待機と`wait_ticks`継続実行の実現方法 | **Issue 04でJSPI採用済み** | ADR-003、製品Electron継続テスト |
| Pyodide同梱・オフライン動作とElectron security境界 | **Issue 03–04で初期検証済み、18で再監査** | 製品相当ビルド、通信/権限実験 |
| Pythonの実行予算・タイムアウト値・メモリ対策 | **Issue 03–04で測定、18で確定** | 一般的PC実測と悪性/誤用ケース |
| Phaser画面・エディタ同時表示の性能限界 | **Issue 02, 13, 15** | ウィンドウ数とFPSの実測 |
| HP/敵速度/出現数/弾パラメータ | **Issue 07–10で仮決定、19で調整** | 初心者/上級者プレイテスト |
| Windowsインストーラの形式と署名 | **Issue 20** | 配布方法・費用・セキュリティ上の注意 |

**今すぐ行う作業**:

1. 本文を最終レビューして`docs/ROADMAP.md`へ配置する。
2. `AGENTS.md`とIssue/PRテンプレートを整備し、#01〜#20をGitHubへ起票する（**まだ起票していない**）。
3. Issue 01に着手し、その後Issue 03–04のGo/No-Goを最優先する。

---

## 9. ロードマップ変更ルール

- 仕様変更時は、合意事項・変更理由・影響するIssue・既存実装の移行方針をPRに記載する。
- `PYTHON_API.md`の公開契約を変える場合、`GAME_DESIGN.md`、`ARCHITECTURE.md`、サンプルコード、テストへの波及を必ず点検する。
- 技術Spikeの結果が曖昧なら、成功と見なして先へ進まない。`blocked`ラベルとADRを使って意思決定する。
- ステージやアートの追加によってPythonの使い心地を後回しにしない。
- 「どのPython構文を使ったか」ではなく、プレイヤーが**自分のコードでより良く戦えたか**を開発評価の中心にする。
