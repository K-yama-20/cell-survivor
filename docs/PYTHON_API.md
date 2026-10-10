# PYTHON_API.md — Micro Survivor（仮題）プレイヤー向けPython API仕様

> **ステータス**: MVP公開API設計 v0.2（2026-10-10）
> **関連文書**: [PRODUCT.md](./PRODUCT.md) / [GAME_DESIGN.md](./GAME_DESIGN.md) / [ARCHITECTURE.md](./ARCHITECTURE.md)  
> **対象**: ゲーム内エディタから書く**本物のPython**とゲームの間の公開契約。  
> **重要**: ここに記した関数名・意味・例外は**実装目標の契約案**であり、現時点で動くコードではない。特に行動関数の同期的な自動待機、`wait_ticks()`の追加待機、決定論的な実行予算と停止は**[Spike必須]**。技術検証の結果で記法の変更が必要なら、承認後にこの文書と関連仕様書を同時更新する。

---

## 1. API設計思想

1. **ゲームが主役**: Pythonはスライムの生存戦略を作る道具。文法を使ったかどうかを判定しない。
2. **初心者でも数行で動かせる**: 最寄り敵や回避の高水準ヘルパーを用意。
3. **上級者が戦略を自作できる**: 敵一覧、座標、HPなどを読み、移動方向と攻撃対象を細かく指定可能。
4. **Pythonとして自然**: 変数、`if`、`for`、`while`、関数、クラス、複数ファイルを利用可能にする。
5. **一つの内部行動契約**: 高水準APIも低水準APIも最終的に`Action(move_x, move_y, target_enemy_id)`へ集約。
6. **判断と描画を分離**: Pythonは`Observation`のみを読み、ゲームの位置/HP/敵リストを直接書き換えられない。
7. **公平で再現可能**: ゲームtick同期、ステージの固定seed。カメラやエディタ配置は戦闘へ影響しない。

本書で定義するモジュール名は`microgame`。Python標準の`sys`/`os`を通じてホストのファイルにアクセスできるといった意味ではない。

---

## 2. 初心者向け：まず試すサンプル

### 2.1 サンプルA — 継続実行型（初回の`main.py`候補）

```python
from microgame import attack_nearest

while True:
    attack_nearest()
```

`attack_nearest()`はActionを提出して次の判断境界まで自動で待つ。スライムは6tickごとに近い敵を狙うが、実際の発射はゲーム側の射程・クールダウンに従う。これだけでは後半の群れに対処しにくく、改良したくなる想定。

**注意**: この例は行動関数の同期的な自動待機がSpikeに合格したときの最終形。実行方式が変わる場合はサンプルも統一して改訂する。

### 2.2 サンプルB — 条件分岐を追加

```python
from microgame import (
    Action, act, nearest_enemy, self_position,
)

while True:
    enemy = nearest_enemy()

    if enemy is None:
        act(Action())
    elif enemy.distance < 120:
        act(Action.flee(
            self_position(),
            enemy.position,
            attack_target_id=enemy.id,
        ))
    else:
        act(Action(target_enemy_id=enemy.id))
```

「敵が近いときに逃げる」を`if`で表現している。プレイヤーが120を80/160等に変えると同じseedで違いを比較できる。

### 2.3 サンプルC — 判断関数＋クラス型

```python
from microgame import Action, set_ai

class SlimeAI:
    def decide(self, state):
        enemy = state.nearest_enemy
        if enemy is None:
            return Action()

        if enemy.distance < 120:
            return Action.flee(
                state.position,
                enemy.position,
                attack_target_id=enemy.id,
            )

        return Action(target_enemy_id=enemy.id)

set_ai(SlimeAI())
```

`set_ai()`で登録したオブジェクトの`decide()`を、ゲームがAI判断境界ごとに呼び出す。オブジェクトは再生成されないため、`self`に状態を保持できる。

---

## 3. Python実行モデルの規約

### 3.1 tickとAI判断境界

