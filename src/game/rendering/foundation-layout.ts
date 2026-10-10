export type FoundationLayout = Readonly<{
  width: number
  height: number
  centerX: number
  centerY: number
}>

export function getFoundationLayout(width: number, height: number): FoundationLayout {
  return {
    width,
    height,
    centerX: width / 2,
    centerY: height / 2,
  }
}
