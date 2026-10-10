# ARCHITECTURE.md — Micro Survivor（仮題）技術アーキテクチャ

> **ステータス**: MVP技術設計 v0.1（2026-10-09）  
> **関連文書**: [PRODUCT.md](./PRODUCT.md) / [GAME_DESIGN.md](./GAME_DESIGN.md) / [PYTHON_API.md](./PYTHON_API.md)  
> **目的**: 「どのモジュールが何を担当するか」「データがどこを通るか」「何をテストで保証するか」を定義し、Issue分割・Codex実装時の判断基準にする。  
> **表記**: **[確定]**=合意済み要件、**[設計決定案]**=この文書で提案する具体方式、**[Spike必須]**=実装着手前の技術検証事項。技術選定は、Spikeの結果により見直す。

---

## 1. 前提と対象範囲

| 領域 | MVPの方針 |
|---|---|
| 製品 | Windows 64-bit向けSteam販売を見据えたオフラインPCゲーム [確定] |
| 世界 | スライム1体 / 細菌 / 1ステージ / 60秒生存 [確定] |
| 描画・アプリ | Electron + React + Phaserを第一候補、Monaco Editorを採用する案 [確定：第一候補] |
| Python | プレイヤーが本物のPythonを可能な範囲で使う。Pyodide第一候補 [確定：要件、方式は検証待ち] |
| AI | `decide(state)`判断関数型と、行動関数が次の6 tick境界まで自動待機する継続実行型を両方使える [確定：要件] |
| 時間 | 固定30 tick/秒、AI判断境界は6 tickごと、1800 tickで60秒 [既存GAME_DESIGNの初期値案] |
| RNG | ステージ固有seed固定。MVPにseed変更UIはない [確定] |
| UI | 画面全面のゲーム + 自由配置/複数表示のフローティングエディタ、ズーム・パン [確定] |
| ゲーム性 | 学習は裏目的。初学者は短いコード、上級者は任意の戦略を組める [確定] |

**非目標**: ネットワークサービス、ユーザー認証、Steam Cloud、複数スライム協調、オンラインランキング、自由な`pip install`、ゲーム中のホットリロード、完全な任意Python互換。

仕様間で優先する順序は、合意したプロダクト要件 → `GAME_DESIGN.md`のゲームルール → `PYTHON_API.md`の外部公開契約 → 本書の内部実装案。衝突を発見した場合は黙って片方を変更せず、Issueで整理する。

---

## 2. 技術選定と責務

| 技術 / 層 | 担当 | 担当しないこと |
|---|---|---|
| Electron Main | ウィンドウ生成、アプリ寿命、保存先、Windows配布、IPC権限検証 | ゲームルールやPython評価 |
| Electron Preload | レンダラーに許可した保存等の最小APIを公開 | 汎用の`ipcRenderer`/`fs`を直接公開 |
| React / TypeScript | メニュー、HUD、ウィンドウ管理、ファイル一覧、ログ、実行コントロール | 敵AIやゲームtickの更新 |
| Monaco Editor | `.py`の編集・行番号・シンタックス表示・エラー位置表示 | Pythonの実行・ゲーム判断 |
| Phaser | スライム/敵/弾の描画、カメラ、ズーム・パン、視覚演出 | ゲームの真の状態、乱数、HP確定 |
| Simulation Core（純TS） | `step(prevState, action)`、敵/弾/衝突/勝敗、固定順序・固定RNG | DOM、Phaser、Electron、実時間による判断 |
| Game Session Coordinator | Run/Pause/Resume/Stop/Restart、tick進行の同期、AI境界でのbarrier | Pythonの評価、UIの見た目 |
| Python Runtime Adapter | Pythonとの通信、snapshot/action変換、エラー整形、timeout/再起動 | 直接のゲーム状態変更 |
| Pyodide Web Worker | プレイヤーPythonの評価・モジュール読み込み・AI状態保持 | Electron API、ホストOSへのアクセス |
| Local Persistence | Pythonファイル、ワークスペース配置、設定の安全な保存 | 実行中ワールドの正本化 |

[設計決定案] シミュレーションは**Phaser非依存の純TypeScript**で実装し、原則`simulation.worker.ts`で実行する。Phaserはそのスナップショットを描画するだけ。UIの操作でゲームルールが変わらない構造を守る。

---

## 3. 全体構成

