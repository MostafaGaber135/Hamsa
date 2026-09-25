// Runs the SQL tests (supabase/tests) against a fresh database with the whole schema.
// Needs a Postgres server; by default `psql` from PATH with the usual PG* variables
// (PGHOST, PGUSER, PGPASSWORD…). To use a Docker container instead:
//   PSQL="docker exec -i hamsa-pgtest psql -U postgres" npm run test:db
// Fails if any test prints FAIL or psql reports an error.
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'

const PSQL = (process.env.PSQL ?? 'psql').split(' ')
const DB = process.env.TEST_DB ?? 'hamsa_test'
const TESTS = 'supabase/tests'

function psql(args, input) {
  const [cmd, ...base] = PSQL
  const result = spawnSync(cmd, [...base, ...args], { input, encoding: 'utf8' })
  if (result.error) throw result.error
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` }
}

function run(label, database, file) {
  const { ok, output } = psql(['-d', database, '-v', 'ON_ERROR_STOP=1', '-q'], readFileSync(file, 'utf8'))
  const lines = output.split('\n').filter((l) => l.trim())
  const failures = lines.filter((l) => /FAIL|ERROR/.test(l))
  const passes = lines.filter((l) => l.includes('OK:')).length
  console.log(`${ok && failures.length === 0 ? '✓' : '✗'} ${label}${passes ? ` (${passes} checks)` : ''}`)
  if (!ok || failures.length) {
    console.log(output)
    process.exitCode = 1
  }
  return passes
}

// A fresh database each run.
const reset = psql(['-d', 'postgres', '-q', '-c', `drop database if exists ${DB}`, '-c', `create database ${DB}`])
if (!reset.ok) {
  console.error(reset.output)
  process.exit(1)
}

const tests = readdirSync(TESTS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
const [stub, ...rest] = tests
run('Supabase stand-in', DB, `${TESTS}/${stub}`)
run('schema.sql', DB, 'supabase/schema.sql')
let checks = 0
for (const file of rest) checks += run(file, DB, `${TESTS}/${file}`)
console.log(`\n${checks} checks${process.exitCode ? ', with failures' : ' passed'}`)
