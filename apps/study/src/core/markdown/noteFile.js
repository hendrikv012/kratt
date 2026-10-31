/**
 * Note files: what a note is on disk.
 *
 * Inside the editor a note is HTML; in its .md file it is Markdown. These functions are
 * the crossing: noteHtmlToMarkdown when a note is saved, noteFileToHtml when it is opened.
 * Together they round-trip everything the editor makes (see noteFile.test.js). What
 * Markdown has no syntax for (math, underline, sub/superscript, coloured highlights, tables
 * Markdown can't draw) is written as a small piece of inline HTML, so nothing is lost.
 */

import yaml from "js-yaml";
import MarkdownIt from "markdown-it";
import markdownItMark from "markdown-it-mark";
import TurndownService from "turndown";
import { wikiLinkParts } from "../wiki/parts.js";

// ---------- Markdown → HTML

const md = new MarkdownIt({ html: true, linkify: true, breaks: true, typographer: false }).use(markdownItMark);
md.linkify.set({ fuzzyLink: false }); // only real web addresses become links

// [[path]], [[path#hash|alt]] and ![[path]] become the editor's wiki-link nodes.
md.inline.ruler.before("link", "wikilink", (state, silent) => {
  const start = state.pos;
  const embed = state.src.startsWith("![[", start);
  const open = embed ? start + 1 : start;
  if (!state.src.startsWith("[[", open)) return false;
  const close = state.src.indexOf("]]", open + 2);
  if (close < 0 || close + 2 > state.posMax) return false;
  const raw = state.src.slice(open + 2, close).replace(/\\\|/g, "|"); // "\|" inside a table cell
  if (!raw.trim() || /[\n[]/.test(raw)) return false;
  if (!silent) state.push("wikilink", "", 0).meta = { raw, embed };
  state.pos = close + 2;
  return true;
});

md.renderer.rules.wikilink = (tokens, idx) => {
  const { raw, embed } = tokens[idx].meta;
  const { alt, href } = wikiLinkParts(raw);
  const esc = md.utils.escapeHtml;
  return `<span data-type="wiki-link" target="${esc(raw)}" href="${esc(href)}"${alt ? ` alt="${esc(alt)}"` : ""}${embed ? ' embed="true"' : ""}></span>`;
};

// "- [ ] text" and "- [x] text" become the editor's task list, when every item of the list is a task.
md.core.ruler.push("task_lists", (state) => {
  const tokens = state.tokens;
  const lists = [];
  tokens.forEach((token, i) => {
    if (token.type === "bullet_list_open") lists.push({ open: token, items: [] });
    else if (token.type === "bullet_list_close") {
      const list = lists.pop();
      if (list.items.length && list.items.every((item) => item.marker)) {
        list.open.attrSet("data-type", "taskList");
        for (const { open, first, marker } of list.items) {
          first.content = first.content.slice(marker[0].length);
          open.attrSet("data-type", "taskItem");
          open.attrSet("data-checked", String(marker[1] !== " "));
        }
      }
    } else if (token.type === "list_item_open" && lists.length && token.level === lists.at(-1).open.level + 1) {
      const inline = tokens[i + 2];
      const first = inline?.type === "inline" ? inline.children?.[0] : null;
      const marker = first?.type === "text" ? /^\[([ xX])\](?: |$)/.exec(first.content) : null;
      lists.at(-1).items.push({ open: token, first, marker });
    }
  });
});

// The editor keeps a code block's text exactly, so don't add the newline markdown-it ends it with.
const renderFence = md.renderer.rules.fence;
md.renderer.rules.fence = (...args) => renderFence(...args).replace(/\n<\/code><\/pre>\n$/, "</code></pre>\n");

// Notes saved by older versions of Lokus hold the editor's HTML as it was.
// Notes saved by older versions of Lokus hold the editor's HTML as it was: a block tag, all on
// one line (line breaks only inside code blocks). Markdown that starts with a tag has more lines.
const isOldHtmlNote = (text) =>
  /^\s*<(p|h[1-6]|ul|ol|div|blockquote|pre|table|hr)\b/i.test(text) &&
  !/\n\s*\S/.test(text.replace(/<pre[\s\S]*?<\/pre>/gi, ""));

// YAML front matter at the top of a note ("---", key: value lines, "---") is shown as a code
// block marked "frontmatter" and written back as it was. A rule followed by text isn't YAML.
const FRONT_MATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/;
function splitFrontMatter(text) {
  const match = FRONT_MATTER.exec(text);
  if (!match) return [null, text];
  try {
    const data = yaml.load(match[1]);
    return data && typeof data === "object" && !Array.isArray(data) ? [match[1], text.slice(match[0].length)] : [null, text];
  } catch {
    return [null, text];
  }
}

/** The HTML for the editor of a note file's text: Markdown, or HTML from an older version. */
export function noteFileToHtml(text) {
  if (!text) return "";
  const markdown = (isOldHtmlNote(text) ? noteHtmlToMarkdown(text) : text).replace(/\r\n?/g, "\n");
  const [frontMatter, body] = splitFrontMatter(markdown);
  const head = frontMatter === null ? "" : `<pre><code class="language-frontmatter">${md.utils.escapeHtml(frontMatter)}</code></pre>\n`;
  return head + md.render(body);
}

// ---------- HTML → Markdown

const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
});