- ステージ時間: **30 simulation tick/秒、1800 tick = 60秒**。
- AI境界: **6 tickごと**。`tick 0, 6, 12, ... , 1794`。
- `Observation`は境界tickの開始時点の読み取り専用スナップショット。
- 状態確認とPython計算は決定論的な実行予算を消費するが、Pythonが制御を返すまでゲームtickは進まず、同じObservationを読み続ける。
- 有効な行動は次のAI境界まで保持される。描画FPSやPCの処理時間で判断回数を増減しない。
- 継続型の行動関数はActionを提出した時点で自動休止し、次の6 tick境界で再開する。`wait_ticks()`は任意の追加待機であり、通常の行動ループには不要。
- 境界中、継続実行スクリプトの期限が来ていれば先に再開し、`set_ai()`されたAIがあればその後`decide()`を呼ぶ。Python Workerで直列化する。
- 1ステージのseedは固定。MVPにseed選択/変更APIを設けない。

### 3.2 2つのスタイル

| スタイル | 主な方法 | 制御権 |
|---|---|---|
| **Manual / 継続型** | `while True`＋`act(Action)` / 高水準行動関数。行動時に自動待機 | 継続スクリプトがActionを提出 |
| **Controller / 判断型** | `set_ai(obj)`＋`obj.decide(state) -> Action` | `decide`の返り値のみがAction |

- 1体のスライムについて、同時に行動を決める経路は常に1つ。
- `set_ai()`を登録している間、継続側から`act`等の行動APIを使うと`ControlModeError`。一方、監視・ログ用の`get_state()`/`print()`/`wait_ticks()`は使える。
- `decide()`の中で`act`/`attack_nearest`等の自動待機する行動関数を使うのも`ControlModeError`。結果を`Action`として返す。
- MVPの`set_ai(obj)`は**実行開始時（初回tick境界の初期化処理）に一度登録**する。動的なAI交換/解除はMVP対象外。[設計決定案]
- 複数スライムの制御はMVP後の拡張で、今はスライムIDをプレイヤーが選ぶAPIを用意しない。

### 3.3 継続スクリプトの中断と実行予算

`act(action)`、`attack_nearest()`等の行動関数はActionを確定し、**次のAI判断境界まで継続処理を自動で中断する**。例えばtick 0の`act(...)`はtick 0〜5に適用するActionを提出し、関数呼び出しの続きはtick 6で再開する。

`wait_ticks(n)`は行動ごとに書く必須APIではない。通常の行動関数による1境界待機よりも長く、または明示的に何もせず待つ場合の高度なタイミング調整として、**「ゲーム内で少なくともn tick進んだ最初のAI境界まで継続処理を中断する」**。

```text
現tick=0  → wait_ticks(1) → 再開tick=6
現tick=0  → wait_ticks(6) → 再開tick=6
現tick=0  → wait_ticks(7) → 再開tick=12
現tick=6  → wait_ticks(7) → 再開tick=18
```

数式：`resume_tick = 6 * ceil((current_tick + n) / 6)`（`n >= 1`）。`wait_ticks()`中は最後に確定したActionを再開まで保持する。

- `n`は`bool`を除く正整数。0、負数、小数、文字列は`InvalidWaitError`。
- `wait_ticks`は継続型スクリプトの実行文脈でのみ使う。`decide`の内部から呼ぶと`ControlModeError`。
- 状態確認、ループ、関数呼び出し、再帰、コレクション操作等は実行予算を消費するが、simulation tickは進めない。予算の計数単位と初期値はIssue #4のSpikeで決める。
- 行動関数、`wait_ticks()`、`decide()`のreturn、または処理終了で制御を返す前に予算を超えた場合、特定構文や関数名を検出せず、すべて同じ`ExecutionBudgetExceeded`として停止する。
- ゲーム結果に使う予算判定は同じコードと入力で同じ結果になる決定論的な単位とし、実時間watchdogはWorker/アプリ保護の最終手段として分離する。
- 行動関数と`wait_ticks`によるスタック/ローカル変数保持の実装方式は**[Spike必須]**。本物の通常Pythonのままで実現できないと分かった場合、黙って`async`へ仕様変更しない。

### 3.4 同時にAIを監視する「ハイブリッド」例

