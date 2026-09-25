// Finds Tailwind classes that have a canonical (preferred) spelling, the same check
// the Tailwind IntelliSense extension runs. `npm run lint:tailwind` lists them;
// `npm run lint:tailwind -- --fix` rewrites them in place.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { __unstable__loadDesignSystem } from 'tailwindcss'

const SOURCE = 'src'
const fix = process.argv.includes('--fix')

// The design system as the app sees it: Tailwind plus Hamsa's theme and tokens.
const css = readFileSync('src/styles/index.css', 'utf8')
const design = await __unstable__loadDesignSystem(css, {
  base: 'src/styles',
  loadStylesheet: async (id, base) => {
    const path = id === 'tailwindcss' ? 'node_modules/tailwindcss/index.css' : join(base, id)
    return { path, base: join(path, '..'), content: readFileSync(path, 'utf8') }
  },
})

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts')) yield path
  }
}

// Class names live in string literals; take every token that Tailwind recognises.
const TOKEN = /[\w\-:[\]()/.%#,*!&>~@'=]+/g
let found = 0

for (const file of files(SOURCE)) {
  const original = readFileSync(file, 'utf8')
  let text = original
  const strings = text.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? []
  const tokens = [...new Set(strings.flatMap((s) => s.slice(1, -1).match(TOKEN) ?? []))]
  const known = tokens.filter((t) => design.parseCandidate(t).length > 0)
  if (known.length === 0) continue

  const canonical = design.canonicalizeCandidates(known)
  known.forEach((from, i) => {
    const to = canonical[i]
    if (!to || to === from) return
    found++
    console.log(`${file}: ${from} → ${to}`)
    // Whole-class replacement only (between quotes, spaces or backticks).
    if (fix)
      text = text.replace(
        new RegExp(`(?<=[\\s'"\`])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s'"\`])`, 'g'),
        to,
      )
  })
  if (fix && text !== original) writeFileSync(file, text)
}

console.log(
  found ? `\n${found} class(es) ${fix ? 'fixed' : 'can be written canonically'}` : 'All classes are canonical.',
)
if (found && !fix) process.exitCode = 1