```text
Windows desktop
└─ Electron Main Process（権限を持つ境界）
   ├─ ファイル永続化（app userData配下、IPCバリデーション）
   ├─ app:// 等のローカルアセット配信 [Spike: resource scheme]
   └─ BrowserWindow（nodeIntegration=false / contextIsolation=true / sandbox=true）
      ├─ preload.ts（保存・読み込みの限定APIのみ）
      └─ Renderer（React）
         ├─ Fullscreen Phaser Canvas（描画 + Camera）
         ├─ Floating Window Manager（位置・サイズ・z-index）
         │  ├─ Monaco(main.py)
         │  ├─ Monaco(utils.py)
         │  └─ Console / File Explorer / HUD
         ├─ Editor Workspace Store（単一ファイル=単一内容）
         └─ GameSessionCoordinator
            ├─ Simulation Worker ←純粋な固定tickエンジン
            └─ Python Worker ←Pyodide + microgame module
                         ↑ Observation（read-only snapshot）
                         ↓ Action / commands（validated input）
```

`GameSessionCoordinator`はメッセージ順序を一元化し、Simulation WorkerとPython Workerが競合してワールドを進めないようにする。必要に応じて`MessageChannel`に置き換えられるが、MVPはコーディネータ経由で十分。

### 3.1 重要な依存方向

```text
PhaserView ───────→ RenderSnapshot / CameraState
React UI ─────────→ SessionController API
Python Worker ────→ ObservationDTO / ActionDTO のみ
Simulation Core ←── 検証済み ActionDTO / SeededRngState
```

- `simulation/`から`phaser`・`react`・`electron`・`window`をimportしない。
- `python/`からPhaserのScene/Entity参照を渡さない。
- Pythonに渡すのは構造化コピー可能なJSON互換DTOであり、JS関数やDOMハンドルは渡さない。
- UIレイアウト・ズーム・FPS・PC時計は`step()`の入力ではない。
- `main.py`以外のファイルを開いても実行順序は変わらない。実行されるのはワークスペースから作る単一のソーススナップショット。

---

## 4. 実行ライフサイクルとメッセージ契約

### 4.1 セッション状態

```text
IDLE → LOADING → READY → RUNNING ↔ PAUSED
                      ├→ FINISHED (clear / failed)
                      ├→ ERROR
                      └→ STOPPED → IDLE
```

- **Run**: 現時点の`.py`ファイルをスナップショット化し、前回のランタイムを破棄して新しいPython状態・simulation state・固定RNGを作成する。
- **Pause**: シミュレーションの論理時計を止める。現在進行中のPython処理は安全な境界で停止させる（重い同期処理を瞬時に中断できるという意味ではない）。
- **Resume**: 同じtickから継続。Pythonやsimulation stateを再初期化しない。
- **Stop**: 実行を破棄してコード編集可能にする。超過実行中のWorkerは強制terminate可能であること。
- **Restart**: 固定seed、tick=0、初期キャラ/敵、Python interpreterとユーザーのグローバル状態をすべて初期化する。コード・エディタ位置は保持。
- **Run中の編集**: 初期MVPでは編集をロック。スナップショットの混在・hot reloadは行わない。

### 4.2 AI境界での同期（6 tick）

```text
tick 0: Observation(tick=0) → Python boundary → Action(0) 確定
        ↓ step(0), step(1), ... step(5)
tick 6: Observation(tick=6) → Python boundary → Action(6) 確定
        ↓ step(6), ... step(11)
tick 12: ...
...
tick 1799: 最終の物理・ダメージ判定
tick 1800: 結果確定（最終tickの被害でHP0なら失敗）
```

境界の処理順序 [設計決定案]:

1. Simulation Workerから境界tickのワールドスナップショットを取得する。
2. Python Worker内の期限到達済み継続処理を再開し、実行予算内で行動提出・任意の`wait_ticks()`・終了のいずれかまで進める。行動関数は次の判断境界まで自動で休止する。
3. 登録済みの`decide(observation)`があれば、同じスナップショットで1回だけ実行する。継続処理と判断関数を同時に動作させず、1つのPython Workerで直列化する。
4. 行動が妥当か検証し、**制御権は1つ**の規則に従って適用する（`PYTHON_API.md`参照）。
5. 行動を固定して6回だけSimulation Coreをstepする（各tick内部の細かい順序は`GAME_DESIGN.md` §5.2）。
6. 最新の描画用スナップショットをPhaserへ送る。render補間は読み取り専用。
7. 死亡か1800 tick到達で終了し、再度Pythonを呼ばない。

