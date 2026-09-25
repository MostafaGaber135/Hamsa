// Builds supabase/schema.sql from supabase/migrations, so the one-file schema can
// never drift from the migrations. Run: npm run db:schema. CI checks it's up to date.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

const MIGRATIONS = 'supabase/migrations'
const OUTPUT = 'supabase/schema.sql'
const RULE = '-- ' + '='.repeat(69)

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()

// Each migration starts with a comment block (its title, and "run once / run after"
// notes that only make sense for the separate files); keep the title, drop the rest.
function parse(file) {
  const text = readFileSync(`${MIGRATIONS}/${file}`, 'utf8').replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  // The title may continue on the next comment lines, up to the "Run once" note.
  const start = lines.findIndex((l) => l.startsWith('-- Hamsa: '))
  const titleLines = []
  for (let i = start; start >= 0 && i < lines.length; i++) {
    const line = lines[i].replace(/^-- ?/, '')
    // Stop at the notes: "Run once…", "(Run it AFTER…)", the closing rule, or "Tables: …".
    if (i > start && (!line || /^(Run once|\(|=|[A-Z][a-z]+: )/.test(line))) break
    titleLines.push(line.replace('Hamsa: ', ''))
  }
  const joined = titleLines.join(' ').trim() || file
  const title = joined[0].toUpperCase() + joined.slice(1)
  const headerEnd = lines.findIndex((l, i) => i > 0 && l === RULE)
  const body = lines
    .slice(headerEnd + 1)
    .join('\n')
    .trim()
  return { file, title, body }
}

const parts = files.map(parse)
const contents = parts.map((p, i) => `--   ${String(i + 1).padStart(2)}. ${p.title}`).join('\n')

const header = `${RULE}
-- Hamsa: complete database schema (all migrations in one file)
--
-- GENERATED from supabase/migrations by scripts/build-schema.mjs: don't edit it by hand.
-- Change a migration (or add one), then run: npm run db:schema
--
-- FOR A NEW, EMPTY SUPABASE PROJECT ONLY. If you already ran the migrations (by hand
-- or with supabase db push), don't run this: it would fail with "already exists".
--
-- Contents
${contents}
--
-- Run once: SQL Editor → New query → paste → Run.
${RULE}
`

const sections = parts.map((p, i) => `\n\n${RULE}\n-- ${i + 1}. ${p.title}\n--    (${p.file})\n${RULE}\n\n${p.body}\n`)

writeFileSync(OUTPUT, header + sections.join(''))
console.log(`${OUTPUT}: ${files.length} migrations`)
