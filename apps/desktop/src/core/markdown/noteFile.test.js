import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import * as StarterKitExt from "@tiptap/starter-kit";
import * as TaskListExt from "@tiptap/extension-task-list";
import * as TaskItemExt from "@tiptap/extension-task-item";
import * as ImageExt from "@tiptap/extension-image";
import * as SuperscriptExt from "@tiptap/extension-superscript";
import * as SubscriptExt from "@tiptap/extension-subscript";
import * as TableExt from "@tiptap/extension-table";
import * as TableRowExt from "@tiptap/extension-table-row";
import * as TableHeaderExt from "@tiptap/extension-table-header";
import * as TableCellExt from "@tiptap/extension-table-cell";
import * as HighlightExt from "@tiptap/extension-highlight";
import MathExt from "../../editor/extensions/Math.js";
import WikiLink from "../../editor/extensions/WikiLink.js";
import { editorContentFor } from "./compiler.js";
import { editorToFile, fileToEditor, noteFileToHtml, noteHtmlToMarkdown } from "./noteFile.js";

vi.mock("../wiki/resolve.js", () => ({
  resolveWikiTarget: vi.fn(async (target) =>
    target.endsWith(".png") ? { href: target, src: `data:image/png;base64,${target}`, isImage: true } : { href: target, src: "", isImage: false }
  ),
}));

const pick = (mod, name) => mod[name] ?? mod.default;

// The node types Lokus's editor (src/editor/components/Editor.jsx) saves.
function makeEditor(content) {
  return new Editor({
    extensions: [
      pick(StarterKitExt, "StarterKit"),
      pick(TaskListExt, "TaskList"),
      pick(TaskItemExt, "TaskItem"),
      pick(ImageExt, "Image").configure({ inline: true, allowBase64: true, HTMLAttributes: { class: "editor-image" } }),
      pick(SuperscriptExt, "Superscript"),
      pick(SubscriptExt, "Subscript"),
      pick(TableExt, "Table").configure({ resizable: true }),
      pick(TableRowExt, "TableRow"),
      pick(TableHeaderExt, "TableHeader"),
      pick(TableCellExt, "TableCell"),
      pick(HighlightExt, "Highlight").configure({ multicolor: true }),
      ...MathExt,
      WikiLink,
    ],
    content,
  });
}

const editors = [];
const editorHtml = (content) => {
  const editor = makeEditor(content);
  editors.push(editor);
  return editor.getHTML();
};
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

// What a note looks like inside the editor, written as the editor's own HTML.
const NOTE = [
  "<h1>Krebs cycle</h1>",
  '<p>Runs in the <strong>matrix</strong>, <em>not</em> the <s>cytoplasm</s>. Uses <code>NAD+</code> and <u>FAD</u>; see ',
  '<span data-type="wiki-link" target="Glycolysis" href="Glycolysis"></span>, ',
  '<span data-type="wiki-link" target="Electron transport|the chain" alt="the chain" href="Electron transport"></span> and ',
  '<a href="https://example.org/krebs">the article</a>.</p>',
  "<p>Plain text that looks like syntax: 1 < 2 &amp; 3 > 2, [[not a link]], ==not marked==, ~~not struck~~, *stars*, _under_, $5 and $10, &amp;amp;.</p>",
  "<p>Line one<br>line two</p>",
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Read chapter 3</p></li>',
  '<li data-type="taskItem" data-checked="false"><p>Draw the cycle</p></li></ul>',
  "<ul><li><p>A bullet right after the tasks</p></li></ul>",
  '<ol start="3"><li><p>Third</p><ul><li><p>nested</p></li></ul></li><li><p>Fourth</p></li></ol>',
  "<ol><li><p>A new list right after</p></li></ol>",
  "<blockquote><p>Quoted <strong>text</strong></p></blockquote>",
  '<pre><code class="language-js">const a = 1;\n\nconst b = 2;</code></pre>',
  "<hr>",
  "<table><tbody><tr><th><p>Molecule</p></th><th><p>Count</p></th></tr><tr><td><p>ATP</p></td><td><p><strong>2</strong></p></td></tr></tbody></table>",
  '<p>An image <img src="https://example.org/cell.png" alt="cell"> and <mark>marked</mark>, ',
  '<mark data-color="#fde68a" style="background-color: #fde68a; color: inherit">yellow</mark>, H<sub>2</sub>O, x<sup>2</sup>, ',
  '<span data-type="math-inline" src="e^{i\\pi}"></span>.</p>',
  '<div data-type="math-block" src="\\int_0^1 x\\,dx"></div>',
  "<h2>Done</h2>",
].join("");

