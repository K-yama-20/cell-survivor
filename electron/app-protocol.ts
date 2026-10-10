export function resolveAppAssetPath(requestUrl: string): string | undefined {
  const url = new URL(requestUrl)
  if (url.protocol !== 'app:' || url.hostname !== 'bundle') return undefined

  const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  const segments = relativePath.split('/')
  if (
    relativePath.length === 0 ||
    relativePath.includes('\\') ||
    relativePath.includes('\0') ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    return undefined
  }
  return relativePath
}
