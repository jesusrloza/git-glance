import { stat, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { projectRoot } from './config.ts'
import { parseWindowArgs, windowFlagsUsage } from './window-args.ts'

const PREFERRED_PORT = 4173

function usage(): string {
  return `Usage:
  bun run preview
  bun run preview --all-time
  bun run preview --month YYYY-MM
  bun run preview --last-month

Serves an already-generated report under out/<window>/ without regenerating.
Defaults to last-30d. A folder name still works: bun run preview -- 2026-09

To generate then open in one step, use bun run view with the same window flags.

${windowFlagsUsage()}
`
}

/** Folder under out/ for the same window flags report uses, or one positional label. */
export function previewFolderLabel(args: string[], usageText = usage()): string {
  const only = args[0]
  if (args.length === 1 && only !== undefined && !only.startsWith('-')) return only
  const spec = parseWindowArgs(args, usageText)
  return spec.kind === 'all-time' ? 'all-time' : spec.window.label
}

function safeJoin(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const rel = decoded.replace(/^\/+/, '')
  const filePath = resolve(root, rel)
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (filePath !== root && !filePath.startsWith(prefix)) return null
  return filePath
}

function insideRoot(root: string, filePath: string): boolean {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  return filePath === root || filePath.startsWith(prefix)
}

async function responseFor(root: string, realRoot: string, urlPath: string): Promise<Response> {
  let pathname = urlPath
  if (pathname === '/' || pathname.endsWith('/')) pathname += 'index.html'

  const candidate = safeJoin(root, pathname)
  if (!candidate) return new Response('Forbidden', { status: 403 })

  let realFile: string
  try {
    realFile = await realpath(candidate)
  } catch {
    return new Response('Not found', { status: 404 })
  }
  if (!insideRoot(realRoot, realFile)) return new Response('Forbidden', { status: 403 })

  const info = await stat(realFile)
  if (info.isDirectory()) {
    const next = pathname.endsWith('/') ? pathname : `${pathname}/`
    return responseFor(root, realRoot, next)
  }
  if (!info.isFile()) return new Response('Not found', { status: 404 })
  return new Response(Bun.file(realFile))
}

function listen(root: string, realRoot: string) {
  const fetch = (req: Request) => responseFor(root, realRoot, new URL(req.url).pathname)
  const options = { hostname: '127.0.0.1', fetch }
  try {
    return Bun.serve({ ...options, port: PREFERRED_PORT })
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined
    if (code === 'EADDRINUSE') return Bun.serve({ ...options, port: 0 })
    throw err
  }
}

function onStop(server: ReturnType<typeof Bun.serve>) {
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    server.stop(true)
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

async function main() {
  const label = previewFolderLabel(Bun.argv.slice(2))
  const outRoot = resolve(projectRoot, 'out')
  const outDir = resolve(outRoot, label)
  if (!insideRoot(outRoot, outDir) || !existsSync(outDir)) {
    throw new Error(`Missing ${outDir}. Run bun run report (or bun run view) first.`)
  }

  const realRoot = await realpath(outDir)
  const server = listen(outDir, realRoot)
  console.log(`Serving ${outDir}`)
  console.log(`http://127.0.0.1:${server.port}`)
  if (server.port !== PREFERRED_PORT) {
    console.log(`Port ${PREFERRED_PORT} is in use; using ${server.port}.`)
  }
  onStop(server)
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
