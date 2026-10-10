import { GameCanvas } from './game/rendering/GameCanvas'

export function App() {
  return (
    <main className="app-shell">
      <GameCanvas />

      <section className="hud" aria-label="ゲーム状態">
        <span>HP 100 / 100</span>
        <span>TIME 00:00</span>
        <span>KILLS 0</span>
        <button type="button" disabled>
          Run（準備中）
        </button>
      </section>

      <section className="editor-window" aria-label="main.py エディタの仮表示">
        <header>
          <span>main.py</span>
          <span className="status">foundation</span>
        </header>
        <pre>{`from microgame import *\n\nwhile True:\n    attack_nearest()\n    wait_ticks(6)`}</pre>
        <p>Monaco EditorとPython実行環境はROADMAP Issue 03・12で追加します。</p>
      </section>
    </main>
  )
}
