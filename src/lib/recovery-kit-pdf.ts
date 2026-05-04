/**
 * Recovery Kit PDF generator.
 *
 * Zero-dependency approach: builds a print-optimised HTML document in memory,
 * opens it in a new window, and calls window.print() so the browser's
 * native "Save as PDF" facility handles the actual file creation.
 *
 * The print window auto-closes after the print dialog is dismissed.
 *
 * Usage:
 *   generateRecoveryKitPDF('word1 word2 ... word12', 'alice@example.com')
 */

export function generateRecoveryKitPDF(phrase: string, email: string): void {
  const words = phrase.trim().split(/\s+/)
  const dateStr = new Date().toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  // ── Layout helpers ──────────────────────────────────────────────────────
  // Arrange words in a 3-column grid: columns left-to-right, rows top-to-bottom.
  // Padding groups of 4 into rows keeps the layout clean for 12 words.
  const COLS = 3
  const wordRows: string[] = []
  for (let i = 0; i < words.length; i += COLS) {
    const cells = Array.from({ length: COLS }, (_, j) => {
      const idx = i + j
      if (idx >= words.length) return '<td></td>'
      const num = String(idx + 1).padStart(2, '0')
      return `<td class="word-cell">
        <span class="word-num">${num}</span>
        <span class="word-text">${escapeHtml(words[idx] ?? '')}</span>
      </td>`
    })
    wordRows.push(`<tr>${cells.join('')}</tr>`)
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Beebeeb Recovery Kit — ${escapeHtml(email)}</title>
<style>
  /* ── Reset + page setup ───────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  @page {
    size: A4 portrait;
    margin: 18mm 20mm 22mm 20mm;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue',
                 Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.5;
    color: #1a1a1a;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Amber accent bar ────────────────────────────── */
  .accent-bar {
    height: 5px;
    background: #F5B800;
    border-radius: 3px;
    margin-bottom: 20px;
  }

  /* ── Header ──────────────────────────────────────── */
  .header { margin-bottom: 22px; }

  .logo {
    font-size: 19pt;
    font-weight: 800;
    letter-spacing: -0.03em;
    color: #0a0a0a;
  }
  .logo .dot { color: #F5B800; }

  .kit-title {
    font-size: 11pt;
    font-weight: 600;
    color: #555;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-top: 3px;
  }

  /* ── Metadata row ────────────────────────────────── */
  .meta {
    display: flex;
    gap: 32px;
    margin-bottom: 24px;
    padding: 10px 14px;
    background: #fafaf8;
    border: 1px solid #e5e3db;
    border-radius: 6px;
  }
  .meta-item { display: flex; flex-direction: column; gap: 2px; }
  .meta-label {
    font-size: 7.5pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #999;
  }
  .meta-value { font-size: 10.5pt; color: #1a1a1a; font-weight: 500; }

  /* ── Phrase section ──────────────────────────────── */
  .phrase-heading {
    font-size: 10pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #444;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .phrase-heading::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #e5e3db;
  }

  .phrase-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 6px 6px;
    margin-bottom: 8px;
  }

  .word-cell {
    background: #fafaf8;
    border: 1px solid #e5e3db;
    border-radius: 5px;
    padding: 8px 12px;
    width: 33.33%;
    vertical-align: middle;
  }
  .word-num {
    font-family: 'Courier New', Courier, monospace;
    font-size: 8pt;
    color: #bbb;
    margin-right: 8px;
  }
  .word-text {
    font-family: 'Courier New', Courier, monospace;
    font-size: 12pt;
    font-weight: 700;
    color: #1a1a1a;
    letter-spacing: 0.01em;
  }

  /* ── Warning banner ──────────────────────────────── */
  .warning {
    margin-top: 24px;
    padding: 14px 16px;
    background: #FFFBEB;
    border: 1.5px solid #F5B800;
    border-radius: 6px;
  }
  .warning-title {
    font-size: 9pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #92400E;
    margin-bottom: 6px;
  }
  .warning-body {
    font-size: 9.5pt;
    color: #451A03;
    line-height: 1.6;
  }

  /* ── Footer ──────────────────────────────────────── */
  .footer {
    margin-top: 28px;
    padding-top: 12px;
    border-top: 1px solid #e5e3db;
    font-size: 8pt;
    color: #aaa;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  /* ── Print overrides ─────────────────────────────── */
  @media print {
    body { margin: 0; }
    .word-cell { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .warning   { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

<div class="accent-bar"></div>

<div class="header">
  <div class="logo">beebeeb<span class="dot">.</span>io</div>
  <div class="kit-title">Recovery Kit</div>
</div>

<div class="meta">
  <div class="meta-item">
    <span class="meta-label">Account</span>
    <span class="meta-value">${escapeHtml(email)}</span>
  </div>
  <div class="meta-item">
    <span class="meta-label">Generated</span>
    <span class="meta-value">${escapeHtml(dateStr)}</span>
  </div>
  <div class="meta-item">
    <span class="meta-label">Words</span>
    <span class="meta-value">${words.length}</span>
  </div>
</div>

<div class="phrase-heading">Recovery Phrase</div>
<table class="phrase-table">
  ${wordRows.join('\n  ')}
</table>

<div class="warning">
  <div class="warning-title">Keep this safe — we cannot recover it for you</div>
  <div class="warning-body">
    This phrase is the master key to your encrypted files. If you forget your password,
    this phrase is the only way to recover your account.
    <br/><br/>
    <strong>Store it offline</strong> — printed, in a safe, with your important documents.
    Never share it. Never photograph it. Never type it into any website other than beebeeb.io.
  </div>
</div>

<div class="footer">
  <span>beebeeb.io &middot; End-to-end encrypted &middot; EU servers &middot; Zero-knowledge</span>
  <span>Initlabs B.V. &middot; Netherlands</span>
</div>

<script>
  // Auto-print on load, then close the window when done.
  window.addEventListener('load', function () {
    window.print();
  });
  window.addEventListener('afterprint', function () {
    window.close();
  });
</script>
</body>
</html>`

  const printWindow = window.open('', '_blank', 'width=800,height=1100')
  if (!printWindow) {
    // Pop-up blocked — fall back to a downloadable HTML file the user can
    // open and print themselves.
    downloadAsHtml(html, `beebeeb-recovery-kit-${Date.now()}.html`)
    return
  }

  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Fallback when window.open() is blocked: download HTML file directly. */
function downloadAsHtml(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