```python
from microgame import Action, get_state, set_ai, wait_ticks

class CautiousAI:
    def __init__(self):
        self.decisions = 0

    def decide(self, state):
        self.decisions += 1
        enemy = state.nearest_enemy
        if enemy is None:
            return Action()
        return Action.flee(
            state.position, enemy.position,
            attack_target_id=enemy.id,
        ) if enemy.distance < 110 else Action(target_enemy_id=enemy.id)

ai = CautiousAI()
set_ai(ai)

while True:
    print("tick", get_state().tick, "decisions", ai.decisions)
    wait_ticks(30)
```

- 上の監視ループは行動を上書きせず、AIの状態・ログを管理する。
- 同じ1つのPython Workerで逐次実行するため、`decide()`と監視コードは同時にオブジェクトを変更しない。
- UIへのログ出力とゲームtickは別。ログ量は制限される。

---

## 4. 公開データ型（MVP）

> 型注釈は設計上の公開契約。実際には`@dataclass(frozen=True)`等の読み取り専用Pythonオブジェクトとして実装予定。転送用DTOの内部構造と公開Python型は区別する。

### 4.1 `Vec2`

```python
@dataclass(frozen=True)
class Vec2:
    x: float
    y: float
```

- 座標の単位は**world unit**。ピクセルや画面ズーム倍率とは独立。
- Xは右方向に正、Yは下方向に正（2D画面の座標系）。
- 距離・速度計算にはこの座標を利用する。カメラの位置は提供しない。

### 4.2 `EnemyView`

```python
@dataclass(frozen=True)
class EnemyView:
    id: int
    kind: str
    position: Vec2
    hp: int
    distance: float
```

- `id`: 当該実行中に一意、再利用なし。順序比較可能な正整数。
- `kind`: MVPの標準は`"chaser"`。追加敵として`"runner"`を想定（実装されるまで登場しない）。
- `position`: 敵の中心。
- `hp`: 当該判断時点のHP。
- `distance`: スライム中心と敵中心のユークリッド距離（world unit）。
- スライムや敵が存在していたとしても、`EnemyView`の書き換えでゲーム実体は変更できない。

### 4.3 `Observation`

```python
@dataclass(frozen=True)
class Observation:
    tick: int
    hp: int
    max_hp: int
    position: Vec2
    enemies: tuple[EnemyView, ...]
    nearest_enemy: EnemyView | None
```

| フィールド | 値 / 意味 |
|---|---|
| `tick` | 現在のシミュレーションtick。初回は0 |
| `hp` | 現在のHP（MVPは整数） |
| `max_hp` | 最大HP（初期案100） |
| `position` | スライムの中心のワールド座標 |
| `enemies` | この境界で存在する敵の読み取り専用タプル、**ID昇順** |
| `nearest_enemy` | 最寄りの敵。いない場合は`None`。同距離なら**IDが小さい敵** |

- `Observation`は境界ごとに新しいスナップショット。古いオブジェクトを手元に保存しても自動更新されない。
- `Observation`が保持する`EnemyView`はゲーム側の情報をコピーしたもの。オブジェクトの同一性/参照をゲームへ逆輸入しない。
- `enemies`はワールド上に存在する敵すべてを返す[MVP設計決定案]。可視範囲・カメラズームで内容を減らさない。
- **現時点では敵の速度ベクトルは公開しない**。上級者はtick間の位置差から推定できる。将来の拡張時は後方互換を保って追加する。

### 4.4 `Action`

```python
@dataclass(frozen=True)
class Action:
    move_x: float = 0.0
    move_y: float = 0.0
    target_enemy_id: int | None = None

    @staticmethod
    def flee(
        me: Vec2,
        danger: Vec2,
        attack_target_id: int | None = None,
    ) -> "Action": ...
```

`Action()`は**停止 + 攻撃対象なし**。移動と攻撃対象を1つのActionで同時に指定できる。

```python
Action(move_x=1, move_y=0)                   # 右移動・攻撃なし
Action(move_x=0, move_y=-1)                  # 上移動・攻撃なし
Action(target_enemy_id=5)                    # 停止して敵ID 5を狙う
Action(move_x=-1, target_enemy_id=5)         # 左移動しながら敵ID 5を狙う
Action()                                     # 移動なし・標的なし
```

