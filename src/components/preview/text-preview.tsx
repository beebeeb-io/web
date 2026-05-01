import { useEffect, useState, useRef } from 'react'

interface TextPreviewProps {
  blob: Blob
  /** Optional language hint for syntax coloring (e.g. 'rust', 'typescript') */
  language?: string
}

// ─── Lightweight syntax coloring ────────────────────────────
// No heavy library — just regex-based token coloring for common patterns.
// Safety: all raw text is HTML-escaped via esc() before any markup is added.
// Only hardcoded <span class="..."> tags are inserted around escaped content.

const KEYWORD_PATTERN =
  /\b(abstract|as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|false|finally|fn|for|from|function|if|impl|import|in|instanceof|interface|let|loop|match|mod|mut|new|null|of|package|private|protected|pub|public|ref|return|self|static|struct|super|switch|this|throw|trait|true|try|type|typeof|undefined|use|var|void|where|while|with|yield)\b/g

const COMMENT_LINE_PATTERN = /^(\s*)(\/\/.*|#.*)$/

function colorLine(line: string, inBlock: boolean): { html: string; inBlock: boolean } {
  // If we're inside a block comment
  if (inBlock) {
    const endIdx = line.indexOf('*/')
    if (endIdx === -1) {
      return { html: `<span class="text-ink-3 italic">${esc(line)}</span>`, inBlock: true }
    }
    const commentPart = line.slice(0, endIdx + 2)
    const rest = line.slice(endIdx + 2)
    const restResult = colorLine(rest, false)
    return {
      html: `<span class="text-ink-3 italic">${esc(commentPart)}</span>${restResult.html}`,
      inBlock: restResult.inBlock,
    }
  }

  // Check for block comment start
  const blockStart = line.indexOf('/*')
  if (blockStart !== -1) {
    const before = line.slice(0, blockStart)
    const after = line.slice(blockStart)
    const blockEnd = after.indexOf('*/', 2)
    if (blockEnd !== -1) {
      // Block comment starts and ends on same line
      const commentPart = after.slice(0, blockEnd + 2)
      const rest = after.slice(blockEnd + 2)
      const beforeHtml = colorTokens(before)
      const restResult = colorLine(rest, false)
      return {
        html: `${beforeHtml}<span class="text-ink-3 italic">${esc(commentPart)}</span>${restResult.html}`,
        inBlock: restResult.inBlock,
      }
    }
    // Block comment starts but doesn't end on this line
    const beforeHtml = colorTokens(before)
    return {
      html: `${beforeHtml}<span class="text-ink-3 italic">${esc(after)}</span>`,
      inBlock: true,
    }
  }

  // Check for line comments (// or #)
  const lineCommentMatch = line.match(COMMENT_LINE_PATTERN)
  if (lineCommentMatch) {
    const indent = lineCommentMatch[1]
    const comment = lineCommentMatch[2]
    return { html: `${esc(indent)}<span class="text-ink-3 italic">${esc(comment)}</span>`, inBlock: false }
  }

  // Check for // comment after code
  const inlineComment = line.indexOf('//')
  if (inlineComment > 0 && !isInsideString(line, inlineComment)) {
    const code = line.slice(0, inlineComment)
    const comment = line.slice(inlineComment)
    return {
      html: `${colorTokens(code)}<span class="text-ink-3 italic">${esc(comment)}</span>`,
      inBlock: false,
    }
  }

  return { html: colorTokens(line), inBlock: false }
}

/** Rough check — is position inside a single or double quoted string? */
function isInsideString(line: string, pos: number): boolean {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < pos; i++) {
    const ch = line[i]
    const prev = i > 0 ? line[i - 1] : ''
    if (ch === "'" && prev !== '\\' && !inDouble) inSingle = !inSingle
    if (ch === '"' && prev !== '\\' && !inSingle) inDouble = !inDouble
  }
  return inSingle || inDouble
}

function colorTokens(text: string): string {
  if (!text) return ''

  // Split by strings first, then colorize keywords in non-string parts
  const parts: string[] = []
  let current = ''
  let inStr: string | null = null

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const prev = i > 0 ? text[i - 1] : ''

    if (inStr) {
      current += ch
      if (ch === inStr && prev !== '\\') {
        parts.push(`<span class="text-green">${esc(current)}</span>`)
        current = ''
        inStr = null
      }
    } else if (ch === '"' || ch === "'" || ch === '`') {
      if (current) {
        parts.push(colorKeywords(current))
        current = ''
      }
      current += ch
      inStr = ch
    } else {
      current += ch
    }
  }

  // Remaining text
  if (current) {
    if (inStr) {
      parts.push(`<span class="text-green">${esc(current)}</span>`)
    } else {
      parts.push(colorKeywords(current))
    }
  }

  return parts.join('')
}

function colorKeywords(text: string): string {
  // Color numbers
  let result = esc(text)
  result = result.replace(KEYWORD_PATTERN, '<span class="text-amber-deep font-medium">$1</span>')
  result = result.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="text-amber">$1</span>')
  return result
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ─── Component ──────────────────────────────────────────────

const MAX_LINES = 10_000

export function TextPreview({ blob, language }: TextPreviewProps) {
  const [text, setText] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    blob.text().then((raw) => {
      const lines = raw.split('\n')
      if (lines.length > MAX_LINES) {
        setText(lines.slice(0, MAX_LINES).join('\n'))
        setTruncated(true)
      } else {
        setText(raw)
      }
    })
  }, [blob])

  if (text === null) return null

  const lines = text.split('\n')
  const gutterWidth = String(lines.length).length
  const shouldColor = !!language

  // Build colored HTML if language is set.
  // Safety note: all user content is escaped via esc() before any HTML spans
  // are constructed. Only hardcoded Tailwind class spans are injected.
  let coloredLines: string[] | null = null
  if (shouldColor) {
    coloredLines = []
    let inBlock = false
    for (const line of lines) {
      const result = colorLine(line, inBlock)
      coloredLines.push(result.html)
      inBlock = result.inBlock
    }
  }

  return (
    <div
      ref={containerRef}
      className="flex w-full flex-col overflow-hidden rounded-md bg-paper"
      style={{
        maxWidth: 860,
        maxHeight: '92%',
        boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
      }}
    >
      {/* Content */}
      <div className="overflow-auto">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="hover:bg-paper-2/50">
                <td
                  className="select-none border-r border-line px-3 text-right align-top font-mono text-[11px] leading-[1.7] text-ink-4"
                  style={{ minWidth: gutterWidth * 8 + 24 }}
                >
                  {i + 1}
                </td>
                <td className="px-4 align-top font-mono text-[12px] leading-[1.7] text-ink-2">
                  {coloredLines ? (
                    <span
                      className="whitespace-pre"
                      dangerouslySetInnerHTML={{ __html: coloredLines[i] || '' }}
                    />
                  ) : (
                    <span className="whitespace-pre">{line || '​'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Truncation notice */}
      {truncated && (
        <div className="shrink-0 border-t border-line bg-paper-2 px-4 py-2 text-center font-mono text-[11px] text-ink-3">
          Showing first {MAX_LINES.toLocaleString()} lines. Download the file to see the rest.
        </div>
      )}
    </div>
  )
}