**barrier規則**: Python応答を待っている間に、ゲームtickは進めない。CPU速度の違いでActionが適用されるtickをずらさない。実時間のtimeoutはゲームルールではなく異常終了条件とする。

### 4.3 メッセージ例（TypeScript、概念契約）

```ts
type Envelope<T> = {
  sessionId: string;       // 古いRunの結果を破棄するための識別子
  requestId: number;       // 単調増加、応答対応付け
  type: string;
  payload: T;
};

type ObservationDTO = {
  tick: number;
  hp: number;
  max_hp: number;
  position: { x: number; y: number };
  enemies: Array<{
    id: number;
    kind: "chaser" | "runner";
    position: { x: number; y: number };
    hp: number;
    distance: number;
  }>;
  nearest_enemy_id: number | null;
};

type ActionDTO = {
  move_x: number;
  move_y: number;
  target_enemy_id: number | null;
};
```

`ObservationDTO.nearest_enemy_id`は転送用。Python側ではこれを`state.nearest_enemy: EnemyView | None`として公開する。転送プロトコルとPythonユーザーAPIの表現を混同しない。

```text
Renderer → Simulation Worker: init(seed), advance(actions, count), reset(), snapshot()
Renderer → Python Worker: initialize(files, config), boundary(observation), terminate()
Python Worker → Renderer: boundary_result(action, diagnostics), runtime_error(...), stdout(...)
Simulation Worker → Renderer: state_snapshot(...), game_result(...)
```

すべてのメッセージはスキーマ検証する。古い`sessionId`、重複`requestId`、未来tickのAction、未知のメッセージ型は破棄/エラーとする。大量のログはまとめて送信し、UIを詰まらせない。

---

## 5. Python実行方式と技術Spike

### 5.1 二つの表面APIと一つの内部行動表現

- **判断関数型**: `set_ai(controller)`で登録し、`controller.decide(state) -> Action`を6 tickごとに呼び出す。状態は同一Pythonオブジェクトに保持できる。
- **継続実行型**: `act(Action)`や`attack_nearest()`等で完全なActionを提出する。行動関数は次の6 tick判断境界まで同期的に自動休止し、`wait_ticks(n)`は追加待機や無行動待機にだけ使う。
- **ハイブリッド**: メインスクリプトでAIを登録したあと`wait_ticks()`でログや監視を実行できる。ただし登録済みAIと継続側の行動命令は競合させない（`act()`等を呼んだ場合は`ControlModeError`）。
- **内部表現**: すべての操作を1境界あたり`ActionDTO` 1個へ集約する。物理更新自体は同一経路。
- **時間と予算**: 状態確認とPython計算は決定論的な実行予算を消費するが、Observationとsimulation tickは固定する。行動・待機・return・終了で制御を返す前に予算を使い切ったコードは、内容を問わず同じ理由で一律停止する。

### 5.2 Pyodide導入で確認済みと言えること / まだ言えないこと

PyodideにはWeb Worker内でPythonを評価する使い方がある。ただし**通常の同期Python関数を呼ぶだけで、任意の`while True`を途中から再開できるわけではない**。行動関数の自動待機と`wait_ticks()`の双方で、再開可能な処理単位の設計が別途必要。

**最優先Spike**（Issue #3〜#4相当）:

1. Windows Electron製品ビルドからローカル同梱Pyodideをオフラインロードできる。
2. `decide(state)`を1000回以上呼び出し、同じAIオブジェクトが状態を維持する。
3. `while True`内の行動関数が、ループ中のローカル変数を保ったまま次の6 tick判断境界まで自動で中断/再開できる方式を実証する。
4. 任意の`wait_ticks(1)`がtick 6、`wait_ticks(7)`がtick 12で再開する。
5. 状態確認やPython計算中は世界を進めず実行予算だけを消費し、予算内に制御を返さない複数種類のコードを内容によらず一律停止できる。実時間watchdogでも編集内容を失わずRestart可能。
6. `utils.py`等のimport、`math`/`dataclasses`/クラス/関数/再帰が動く。
7. ゲーム・Python・エディタの処理を分離し、ロック時もUIでStopを操作できる。
8. 許可しない外部通信・ホストファイルアクセスの到達可能性を検証し、権限境界を確認する。
9. 再現テストに合格し、デプロイ時にCDNへ依存しない。