describe("Lokus note files", () => {
  it("save as Markdown and load back to the same note", () => {
    const before = editorHtml(NOTE);
    const markdown = noteHtmlToMarkdown(before);
    const after = editorHtml(noteFileToHtml(markdown));
    expect(after).toBe(before);
    expect(noteHtmlToMarkdown(after)).toBe(markdown);
  });

  it("are plain Markdown, not HTML", () => {
    const markdown = noteHtmlToMarkdown(editorHtml(NOTE));
    expect(markdown).toContain("# Krebs cycle\n");
    expect(markdown).toContain("Runs in the **matrix**, *not* the ~~cytoplasm~~.");
    expect(markdown).toContain("[[Glycolysis]]");
    expect(markdown).toContain("[[Electron transport|the chain]]");
    expect(markdown).toContain("[the article](https://example.org/krebs)");
    expect(markdown).toContain("- [x] Read chapter 3\n- [ ] Draw the cycle\n\n* A bullet right after the tasks");
    expect(markdown).toContain("3. Third\n   - nested\n4. Fourth\n\n1) A new list right after");
    expect(markdown).toContain("```js\nconst a = 1;\n\nconst b = 2;\n```");
    expect(markdown).toContain("| Molecule | Count |");
    expect(markdown).toContain("![cell](https://example.org/cell.png)");
    expect(markdown).toContain("==marked==");
    expect(markdown).not.toMatch(/<(p|ul|ol|li|h\d|strong|em|pre|table|blockquote|br)\b/);
  });

  it("read files saved as HTML by older versions, wiki links included", () => {
    const legacy = '<h1>Old</h1><p>See <a data-type="wiki-link" class="wiki-link" href="Glycolysis" target="Glycolysis">Glycolysis</a>.</p><ul><li><p>one</p></li></ul>';
    const html = editorHtml(noteFileToHtml(legacy));
    expect(html).toContain('data-type="wiki-link"');
    expect(html).toContain("<h1>Old</h1>");
    expect(noteHtmlToMarkdown(html)).toBe("# Old\n\nSee [[Glycolysis]].\n\n- one\n");
  });

  it("read plain Markdown files written elsewhere", () => {
    const html = editorHtml(noteFileToHtml("# Title\n\nSome **bold** and [[Page|label]].\n\n- [ ] todo\n- [x] done\n"));
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('target="Page|label"');
    expect(html).toContain('data-checked="true" data-type="taskItem"');
  });

  // Markdown written by hand or by the local AI keeps its form through a read and a save.
  const written = {
    heading: "# Krebs cycle\n",
    emphasis: "Runs in the **matrix**, not the *cytoplasm*.\n",
    bullets: "- Citrate\n- Isocitrate\n",
    numbered: "1. First\n2. Second\n",
    tasks: "- [ ] Draw it\n- [x] Read it\n",
    wiki: "See [[Glycolysis]] and [[Krebs cycle|the cycle]].\n",
    code: "```python\nprint(1)\n```\n",
    table: "| Step | Enzyme |\n| --- | --- |\n| 1 | Citrate synthase |\n",
    link: "[Lecture](https://example.org/krebs)\n",
  };
  for (const [name, markdown] of Object.entries(written)) {
    it(`keep ${name} written elsewhere as it was`, () => {
      expect(noteHtmlToMarkdown(editorHtml(noteFileToHtml(markdown)))).toBe(markdown);
    });
  }

  it("never let a script in a file into the note", () => {
    const html = editorHtml(noteFileToHtml('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n'));
    expect(html).not.toMatch(/<script|onerror/);
  });

  it("keep a note that starts with an HTML tag as Markdown", () => {
    const markdown = '<img src="logo.png" width="80">\n\n# Title\n\n- one\n- two\n\nSome **bold** text.\n';
    const html = editorHtml(noteFileToHtml(markdown));
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toMatch(/<ul><li><p>one<\/p><\/li>/);
  });

  it("keep front matter exactly as it was", () => {
    const markdown = "---\ntitle: Krebs cycle\ntags: [biology, energy]\n---\n# Krebs cycle\n\nRuns in the **matrix**.\n";
    expect(noteHtmlToMarkdown(editorHtml(noteFileToHtml(markdown)))).toBe(markdown);
    expect(noteHtmlToMarkdown(editorHtml(noteFileToHtml("---\n\nA rule, then text.\n")))).toBe("---\n\nA rule, then text.\n");
  });

  it("an empty file is an empty note", () => {
    expect(noteFileToHtml("")).toBe("");
    expect(noteHtmlToMarkdown("<p></p>")).toBe("");
  });
});

describe("files opened in the editor", () => {
  it("notes (.md) are read and written as Markdown; other files as they are", () => {
    expect(fileToEditor("/w/Krebs.md", "# Krebs\n")).toContain("<h1>Krebs</h1>");
    expect(editorToFile("/w/Krebs.md", "<h1>Krebs</h1>")).toBe("# Krebs\n");
    expect(fileToEditor("/w/plain.txt", "# not a heading")).toBe("# not a heading");
    expect(editorToFile("/w/plain.txt", "<p>x</p>")).toBe("<p>x</p>");
  });
});

describe("content handed to the editor", () => {
  it("HTML is used as it is, so code blocks keep their lines", () => {
    const html = noteFileToHtml("Intro.\n\n```\na\n\nb\n```\n");
    expect(editorContentFor(html)).toBe(html);
  });

  it("Markdown text is still turned into HTML", () => {
    expect(editorContentFor("# Title\n\nSome **bold** text")).toContain("<strong>bold</strong>");
  });
});

describe("wiki embeds", () => {
  it("find their picture again after a note is loaded", async () => {
    const editor = makeEditor(noteFileToHtml("A picture: ![[cell.png]]\n"));
    editors.push(editor);
    await vi.waitFor(() => expect(editor.getHTML()).toContain('src="data:image/png;base64,cell.png"'));
    expect(noteHtmlToMarkdown(editor.getHTML())).toBe("A picture: ![[cell.png]]\n");
  });
});