// Text that would read as syntax stays text.
const escapeMarkdown = turndown.escape.bind(turndown);
turndown.escape = (text) =>
  escapeMarkdown(text)
    .replace(/&(?=#?[a-zA-Z0-9]+;)/g, "&amp;") // "&amp;" typed as text
    .replace(/</g, "&lt;") // "<b>" typed as text
    .replace(/==/g, "\\=\\=") // highlight
    .replace(/~~/g, "\\~\\~"); // strikethrough

const escapeAttr = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const openTag = (node) =>
  `<${node.nodeName.toLowerCase()}${[...node.attributes].map((a) => ` ${a.name}="${escapeAttr(a.value)}"`).join("")}>`;
const closeTag = (node) => `</${node.nodeName.toLowerCase()}>`;
const attr = (node, name) => node.getAttribute?.(name) ?? null;

turndown.addRule("frontMatter", {
  filter: (node) => node.nodeName === "PRE" && node.firstChild?.nodeName === "CODE" && node.firstChild.classList.contains("language-frontmatter"),
  replacement: (content, node) => `\n\n---\n${node.firstChild.textContent.replace(/\n$/, "")}\n---\n\n`,
});

turndown.addRule("strikethrough", {
  filter: ["del", "s", "strike"],
  replacement: (content) => `~~${content}~~`,
});

turndown.addRule("highlight", {
  filter: (node) => node.nodeName === "MARK" && !attr(node, "data-color") && !attr(node, "style"),
  replacement: (content) => `==${content}==`,
});

// No Markdown for these: keep the tag, with Markdown inside it.
turndown.addRule("inlineHtml", {
  filter: (node) => ["U", "SUP", "SUB"].includes(node.nodeName) || (node.nodeName === "MARK" && (attr(node, "data-color") || attr(node, "style"))),
  replacement: (content, node) => `${openTag(node)}${content}${closeTag(node)}`,
});

// Math keeps its source in an attribute; the text inside is only the editor's display.
turndown.addRule("math", {
  filter: (node) => ["math-inline", "math-block"].includes(attr(node, "data-type")),
  replacement: (content, node) => {
    const tag = `${openTag(node)}${closeTag(node)}`;
    return attr(node, "data-type") === "math-block" ? `\n\n${tag}\n\n` : tag;
  },
});

turndown.addRule("wikiLink", {
  filter: (node) => ["A", "SPAN", "IMG"].includes(node.nodeName) && attr(node, "data-type") === "wiki-link",
  replacement: (content, node) => {
    const target = attr(node, "target") || attr(node, "href") || content;
    if (node.nodeName === "IMG" || attr(node, "embed") === "true") return `![[${target}]]`;
    const alt = attr(node, "alt");
    return alt && alt !== target && !target.includes("|") ? `[[${target}|${alt}]]` : `[[${target}]]`;
  },
});

// Lists that follow each other stay apart: the second uses another marker ("*", or "1)").
const sameListsBefore = (list) => {
  let count = 0;
  for (let prev = list.previousElementSibling; prev?.nodeName === list.nodeName; prev = prev.previousElementSibling) count++;
  return count;
};

// One space after the marker, nested lines indented to the text, and a nested list
// right under its item's first line.
turndown.addRule("listItem", {
  filter: "li",
  replacement: (content, node) => {
    const list = node.parentNode;
    const alternate = sameListsBefore(list) % 2 === 1;
    let marker = alternate ? "* " : "- ";
    if (list.nodeName === "OL") {
      const start = Number(list.getAttribute("start") || 1);
      marker = `${start + Array.prototype.indexOf.call(list.children, node)}${alternate ? ")" : "."} `;
    }
    const task = attr(node, "data-type") === "taskItem" ? (attr(node, "data-checked") === "true" ? "[x] " : "[ ] ") : "";
    const body = content
      .replace(/^\n+/, "")
      .replace(/\n+$/, "\n")
      .replace(/^([^\n]*)\n\n(?=(?:[-*+]|\d+[.)]) )/, "$1\n")
      .replace(/\n(?!\n|$)/g, `\n${" ".repeat(marker.length)}`);
    return marker + task + body.trimEnd() + (node.nextSibling ? "\n" : "");
  },
});

// The editor's task items carry a checkbox; the marker above already says checked or not.
turndown.addRule("taskCheckbox", {
  filter: (node) => node.nodeName === "LABEL" && attr(node.parentNode, "data-type") === "taskItem",
  replacement: () => "",
});

// A table Markdown can draw: a header row, then rows of cells holding one line of text each.
// Any other table (merged or sized cells, lists in cells, no header row) stays HTML.
const rowsOf = (table) => [...table.querySelectorAll("tr")];
const cellsOf = (row) => [...row.children].filter((cell) => ["TH", "TD"].includes(cell.nodeName));
const simpleTable = (table) => {
  const rows = rowsOf(table);
  return (
    rows.length > 0 &&
    rows.every((row, i) => cellsOf(row).length === cellsOf(rows[0]).length && cellsOf(row).every((cell) => cell.nodeName === (i === 0 ? "TH" : "TD"))) &&
    rows.flatMap(cellsOf).every(
      (cell) =>
        !attr(cell, "data-colwidth") &&
        Number(attr(cell, "colspan") || 1) === 1 &&
        Number(attr(cell, "rowspan") || 1) === 1 &&
        cell.children.length <= 1 &&
        [...cell.children].every((child) => child.nodeName === "P") &&
        !cell.querySelector("br")
    )
  );
};
const tableLine = (cells) => `| ${cells.join(" | ")} |`;

turndown.addRule("table", {
  filter: "table",
  replacement: (content, node) => {
    if (!simpleTable(node)) return `\n\n${node.outerHTML}\n\n`;
    const [head, ...body] = rowsOf(node).map((row) => cellsOf(row).map((cell) => turndown.turndown(cell.innerHTML).replace(/\|/g, "\\|")));
    return `\n\n${[tableLine(head), tableLine(head.map(() => "---")), ...body.map(tableLine)].join("\n")}\n\n`;
  },
});

/** The Markdown file text for a note's editor HTML. */
export function noteHtmlToMarkdown(html) {
  let markdown = turndown.turndown(html || "").trim();
  // Front matter is followed straight by the note, without a blank line.
  if (/^\s*<pre><code class="language-frontmatter">/.test(html || "")) markdown = markdown.replace(/^(---\n[\s\S]*?\n---)\n\n/, "$1\n");
  return markdown ? `${markdown}\n` : "";
}

// ---------- Files opened in the editor

const isNote = (path) => path.endsWith(".md");

/** What the editor shows for a file's text: a note (.md) is read as above, other files as they are. */
export const fileToEditor = (path, text) => (isNote(path) ? noteFileToHtml(text) : text);

/** What is written for the editor's HTML: Markdown for a note (.md), other files as they are. */
export const editorToFile = (path, html) => (isNote(path) ? noteHtmlToMarkdown(html) : html);
