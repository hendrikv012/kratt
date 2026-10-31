import { Node, mergeAttributes, InputRule } from '@tiptap/core'
import { resolveWikiTarget } from '../../core/wiki/resolve.js'
import { wikiLinkParts } from '../../core/wiki/parts.js'
import markdownSyntaxConfig from '../../core/markdown/syntax-config.js'

// Escape special regex characters
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Build dynamic regex pattern for wiki links
function buildWikiLinkPattern(imageEmbed = false) {
  const config = markdownSyntaxConfig.get('link', 'wikiLink')
  const open = config?.open || '[['
  const close = config?.close || ']]'
  const imageMarker = markdownSyntaxConfig.get('image', 'marker') || '!'

  console.log('[WikiLink] Building pattern with:', { open, close, imageMarker, imageEmbed })

  const escapedOpen = escapeRegex(open)
  const escapedClose = escapeRegex(close)
  const escapedImage = escapeRegex(imageMarker)

  // Build character class for what's NOT allowed inside (everything except close markers)
  const notClose = close.split('').map(c => escapeRegex(c)).join('')

  const pattern = imageEmbed
    ? new RegExp(`${escapedImage}${escapedOpen}([^${notClose}]+?)${escapedClose}$`)
    : new RegExp(`${escapedOpen}([^${notClose}]+?)${escapedClose}$`)

  console.log('[WikiLink] Created pattern:', pattern)

  return pattern
}

// Embeds read from a note file (![[photo.png]]) arrive without their picture. Look each
// target up once per editor, the way a typed embed is looked up, and fill in its src.
const lookedUp = new WeakMap()

function resolveLoadedEmbeds(editor, name) {
  if (!lookedUp.has(editor)) lookedUp.set(editor, new Set())
  const seen = lookedUp.get(editor)
  const targets = new Set()
  editor.state.doc.descendants((node) => {
    if (node.type.name === name && node.attrs.embed && !node.attrs.src && node.attrs.target && !seen.has(node.attrs.target)) {
      targets.add(node.attrs.target)
    }
  })
  for (const target of targets) {
    seen.add(target)
    resolveWikiTarget(wikiLinkParts(target).path).then((resolved) => {
      if (editor.isDestroyed || !resolved?.src) return
      const { tr } = editor.state
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === name && node.attrs.embed && !node.attrs.src && node.attrs.target === target) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: resolved.src, href: resolved.href || node.attrs.href })
        }
      })
      // Showing the picture isn't an edit: no undo step, no unsaved change.
      if (tr.docChanged) editor.view.dispatch(tr.setMeta('addToHistory', false).setMeta('preventUpdate', true))
    }).catch(() => {})
  }
}

