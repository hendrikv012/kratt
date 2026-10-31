import { Extension } from '@tiptap/core';
import * as suggestionMod from '@tiptap/suggestion';
const suggestion = suggestionMod.default ?? suggestionMod;
import slashCommand, { SLASH_SUGGESTION_KEY, closeSlashMenu } from './slash-command.jsx';

export { SLASH_SUGGESTION_KEY };

const SlashCommand = Extension.create({
  name: 'slashCommand',

  // dismissed: where the "/" of a menu closed with Escape, a click away or a command is, so the
  // menu stays closed while the cursor is still after it.
  addStorage() {
    return { dismissed: null };
  },

  onTransaction({ transaction }) {
    const { dismissed } = this.storage;
    if (dismissed == null || !transaction.docChanged) return;
    const at = transaction.mapping.mapResult(dismissed);
    const gone = at.deleted || transaction.doc.textBetween(at.pos, Math.min(at.pos + 1, transaction.doc.content.size)) !== '/';
    this.storage.dismissed = gone ? null : at.pos;
  },

  addProseMirrorPlugins() {
    return [
      suggestion({
        pluginKey: SLASH_SUGGESTION_KEY,
        editor: this.editor,
        char: '/',
        allow: ({ editor, range }) => editor.storage.slashCommand?.dismissed !== range.from,
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
          // Commands that open a picker (or do nothing) leave the typed text, which would keep the
          // menu open behind them.
          closeSlashMenu(editor);
        },
        ...slashCommand,
      }),
    ];
  },
});

export default SlashCommand;
