import Phaser from 'phaser'
import { useEffect, useRef } from 'react'

class FoundationScene extends Phaser.Scene {
  create(): void {
    const { width, height } = this.scale
    const graphics = this.add.graphics()
    graphics.fillGradientStyle(0x06131b, 0x0c2730, 0x12272f, 0x071018, 1)
    graphics.fillRect(0, 0, width, height)

    this.add.circle(width / 2, height / 2, 34, 0x77e5b5)
    this.add.circle(width / 2 - 10, height / 2 - 8, 4, 0x071018)
    this.add.circle(width / 2 + 10, height / 2 - 8, 4, 0x071018)
  }
}

export function GameCanvas() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hostRef.current) return undefined

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      backgroundColor: '#071018',
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: '100%',
        height: '100%',
      },
      scene: FoundationScene,
      render: { antialias: true },
    })

    return () => game.destroy(true)
  }, [])

  return <div className="game-canvas" ref={hostRef} aria-label="ゲーム画面" />
}
