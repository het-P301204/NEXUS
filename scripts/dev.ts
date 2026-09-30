import { spawn } from 'node:child_process'
import path from 'node:path'

/**
 * npm run dev -- the API server (node, with --watch) and the Vite dev server,
 * side by side, without a shell and without a process-manager dependency.
 * Ctrl+C stops both.
 */

const root = path.resolve(import.meta.dirname, '..')
const node = process.execPath

const procs = [
  {
    name: 'api',
    child: spawn(node, ['--watch-path=server', '--watch-path=lib', '--watch-path=rules', '--watch-path=types', '--watch-path=data', 'server/index.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }),
  },
  {
    name: 'web',
    child: spawn(node, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }),
  },
]

for (const { name, child } of procs) {
  const prefix = name === 'api' ? '\x1b[33m[api]\x1b[0m ' : '\x1b[36m[web]\x1b[0m '
  const write = (stream: NodeJS.WriteStream) => (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) stream.write(prefix + line + '\n')
  }
  child.stdout?.on('data', write(process.stdout))
  child.stderr?.on('data', write(process.stderr))
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`)
    for (const p of procs) if (p.child !== child) p.child.kill()
    process.exit(code ?? 0)
  })
}

const stop = () => {
  for (const p of procs) p.child.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