**実装案の比較対象**: (a)制約付き同期継続を安全な中断点へ変換するアダプタ、(b)明示的なPythonコルーチンでの協調スケジューリング、(c)必要なら別のPythonランタイム/実行モデル。**(b)は`async/await`等の記法変更を伴うため、既存の同期的な行動関数/`wait_ticks`契約を勝手に変更してはならない。** Spikeが失敗した場合は選択肢と影響をIssue/ADRへ明記し、合意してAPI文書を更新する。

### 5.3 一般Pythonの自由度と限界

- Python構文全般を活かすことを目指すが、全標準ライブラリ・ネイティブ拡張・外部パッケージの完全互換は約束しない。
- まず`math`、`collections`、`itertools`、`dataclasses`、`typing`等の純粋な計算系を検証する。
- `time`・外部I/O・JSへのアクセス・並列処理・Python側の乱数は、再現性と安全性の対象を明示したうえで段階的にサポートする。
- 完全な決定論は「同じビルド・同じ許可された入力・同じ環境・ゲーム時刻で再現性保証対象のコード」に対して求める。超過実行・外部非決定的要因は別扱い。

---

## 6. シミュレーションと再現性

### 6.1 State / Step / RNG

```ts
type SimulationState = {
  tick: number;
  phase: "playing" | "cleared" | "failed";
  slime: SlimeState;
  enemies: EnemyState[];
  bullets: BulletState[];
  stats: Statistics;
  rngState: number;
  nextEntityId: number;
  currentAction: ActionDTO;
};

function step(state: Readonly<SimulationState>): SimulationState;
```

`step()`は状態に保持した`currentAction`を使う。外から`Date.now()`、`Math.random()`、Phaserのphysics結果、カメラ倍率を読み込まない。実装上は不変更新を推奨するが、性能最適化時も外部から見た遷移は同じにする。

- 初期seedは定数またはステージ定義の固定値（MVP中にユーザー選択不可）。
- 疑似乱数はアルゴリズムと生成順を固定し、状態に保存する。
- 衝突・ターゲット候補・弾命中はEntity IDの昇順とする。
- 距離同値ならIDの小さい敵を優先。
- Stage完了判定はtick 1799まで更新した後に行い、最終tickのダメージでHP0なら失敗。
- 同じ入力のリプレイは、tickごとの状態hashか部分hashで検証する。
- ズーム、パン、editor操作はActionを生成せず、状態hashを変えてはならない。

### 6.2 描画

Simulation Workerが書き出すRenderSnapshotをPhaserへ渡す。Phaser Sceneで実体のアニメーションや補間表示を行ってよいが、表示結果をゲームの当たり判定へ書き戻さない。30TPSと60FPSは独立である。フレームが落ちても勝手にゲームtickを飛ばさない。

---

## 7. フローティングUI / ファイルワークスペース

### 7.1 レイヤー

```text
Renderer root
├── Phaser Canvas（position: fixed; inset: 0; 全領域）
├── Window Layer（エディタ/ファイル一覧/コンソール、z-index管理）
└── HUD / Game Controls / Modal Layer（常に操作可能）
```

エディタはElectronのOSウィンドウではなく**Reactコンポーネント**。Monacoは各ウィンドウに存在しても、同じファイルを編集する場合はファイルモデルを共有する。UIは基本ゲーム上に重ね、右左の固定分割にしない。

### 7.2 Window Managerの状態 [設計決定案]

```ts
type EditorWindowState = {
  windowId: string;
  fileId: string;
  x: number; y: number;
  width: number; height: number;
  zIndex: number;
  minimized: boolean;
};
```

- 作成/移動/リサイズ/最前面化/最小化/閉じる/再表示。
- 閉じる＝ビューを閉じるだけ。ファイル削除ではない。
- 画面外に完全に消えたウィンドウの復旧コマンドを提供。
- レイアウト保存時に実画面解像度に合わせて表示領域にクランプする。
- エディタにフォーカス中はキーボードショートカットをゲームへ流さない。
- エディタ内ホイールはテキストスクロール、キャンバス内ホイールはズーム。中ボタン/Spaceドラッグでパン、`F`でスライムへフォーカス（入力フォーカス外のみ）。
- カメラの推奨初期範囲は0.15〜4倍、プレイテストで調整。CameraStateはセーブ可能だがシミュレーションへ渡さない。

### 7.3 エディタワークスペース

```ts
type PlayerFile = { name: string; source: string; };
type PlayerProject = { schemaVersion: 1; files: PlayerFile[]; };
```