**移動の意味**:

- `move_x`/`move_y`は**速度ではなく方向入力**。各成分が有限の実数であること。
- 長さが1を超える場合はゲーム側で正規化。`(3,4)`は`(0.6,0.8)`として扱う。
- 長さ0の場合は停止。長さが1未満ならその入力強度に比例した速度にする[MVP設計決定案]。
- 最大移動速度はゲーム側で固定（初期案160 unit/s）。
- 標的が有効かつ射程内で攻撃クールダウンが満了したら自動発射する。射程外なら攻撃しない（自動接近しない）。
- `target_enemy_id=None`では攻撃しない。敵が途中で倒れた場合、再判断まで自動で標的を変更しない。

**`Action.flee()`の厳密な意味**:

1. `(me.x-danger.x, me.y-danger.y)`という敵から離れるベクトルを求める。
2. 距離>0なら単位長へ正規化する。
3. 位置が完全一致なら、再現性のため`(1.0, 0.0)`を採用する[MVP設計決定案]。
4. `attack_target_id`を`Action.target_enemy_id`へ移す。
5. **障害物回避・安全ルート探索は行わない**。これは方向の便利ヘルパーにすぎず、上級者の独自戦略を妨げない。

### 4.5 Action検証 [MVP設計決定案]

| ケース | 結果 |
|---|---|
| 正常な`Action` | 適用して次の判断境界まで保持 |
| `None`や`str`等を返す | **無行動Action**に置換し診断ログ |
| NaN / Infinity / 非数値座標 | **無行動Action**に置換し診断ログ |
| 非存在/死亡済み敵IDの指定 | 境界時点で無効なら**無行動Action**に置換し診断ログ |
| `target_enemy_id`が`bool`/float/string | 無行動Actionに置換し診断ログ |
| 実行中に対象が撃破される | 移動を継続、射撃対象のみ失う。次回判断で更新可能 |
| `decide()`が例外送出 | **実行エラーとして一時停止**、トレースバックを表示 |
| 実行予算超過 | コード内容を問わず一律停止。Worker中断・必要なら再生成 |
| 実時間watchdog超過 | アプリ保護のためWorkerを強制停止。ゲーム規則上の予算判定とは区別 |

無効Actionは行動を壊さない**入力検証警告**として扱い、Python例外そのものとは区別する。ゲーム側でActionを構造検証し、Pythonからのオブジェクトをそのままシミュレーションメモリへ渡さない。

---

## 5. 関数リファレンス

### 5.1 `set_ai(controller) -> None`

**判断関数型を登録する。**

```python
from microgame import set_ai, Action

class MyAI:
    def __init__(self):
        self.counter = 0

    def decide(self, state):
        self.counter += 1
        return Action()

set_ai(MyAI())
```

- `controller`は呼び出し可能な`decide(state)`メソッドを持つPythonオブジェクト。
- `decide`は**同期関数**とし、`Action`を返す。`async def decide`はMVP対象外。
- 登録はRunの初期化中（初回境界の前）に一度。複数回登録・実行途中での変更は`ControlModeError`[MVP設計決定案]。
- 引数が適合しなければ`GameAPIError`。
- コントローラの属性は各境界間で保持される。

### 5.2 `get_state() -> Observation`

直近のAI境界時点のスナップショットを返す。

```python
from microgame import get_state

s = get_state()
print(s.tick, s.hp, len(s.enemies))
```

- `decide`内では引数`state`と同じ境界のデータ。
- 継続実行型では初期tick0から取得可能で、`wait_ticks()`からの再開時に更新される。
- アリーナ進行中のリアルタイム位置取得ではない（境界間の30TPS更新は見えない）。
- ランタイム未初期化状態なら`GameAPIError`。

### 5.3 `nearest_enemy() -> EnemyView | None`

`get_state().nearest_enemy`の便利版。敵がいなければ`None`。距離同率はID昇順。`decide`内でも読み取りだけなら利用可能。

### 5.4 `self_position() -> Vec2`

`get_state().position`の便利版。スライム自身の現在境界位置を返す。名前の`self`はPythonクラスの`self`とは無関係。

