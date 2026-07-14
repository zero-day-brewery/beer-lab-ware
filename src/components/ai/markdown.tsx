/**
 * A tiny, dependency-free, XSS-safe markdown renderer for assistant messages.
 *
 * The app carries NO markdown library — everywhere it shows a `_md` field it just
 * renders the raw string in a `whitespace-pre-*` block (see recipe/gear/inventory
 * views). Assistant answers need a touch more structure (headings, lists, bold, a
 * key number in bold, fenced code), so this adds the smallest possible block+inline
 * formatter that produces REACT ELEMENTS only — no `dangerouslySetInnerHTML`, so
 * React escapes every text node and nothing from the model can inject markup. It is
 * deliberately not CommonMark-complete; it covers the subset a chat reply uses.
 *
 * Adding a real markdown dep is explicitly out of scope (offline/local-first, small
 * bundle), so this stays in-house and self-contained.
 */

import { type ReactNode, useMemo } from 'react'

// ── inline: **bold**, *italic* / _italic_, `code`, [text](http…) ────────────
// One combined matcher so we split a line into plain + token runs in a single pass.
const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE)
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`
    if (!part) return null
    if (
      (part.startsWith('**') && part.endsWith('**')) ||
      (part.startsWith('__') && part.endsWith('__'))
    ) {
      return <strong key={key}>{part.slice(2, -2)}</strong>
    }
    if (
      (part.startsWith('*') && part.endsWith('*')) ||
      (part.startsWith('_') && part.endsWith('_'))
    ) {
      return <em key={key}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={key}>{part.slice(1, -1)}</code>
    }
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part)
    if (link) {
      // Only http(s) links become anchors; anything else falls through as text.
      return (
        <a key={key} href={link[2]} target="_blank" rel="noreferrer noopener">
          {link[1]}
        </a>
      )
    }
    return <span key={key}>{part}</span>
  })
}

// ── block-level: headings, fenced code, ordered/unordered lists, paragraphs ──
type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'para'; text: string }

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block ``` … ```
    if (/^```/.test(line.trim())) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // consume the closing fence (or EOF)
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }

    // Blank line → block separator
    if (line.trim() === '') {
      i += 1
      continue
    }

    // ATX heading  #, ##, ###…
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() })
      i += 1
      continue
    }

    // Unordered list  -, *, +
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
        i += 1
      }
      blocks.push({ kind: 'ul', items })
      continue
    }

    // Ordered list  1. 2. …
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i += 1
      }
      blocks.push({ kind: 'ol', items })
      continue
    }

    // Paragraph: gather consecutive non-blank, non-special lines.
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i].trim()) &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i])
      i += 1
    }
    blocks.push({ kind: 'para', text: para.join('\n') })
  }

  return blocks
}

function renderBlock(block: Block, key: string): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${Math.min(block.level + 2, 6)}` as 'h3' | 'h4' | 'h5' | 'h6'
      return (
        <Tag key={key} className="companion-md-h">
          {renderInline(block.text, key)}
        </Tag>
      )
    }
    case 'code':
      return (
        <pre key={key} className="companion-md-code">
          <code>{block.text}</code>
        </pre>
      )
    case 'ul':
      return (
        <ul key={key} className="companion-md-list">
          {block.items.map((it, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static parsed markdown, never reordered
            <li key={`${key}-li-${j}`}>{renderInline(it, `${key}-${j}`)}</li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol key={key} className="companion-md-list">
          {block.items.map((it, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static parsed markdown, never reordered
            <li key={`${key}-li-${j}`}>{renderInline(it, `${key}-${j}`)}</li>
          ))}
        </ol>
      )
    default:
      return (
        <p key={key} className="companion-md-p">
          {renderInline(block.text, key)}
        </p>
      )
  }
}

/** Render a markdown string as safe React elements (no raw HTML injection). */
export function Markdown({ children }: { children: string }) {
  const blocks = useMemo(() => parseBlocks(children ?? ''), [children])
  return <div className="companion-md">{blocks.map((b, i) => renderBlock(b, `b${i}`))}</div>
}