- `main.py`はエントリーポイント。`utils.py`・`strategy.py`等を任意に追加できる。
- ファイル名は安全な相対名（例: `^[a-zA-Z_][a-zA-Z0-9_]*\.py$`）に制限する案。フォルダ/パッケージ構成はMVP後に拡張可能。
- 保存はUIが保持するProjectが正本。Pyodideの仮想FSは実行時に生成されるコピー。
- 同名ファイルは禁止し、`main.py`は存在必須。内蔵`microgame`モジュール名の上書きは禁止。
- 実行直前にソースを凍結し、Python Workerへファイル群を転送。プレイ中のファイル内容変更は行わない。

---

## 8. 保存・配布・セキュリティ

### 8.1 永続化

- Electron Mainが`app.getPath('userData')`以下の専用領域へProjectとUI Layoutを保存する案。
- レンダラーから`readProject` / `saveProject` / `readLayout` / `saveLayout`の限定IPCのみを公開し、パス指定は許さない。
- 保存はスキーマとサイズ上限を確認し、一時ファイル→置換などで破損を低減。壊れたファイルは明示エラーで保護。
- 個人コードをサーバーへ送信しない。OSの任意ファイルへのアクセスAPIをPythonへ渡さない。
- MVPはWindowsに同梱するデータのみでオフライン起動・実行できること。PyodideのWASM/stdlib等をCDNから取得しない。

### 8.2 Electronの信頼境界

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`。
- 可能なら`file://`に依存せず、権限を限定したカスタムアプリプロトコルを利用 [Spike]。
- Preloadで`ipcRenderer`やファイルシステムの生APIを公開しない。IPC引数・送信元をMainで検証。
- Content Security Policy、外部へのナビゲーション/新規ウィンドウ/権限要求の制限、不要な外部通信を遮断。
- Python Workerは**OSのセキュリティ境界として完全ではない**。`js`/`pyodide`連携や仮想FSなどの到達可能性を攻撃的テストで調べる。
- Pythonエディタでのコード実行は常にローカル扱い。外部から提供されたPythonを安全だと保証しない。危険な制約回避を封じきれなければ販売前に設計を再考する。
- CPU/メモリの異常使用に備え、Worker停止・プロセス再生成・メモリ監視・異常終了表示を検証する。

### 8.3 パッケージング

- Windows x64実行物/インストーラをCIまたはWindows環境でビルド。
- Electronアセット、Phaser描画資源、Monaco、Pyodideの必要なwasm/stdlib/モジュールを同梱。
- `electron-builder`等でパッケージ化。開発サーバーへの依存、外部CDNへの実行時アクセスはゼロ。
- Steamへの登録・SDK連携は製品化タスク。MVPではSteamオーバーレイ/実績/Cloudは必須にしない。

### 8.4 公式参照（技術実装時に最新版を再確認）

- Electron Security: https://www.electronjs.org/docs/latest/tutorial/security/
- Electron Context Isolation: https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Pyodide Web Worker: https://pyodide.org/en/stable/usage/webworker.html
- Pyodide API: https://pyodide.org/en/stable/usage/api/js-api.html
- Electron Builder: https://www.electron.build/docs/nsis/

---

## 9. 推奨ディレクトリ構造

```text
micro-survivor/
├─ README.md
├─ AGENTS.md
├─ docs/
│  ├─ PRODUCT.md
│  ├─ GAME_DESIGN.md
│  ├─ ARCHITECTURE.md
│  ├─ PYTHON_API.md
│  ├─ SECURITY.md             # 後続Issue
│  ├─ TEST_STRATEGY.md        # 後続Issue
│  └─ ROADMAP.md              # 後続Issue
├─ electron/
│  ├─ main.ts
│  ├─ preload.ts
│  └─ persistence/
├─ src/
│  ├─ renderer/
│  │  ├─ App.tsx
│  │  ├─ windows/
│  │  ├─ editor/
│  │  ├─ game-view/          # Phaser Scene / Camera / RenderAdapter
│  │  └─ console/
│  ├─ simulation/
│  │  ├─ core/               # Phaser非依存の純TS
│  │  ├─ enemies/
│  │  ├─ systems/
│  │  └─ simulation.worker.ts
│  ├─ runtime/
│  │  ├─ session-controller.ts
│  │  ├─ python.worker.ts
│  │  ├─ python-adapter.ts
│  │  └─ microgame/         # Python APIのバンドルソース
│  ├─ shared/
│  │  ├─ contracts.ts
│  │  ├─ schemas.ts
│  │  └─ constants.ts
│  └─ persistence/
├─ tests/
│  ├─ simulation/
│  ├─ runtime/
│  ├─ ui/
│  └─ e2e/
└─ .github/workflows/
```