### 5.5 `act(action: Action) -> None` **[Spike必須]**

継続実行型の低水準行動関数。完全なActionを提出し、次のAI判断境界まで自動で待つ。

```python
act(Action(move_x=-1, move_y=0, target_enemy_id=5))
```

- Actionは現在の境界で検証・確定し、次の6 simulation tickに適用する。
- 呼び出した瞬間に座標・HP・敵状態を直接変更しない。
- 移動と攻撃対象を同じActionで同時に指定できる。
- `act`から戻った時点では次の境界のObservationへ更新されている。
- Controllerモードや`decide()`内では`ControlModeError`。ControllerはActionをreturnする。

### 5.6 `attack_nearest() -> int | None` **[Spike必須]**

継続実行型向けの**最も近い敵への標的指定**ヘルパー。

```python
id_or_none = attack_nearest()
```

- `nearest_enemy()`を確認し、存在すれば`Action(target_enemy_id=enemy.id)`、不在なら`Action()`を`act()`するのと等価。
- ターゲットのID、または敵がいなければ`None`を返す。
- Action提出後は次のAI判断境界まで自動で待つ。
- **即時に攻撃を実行する命令ではない**。実際の発射判定はSimulation側。
- このヘルパーが提出するActionの移動入力は`(0, 0)`。移動しながら狙う場合は`act(Action(...))`またはControllerを使う。
- Controllerモードや`decide`内では`ControlModeError`。

### 5.7 `wait_ticks(n: int) -> None` **[Spike必須]**

継続スクリプトの協調的な中断・再開命令。詳細なタイミングは§3.3。

```python
while True:
    attack_nearest()
    wait_ticks(24)  # 自動待機6tickに加え、さらに間隔を空けたい場合
```

- 見かけ上は同期関数。**Pythonのコールスタックとローカル変数を保って再開できる必要がある**。
- 通常の行動ループに`wait_ticks(6)`を毎回書く必要はない。
- 制御を返さず実行予算を超えた処理は、コード内容を問わず一律停止する。
- `n`が不正なら`InvalidWaitError`。`decide`内なら`ControlModeError`。
- 正しい実装方式が実証されるまでは、ゲーム全体のMVP実現性を保証しない。

---

## 6. エラーと診断

### 6.1 公開例外 [名称案]

```python
class GameAPIError(Exception): ...
class ControlModeError(GameAPIError): ...
class InvalidWaitError(GameAPIError): ...
class ExecutionBudgetExceeded(GameAPIError): ...
```

- `GameAPIError`: API呼び出しの不正、初期化外での利用、`set_ai`対象不正など。
- `ControlModeError`: Controller型とManual型の命令競合、`decide`内の`wait_ticks`等。
- `InvalidWaitError`: `wait_ticks(n)`の引数不正。
- `ExecutionBudgetExceeded`: 行動・待機・return・終了で制御を返す前に、決定論的な実行予算を使い切った。
- Python組み込みの`SyntaxError`/`ImportError`/`ZeroDivisionError`等はできる限り本来の名称で表示。
- `InvalidActionWarning`はユーザーへ返す**診断イベント名**の案であり、必ずしもPython内に投げる例外ではない。
- 重大な実行時エラーはゲームを停止し、**ファイル名・行番号・例外型・内容・現在tick**を表示する。
- Code Editorはエラー行を強調表示できること。

### 6.2 `print`・デバッグ

```python
print("HP:", get_state().hp)
```

- `print`の出力はフローティングConsoleへ配送する。
- 診断には可能な限りtickを添える。表示を止めるほど大量に出した場合は省略・集約の旨を明記。
- `print`自体は行動や乱数状態へ影響しない。
- `input()`、標準入力の対話プロンプト、PythonデバッガのブレークポイントはMVP対象外。

### 6.3 処理超過の扱い

- Pythonが応答を返さない場合、ゲームtickは進めない。
- 外部監視でtimeout等を検出したら、Workerを中断/破棄し、実行をエラー終了する。
- CPUが遅いPCでtimeoutに達したrunは、決定論が保証される**正常完走したrun**ではない。
- エラー後のRestartはPythonメモリを破棄し、固定seedで新規実行する。
- **制限値は未決**。Spikeで最大ファイルサイズ、実行時間/判断、Workerのメモリ、ログ上限を実測して固定する。

