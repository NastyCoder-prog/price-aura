// One-off: convert hardcoded dashboard colors in globals.css to --pa-* tokens.
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = 'app/globals.css'
let css = fs.readFileSync(path, 'utf8')

const map = [
  ['#c5f36b', 'var(--pa-accent)'],
  ['#d9ff8f', 'var(--pa-accent-soft)'],
  ['#e9f5d4', 'var(--pa-accent-soft-2)'],
  ['#0b1108', 'var(--pa-accent-ink)'],
  ['#6f8d49', 'var(--pa-accent-dim)'],
  ['#54683c', 'var(--pa-accent-dim)'],
  ['#50633d', 'var(--pa-accent-dim)'],
  ['#344239', 'var(--pa-border-strong)'],
  ['#334043', 'var(--pa-border-strong)'],
  ['#536063', 'var(--pa-faint-2)'],
  ['#435052', 'var(--pa-faint-2)'],
  ['#2f3e42', 'var(--pa-mark-a)'],
  ['#1b2629', 'var(--pa-mark-b)'],
  ['#283136', 'var(--pa-border)'],
  ['#2a3538', 'var(--pa-border-soft)'],
  ['#202b2e', 'var(--pa-border-soft)'],
  ['#263134', 'var(--pa-border-soft)'],
  ['#637073', 'var(--pa-faint)'],
  ['#718083', 'var(--pa-muted-4)'],
  ['#758486', 'var(--pa-muted-3)'],
  ['#768386', 'var(--pa-muted-3)'],
  ['#7d8a8d', 'var(--pa-muted-2)'],
  ['#879493', 'var(--pa-muted-2)'],
  ['#9ba8a4', 'var(--pa-muted)'],
  ['#8d9a9e', 'var(--pa-muted)'],
  ['#b7c1c1', 'var(--pa-muted)'],
  ['#a4b1a6', 'var(--pa-muted)'],
  ['#a7b4af', 'var(--pa-muted-2)'],
  ['#9aa7a6', 'var(--pa-muted-2)'],
  ['#d5ddda', 'var(--pa-text-soft)'],
  ['#cfd8d5', 'var(--pa-text-soft)'],
  ['#e5ece8', 'var(--pa-text-soft)'],
  ['#e7ece9', 'var(--pa-text-strong)'],
  ['#f4f7f4', 'var(--pa-text-strong)'],
  ['#f1f5f3', 'var(--pa-text)'],
  ['#101518', 'var(--pa-panel)'],
  ['#101619', 'var(--pa-surface)'],
  ['#0d1214', 'var(--pa-surface-2)'],
  ['#1e282b', 'var(--pa-surface-2)'],
  ['#1a2326', 'var(--pa-surface-2)'],
  ['#172024', 'var(--pa-surface-3)'],
  ['#0c1113', 'var(--pa-surface-4)'],
  ['#080b0d', 'var(--pa-bg)'],
  ['#f87171', 'var(--pa-danger)'],
  ['#fca5a5', 'var(--pa-danger-soft)'],
  ['rgba(197, 243, 107, 0.08)', 'var(--pa-accent-wash)'],
  ['rgba(197, 243, 107, 0.5)', 'var(--pa-accent-line)'],
  ['rgba(248, 113, 113, 0.12)', 'var(--pa-danger-wash)'],
  ['rgba(16, 21, 24, 0.82)', 'var(--pa-field)'],
  ['rgba(8, 11, 13, 0.55)', 'var(--pa-scrim)'],
  ['rgba(8, 11, 13, 0.5)', 'var(--pa-scrim)'],
  ['rgba(255, 255, 255, 0.035)', 'var(--pa-grid-line)'],
  ['rgba(255, 255, 255, 0.1)', 'var(--pa-rule)'],
  ['rgba(255, 255, 255, 0.09)', 'var(--pa-rule)'],
]

for (const [from, to] of map) {
  css = css.split(from).join(to)
}

fs.writeFileSync(path, css)
console.log('rewrote', path)
