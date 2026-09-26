/**
 * CodeMirror 6 theme extension for the Beebeeb editor (task 1563).
 *
 * Two parts:
 *  1. `EditorView.theme` — editor chrome (background, gutters, cursor,
 *     selection, search panel). Every color value is a CSS `var(--...)`
 *     reference into `editor.css` / the app's `index.css` tokens, so the
 *     SAME extension instance serves both light and dark: the browser
 *     re-resolves the custom property when `.dark` toggles on `<html>`,
 *     with no JS-side dark-mode branch needed.
 *  2. `syntaxHighlighting(classHighlighter)` — assigns the standard
 *     `@lezer/highlight` class names (`tok-keyword`, `tok-string`, …),
 *     which `editor.css` maps to the design's token hues. Using the
 *     stock class highlighter (rather than a bespoke HighlightStyle) keeps
 *     this file thin and the actual colors live in one place (editor.css).
 */

import { EditorView } from '@codemirror/view'
import { syntaxHighlighting } from '@codemirror/language'
import { classHighlighter } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

export const bbEditorTheme: Extension = EditorView.theme({
  '&': {
    backgroundColor: 'var(--ed-bg)',
    color: 'var(--color-ink)',
  },
  '.cm-content': {
    caretColor: 'var(--ed-cursor)',
  },
})

export const bbSyntaxHighlighting: Extension = syntaxHighlighting(classHighlighter)

export const bbEditorExtensions: Extension[] = [bbEditorTheme, bbSyntaxHighlighting]