---

## 7. プロジェクトファイルとimport

### 7.1 最小プロジェクト

```text
player-project/
  main.py       # 唯一のエントリーポイント
  utils.py      # ユーザー定義モジュール
  strategy.py   # ユーザー定義モジュール
```

```python
# utils.py
def squared_distance(ax, ay, bx, by):
    return (ax - bx)**2 + (ay - by)**2
```

```python
# main.py
from microgame import Action, set_ai
from utils import squared_distance

class SlimeAI:
    def decide(self, state):
        enemies = state.enemies
        if not enemies:
            return Action()

        target = min(
            enemies,
            key=lambda e: squared_distance(
                state.position.x, state.position.y,
                e.position.x, e.position.y,
            ),
        )
        return Action(target_enemy_id=target.id)

set_ai(SlimeAI())
```

- プレイヤーファイルはアプリ内ワークスペースで管理し、実行時にPyodide仮想FS上の特定ディレクトリへコピーする想定。
- ファイル編集内容が正本。開いているエディタの数/順序はPython動作に影響しない。
- `main.py`は必須。`microgame.py`の作成は不可（内蔵API名の衝突回避）。
- MVPではルート直下の`name.py`を中心とし、入れ子のパッケージ/任意OSパス探索は保証しない。
- import順・Pythonモジュールキャッシュは1Run中保持。Restartで消去する。
- Pythonからワークスペース以外のWindowsファイルへ直接アクセスできる仕様にはしない。仮想FSのアクセス範囲は別途安全性検証する。

### 7.2 標準ライブラリ / Pythonバージョン

- 使用可能なのは組み込みランタイム（Pyodide採用ならその同梱版）に含まれ、実行環境で許可したモジュール。
- 優先検証モジュール: `math`、`collections`、`itertools`、`statistics`、`dataclasses`、`typing`、`heapq`。
- NumPyや任意`pip install`はMVPの保証範囲外。導入可能性は将来の最適化/拡張として別途検討。
- `time`・`datetime`・`random`・`secrets`など実時間や未管理乱数に依存するものは再現性の対象範囲を決めるまで非保証。`random`を使いたい場合は初期seedとその初期化手順を別Issueで規格化する。
- 外部ネットワーク、ブラウザJSブリッジ、任意ファイルI/Oを**公式ゲームAPIとして提供しない**。ただしPythonからの技術的アクセス経路が完全に消えると保証するものではなく、隔離設計は`ARCHITECTURE.md`のSpikeと`SECURITY.md`で検証する。
- 正式対応のPython/Pyodideバージョンは依存バージョンをpinした時点でREADMEとゲーム内ヘルプに記載する。

---

## 8. 境界・状態の細かな決定

### 8.1 Actionの保持と変更

- Actionは**AI境界でのみ確定**し、その後6 tick継続する。
- Manual型では`act(action)`または高水準行動関数が毎回Action全体を提出し、その呼び出しが次の境界まで自動待機する。部分更新バッファは持たない。
- Callback型では**毎回Action全体を返す**。前回Actionを部分更新しない。
- Actionはゲーム更新で使うだけ。プレイヤーが`Action`を返しても直接敵HPを書き換えることはできない。
- Manual型スクリプトが終了した場合、最後に確定したActionを保持し、ゲームは通常通り進行する[MVP設計決定案]。明示的に移動・攻撃を止めたい場合は`act(Action())`を使う。

### 8.2 境界ごとの処理順序

1. `Observation`生成（同一境界内では不変）。
2. 行動関数または`wait_ticks`から再開可能な継続処理を、実行予算内で実行（必要なら再度休止）。
3. Controllerが登録されていれば`decide(observation)`を実行。
4. Manualなら行動関数の引数から、Controllerなら戻り値からActionを組み立てる。
5. 不正Actionを検証/無行動化し、次の6 tickをSim側で更新。

どの段階でもシミュレーションが裏で進行してObservationが古くなることはない。

### 8.3 操作不能・勝敗・端境界

