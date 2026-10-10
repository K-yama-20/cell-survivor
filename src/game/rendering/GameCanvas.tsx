import Phaser from 'phaser'
import { useEffect, useRef } from 'react'

import { getFoundationLayout } from './foundation-layout'

class FoundationScene extends Phaser.Scene {
  private background?: Phaser.GameObjects.Graphics
  private slime?: Phaser.GameObjects.Container

  create(): void {
    this.background = this.add.graphics().setDepth(-1)
    this.slime = this.add.container(0, 0, [
      this.add.circle(0, 0, 34, 0x77e5b5),
      this.add.circle(-10, -8, 4, 0x071018),
      this.add.circle(10, -8, 4, 0x071018),
    ])

    this.resizeToViewport(this.scale.gameSize)
    this.scale.on(Phaser.Scale.Events.RESIZE, this.resizeToViewport, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.resizeToViewport, this)
    })
  }

  private resizeToViewport(gameSize: Phaser.Structs.Size): void {
    if (!this.background || !this.slime) return

    const layout = getFoundationLayout(gameSize.width, gameSize.height)

    this.background.clear()
    this.background.fillGradientStyle(0x06131b, 0x0c2730, 0x12272f, 0x071018, 1)
    this.background.fillRect(0, 0, layout.width, layout.height)
    this.slime.setPosition(layout.centerX, layout.centerY)
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