export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  onCreate() {
    console.log('[WikiLink] Extension created, registering config listener');
    // Listen for markdown syntax config changes and reload editor
    this.configListener = markdownSyntaxConfig.onChange((category, key, value) => {
      console.log('[WikiLink] Config changed detected:', { category, key, value });
      console.log('[WikiLink] Current editor instance:', this.editor ? 'exists' : 'null');

      // Recreate the extension by destroying and recreating the editor
      if (this.editor) {
        console.log('[WikiLink] Dispatching markdown-config-changed event');
        // Trigger a full reload by emitting a custom event
        window.dispatchEvent(new CustomEvent('markdown-config-changed', {
          detail: { category, key, value }
        }));
      } else {
        console.warn('[WikiLink] Editor instance not available for reload');
      }
    });
    console.log('[WikiLink] Config listener registered successfully');
    resolveLoadedEmbeds(this.editor, this.name)
  },

  onTransaction({ transaction }) {
    if (transaction.docChanged) resolveLoadedEmbeds(this.editor, this.name)
  },

  onDestroy() {
    // Clean up listener
    if (this.configListener) {
      this.configListener()
    }
  },

  addAttributes() {
    return {
      id: { default: '' },
      target: { default: '' },
      alt: { default: '' },
      embed: { default: false },
      href: { default: '' },
      src: { default: '' },
    }
  },
  parseHTML() { return [{ tag: 'span[data-type="wiki-link"]' }] },
  renderHTML({ HTMLAttributes }) {
    const { embed, alt, target, href, src } = HTMLAttributes
    if (embed && src) {
      return ['img', mergeAttributes(HTMLAttributes, { 'data-type': 'wiki-link', class: 'wiki-image', alt: alt || target, src })]
    }
    const label = alt || target
    return ['a', mergeAttributes(HTMLAttributes, { 'data-type': 'wiki-link', class: 'wiki-link', href: href || target }), label]
  },
  addCommands() {
    return {
      setWikiLink: (raw, { embed = false } = {}) => async ({ chain }) => {
        const parts = wikiLinkParts(raw)
        const id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
        const baseAttrs = {
          id,
          target: raw,
          alt: parts.alt,
          embed,
          href: parts.href,
          src: '',
        }
        const ok = chain().insertContent({ type: this.name, attrs: baseAttrs }).run()
        // Resolve asynchronously (supports local files via Tauri)
        resolveWikiTarget(parts.path).then(resolved => {
          this.editor.commands.command(({ tr, state, dispatch }) => {
            let pos = -1
            state.doc.descendants((node, position) => {
              if (pos !== -1) return false
              if (node.type.name === this.name && node.attrs.id === id) { pos = position; return false }
              return true
            })
            if (pos !== -1) {
              const newAttrs = { ...baseAttrs, embed: embed || resolved.isImage, href: resolved.href || baseAttrs.href, src: resolved.src || '' }
              tr.setNodeMarkup(pos, undefined, newAttrs)
              dispatch(tr)
            }
            return true
          })
        })
        return ok
      },
    }
  },
  addInputRules() {
    const currentConfig = markdownSyntaxConfig.get('link', 'wikiLink');
    console.log('[WikiLink] Creating input rules with config:', currentConfig);
    return [
      // ![[...]] image embed (dynamic pattern)
      new InputRule({
        find: buildWikiLinkPattern(true),
        handler: ({ range, match, chain }) => {
          const raw = match[1]
          const id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
          const parts = wikiLinkParts(raw)
          const baseAttrs = { id, target: raw, alt: parts.alt, embed: true, href: parts.href, src: '' }
          chain().deleteRange(range).insertContent({ type: this.name, attrs: baseAttrs }).run()
          // Resolve asynchronously
          resolveWikiTarget(parts.path).then(resolved => {
            this.editor.commands.command(({ tr, state, dispatch }) => {
              let pos = -1
              state.doc.descendants((node, position) => {
                if (pos !== -1) return false
                if (node.type.name === this.name && node.attrs.id === id) { pos = position; return false }
                return true
              })
              if (pos !== -1) {
                const newAttrs = { ...baseAttrs, href: resolved.href || baseAttrs.href, src: resolved.src || '' }
                tr.setNodeMarkup(pos, undefined, newAttrs)
                dispatch(tr)
              }
              return true
            })
          })
        },
      }),
      // [[...]] file/note link (dynamic pattern)
      new InputRule({
        find: buildWikiLinkPattern(false),
        handler: ({ range, match, chain }) => {
          const raw = match[1]
          const id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
          const parts = wikiLinkParts(raw)
          const baseAttrs = { id, target: raw, alt: parts.alt, embed: false, href: parts.href, src: '' }
          chain().deleteRange(range).insertContent({ type: this.name, attrs: baseAttrs }).run()
          resolveWikiTarget(parts.path).then(resolved => {
            this.editor.commands.command(({ tr, state, dispatch }) => {
              let pos = -1
              state.doc.descendants((node, position) => {
                if (pos !== -1) return false
                if (node.type.name === this.name && node.attrs.id === id) { pos = position; return false }
                return true
              })
              if (pos !== -1) {
                const newAttrs = { ...baseAttrs, href: resolved.href || baseAttrs.href, src: resolved.src || '' }
                tr.setNodeMarkup(pos, undefined, newAttrs)
                dispatch(tr)
              }
              return true
            })
          })
        },
      }),
    ]
  },
})

export default WikiLink