- `tick=0`以前、死亡後、クリア後のゲームAPI呼び出しは実行状態に従って拒否/終了する。
- スライムが死亡した境界/ステージ最終tickでは新しい判断を要求しない。
- `wait_ticks`の再開予定tickが1800以降ならステージ終了まで再開されない。
- ステージ最後のtickでHP0なら失敗。クリア/失敗はプレイヤーが返したActionとは別のゲーム側判定。
- `target_enemy_id`が途中で死亡してもゲームが任意の敵へ勝手に標的を変えない。

---

## 9. APIの互換性ポリシー

- MVP中は未公開開発段階だが、サンプルコードがなるべく壊れないよう公開APIの名前・引数をIssue横断で統一する。
- ユーザー向けAPIの変更時は`PYTHON_API.md`/`GAME_DESIGN.md`/サンプル/テストを**同一PR**で変更する。
- 破壊的変更はADRまたはIssueへ理由・移行コードを残す。
- APIを公開するゲーム内リファレンスは本書から生成/同期する方針を推奨。ゲームエンジン内部型を直接ドキュメント化しない。

---

## 10. テスト可能な受け入れ条件

| ID | 条件 |
|---|---|
| API-01 | `main.py`のサンプルAが明示的な`wait_ticks`なしで継続し、`attack_nearest()`ごとに6tick進む |
| API-02 | サンプルBで近距離条件により回避方向が変わる |
| API-03 | サンプルCで`decide`がtick 0/6/12...に呼ばれる |
| API-04 | 同じ`SlimeAI`インスタンスが残り、`self`の状態が維持される |
| API-05 | `wait_ticks(1)`→tick6、`wait_ticks(7)`→tick12（tick0から） |
| API-06 | `decide`とManual命令の混在を黙って処理せず`ControlModeError` |
| API-07 | `enemies`の順序と等距離の`nearest_enemy`判定がID昇順 |
| API-08 | NaN/不正ID/None等で無行動に置換、ログが出てワールドは破損しない |
| API-09 | `main.py`から`utils.py`をimportして正常実行できる |
| API-10 | 行動・待機・return前に予算を超える複数種類のコードを同じ規則で停止でき、Electron UI・編集内容が保たれる |
| API-11 | 同一ソース・固定seed・許可された入力で複数回の実行結果が再現する |
| API-12 | Pythonエラーのファイル名・行番号・tickを取得できる |
| API-13 | ゲームとPythonをオフラインWindows配布ビルドから起動できる |
| API-14 | camera zoom/editor位置変更は観測/Action/戦闘結果に影響しない |
| API-15 | ハイブリッド例で監視ログと判断関数を直列実行できる |
| API-16 | 状態確認やPython計算中はObservationとsimulation tickが変化せず、実行予算だけを消費する |
| API-17 | 6tickごとに攻撃対象を提出しても、実際の発射頻度はゲーム側クールダウンを超えない |

実装前にAPI-01、API-05、API-10、API-15、API-16は技術Spikeで検証し、不成立ならアーキテクチャの代替案と仕様差分を先に検討する。

---

## 11. 未決事項 / Spike後に確定する項目

1. **行動関数の自動待機と同期`wait_ticks`の継続・中断・再開・キャンセル方式**（最優先、Go/No-Goゲート）。
2. Pythonの正式バージョン、Pyodideのpinバージョン、エラー行番号の品質。
3. 決定論的な実行予算の計数単位・初期値、実時間watchdog、メモリ上限、最大ソースサイズ、ログ表示/保存の上限。
4. 標準ライブラリの保証セットと安全なモジュール制限の実装可能性。
5. Python`random`への固定seed注入方式と対応範囲（MVP必須ではない）。
6. APIオブジェクトの本番実装（`dataclass`等）および性能計測。
7. 射程・HP・移動速度・敵出現の細かな数値は`GAME_DESIGN.md`に従いプレイテストで調整。

**原則**: 「Pythonを学ぶための制約」は最小限に、ゲーム世界の公平性・再現性・OSの安全のための制限は明示する。技術上の妥協は隠さず、プレイヤーの体験とAPI互換性への影響を記録する。
