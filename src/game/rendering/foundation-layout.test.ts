import { describe, expect, it } from 'vitest'

import { getFoundationLayout } from './foundation-layout'

describe('foundation scene layout', () => {
  it.each([
    { width: 1280, height: 720 },
    { width: 960, height: 540 },
    { width: 1600, height: 900 },
  ])('fills a $width x $height viewport and keeps the marker centered', ({ width, height }) => {
    expect(getFoundationLayout(width, height)).toEqual({
      width,
      height,
      centerX: width / 2,
      centerY: height / 2,
    })
  })
})