実装初期の小規模Issueではフォルダを全部空で生成する必要はない。モジュール境界を壊さず、必要になったとき段階的に配置する。

---

## 10. 品質ゲート / 受け入れテスト

### 10.1 自動テスト

| 対象 | テスト |
|---|---|
| Simulation Core | 固定seed・記録Action列で全tickのstate hashが一致する |
| 時間 | 0〜1799を正しく処理し、60秒境界で勝敗確定、最終被ダメージを優先 |
| Action | NaN/Infinity/未知ID/不正型で状態破損しない |
| Runner | `decide()`を連続呼び出し、クラス状態が保持される |
| Runner | `act(Action)`や高水準行動関数が明示的な待機なしでtick 0→6に中断・再開する |
| Runner | `wait_ticks(1/6/7)`をtick 6/6/12に同期して再開 |
| 実行予算 | 状態確認・計算中に世界は進まず、異なる非yieldコードが内容によらず同じ予算超過で停止する |
| 停止 | 実時間watchdog超過時もゲームUI応答とStop/Restartが維持される |
| ワークスペース | `main.py`から`utils.py`をimport、ファイル保存/再起動復元 |
| UI | 複数エディタのドラッグ/リサイズ/前面化/復旧。ズームと入力フォーカスの分離 |
| 決定論 | Window移動/ズーム/Pauseの有無でゲームstate hashが変わらない |
| 配布 | 別Windows環境・ネットワークOFFで起動→Python実行→保存→Restart |

最低限CIで`lint` / `typecheck` / unit tests / build、主要PRで統合テストを実行。Python Workerのリソース・隔離検証は単体テストだけで代替しない。

### 10.2 性能と限界値（まだ実測していない）

- 描画目標60FPS、30TPSを基本とするが、性能評価環境と許容遅延は後続Issueで固定する。
- Python Worker初期ロード時間、メモリ、最大コードサイズ、ログ量、エディタ数の実用範囲はSpikeで実測し閾値を決める。
- `timeout`は**エラー処理の上限**であってゲーム内時間ではない。閾値がPC性能差で結果に影響するケースは「成功した決定論的実行」の保証対象外と明記する。

---

## 11. ADR（設計判断の記録）とゲート

| ADR候補 | 現状 | 決定に必要な証拠 |
|---|---|---|
| ADR-001 Electron + React + Phaser | 第一候補 | Windowsオフライン起動、UI/2Dパフォーマンス |
| ADR-002 Pyodide Web Worker | 第一候補 | moduleロード、isolated runner、Python自由度 |
| ADR-003 行動自動待機・継続実行・実行予算 | **未決・最重要** | 同期行動API、任意`wait_ticks`、決定論的予算を一般Python構文と組み合わせたPoC |
| ADR-004 Sim Worker / fixed tick | 本書の設計決定案 | 同一Action列で再現・性能測定 |
| ADR-005 安全モデル | **未決・販売前必須** | レンダラー/Worker権限確認、悪意あるPythonテスト |

**実装を始める順**: (1) Pythonの判断関数 + Worker → (2) 同期継続実行Spike → (3) Game Core + bridge → (4) UI/保存 → (5) Windows配布。Spike結果によって設計の変更が必要なら、この文書と`PYTHON_API.md`を同じPRで改訂する。

---

## 12. MVP受け入れチェックリスト

- [ ] PhaserなしでSimulation Coreの1,800 tickを再現・テストできる。
- [ ] 同じコード/固定seed/同じランタイムから同じ結果が出る（検証対象のPythonコード）。
- [ ] PythonからHPやPhaserオブジェクトを直接書き換えられず、Actionのみが反映される。
- [ ] 判断関数と、行動関数が自動待機する同期継続実行の両方を実際に動かせる。
- [ ] 競合するコントローラの命令を明確に拒否する。
- [ ] 予算内に制御を返さない任意のコードを同じ規則で停止し、ゲーム本体とファイル内容を失わず再実行できる。
- [ ] `main.py`+追加モジュールのimportが機能する。
- [ ] 全画面ゲーム + 複数フローティングエディタ + カメラ操作が独立する。
- [ ] Windows製品ビルドをオフラインで起動・プレイ・保存できる。
- [ ] 上記が成立しなければ理由と代替をADRに記録し、勝手に要件を縮小しない。
