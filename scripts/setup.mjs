// One-time setup: checks prerequisites, prepares .env, installs dependencies,
// creates the database, and builds the web app. Safe to re-run.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const useShell = process.platform === 'win32' // npm is a .cmd shim on Windows

function step(message) {
  console.log(`\n▸ ${message}`)
}

function fail(message) {
  console.error(`\n✖ ${message}`)
  process.exit(1)
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: useShell })
  if (result.status !== 0) fail(`"${cmd} ${args.join(' ')}" failed — see the output above.`)
}

function commandVersion(cmd) {
  const result = spawnSync(cmd, ['--version'], { encoding: 'utf8', shell: useShell })
  return result.status === 0 ? result.stdout.trim() : null
}

function checkPrerequisites() {
  step('Checking prerequisites')
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 12)) {
    fail(`Node.js 22.12 or newer is required (found ${process.versions.node}).`)
  }
  const uv = commandVersion('uv')
  if (!uv) {
    fail('uv is not installed or not on PATH. Install it with:\n    winget install --id astral-sh.uv -e\nthen open a new terminal and re-run npm run setup.')
  }
  console.log(`  node ${process.versions.node}, ${uv}`)
  const claude = commandVersion('claude')
  console.log(claude ? `  claude ${claude}` : '  claude not found — agent routines need Claude Code (they can be set up later).')
}

function prepareEnvFile() {
  step('Preparing .env')
  const envPath = join(root, '.env')
  if (!existsSync(envPath)) {
    copyFileSync(join(root, '.env.example'), envPath)
    console.log('  Created .env from .env.example')
  }
  let text = readFileSync(envPath, 'utf8')
  const before = text
  // The app's database password (never the PostgreSQL superuser's).
  text = text.replaceAll('CHANGE_ME_DB_PASSWORD', randomBytes(18).toString('base64url'))
  for (const key of ['SESSION_SECRET', 'AGENT_INGEST_API_KEY']) {
    const blank = new RegExp(`^${key}=[ \\t]*$`, 'm')
    text = text.replace(blank, `${key}=${randomBytes(32).toString('base64url')}`)
  }
  if (text !== before) {
    writeFileSync(envPath, text)
    console.log('  Generated missing secrets')
  } else {
    console.log('  .env already complete')
  }
}

checkPrerequisites()
prepareEnvFile()

step('Installing JavaScript dependencies')
run('npm', ['install', '--no-fund', '--no-audit'])
run('npm', ['install', '--no-fund', '--no-audit', '--prefix', 'frontend'])

step('Installing Python dependencies')
run('uv', ['sync', '--project', 'backend'])

step('Creating the database (you will be asked for the PostgreSQL superuser password once)')
run('uv', ['run', '--project', 'backend', 'trip-planner', 'setup-db'])

step('Building the web app')
run('npm', ['run', 'build', '--prefix', 'frontend'])

console.log('\n✔ Setup complete. Start the app with:\n\n    npm start\n\nthen open http://localhost:8000\n')
