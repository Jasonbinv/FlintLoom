import { marked } from "marked";
import katex from "katex";

marked.setOptions({
  gfm: true,
  breaks: false,
});

const FORBIDDEN_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META"]);
const ALLOWED_TAGS = new Set([
  "P",
  "BR",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "LI",
  "PRE",
  "CODE",
  "BLOCKQUOTE",
  "STRONG",
  "EM",
  "B",
  "I",
  "A",
  "IMG",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TH",
  "TD",
  "HR",
  "DEL",
  "SPAN",
  "DIV",
  "INPUT",
]);
const ALLOWED_ATTR: Record<string, Set<string>> = {
  A: new Set(["href", "title"]),
  IMG: new Set(["src", "alt", "title"]),
  INPUT: new Set(["type", "checked", "disabled"]),
  CODE: new Set(["class"]),
  PRE: new Set(["class"]),
  TH: new Set(["align"]),
  TD: new Set(["align"]),
};

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("#") || trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("vbscript:") || lower.startsWith("data:text/html")) {
    return false;
  }
  return /^(https?:|mailto:|data:image\/)/i.test(trimmed);
}

function cleanAttributes(el: Element): void {
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on") || name === "style" || name === "srcdoc") {
      el.removeAttribute(attr.name);
      continue;
    }
    const allowed = ALLOWED_ATTR[el.tagName];
    if (allowed) {
      if (!allowed.has(attr.name)) {
        el.removeAttribute(attr.name);
        continue;
      }
    } else if (name !== "class") {
      el.removeAttribute(attr.name);
      continue;
    }
    if ((name === "href" || name === "src") && !isSafeUrl(attr.value)) {
      el.removeAttribute(attr.name);
    }
  }
}

function sanitizeNode(node: Element): void {
  let i = 0;
  while (i < node.children.length) {
    const child = node.children[i]!;
    if (FORBIDDEN_TAGS.has(child.tagName)) {
      child.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(child.tagName)) {
      while (child.firstChild) {
        node.insertBefore(child.firstChild, child);
      }
      child.remove();
      continue;
    }
    cleanAttributes(child);
    sanitizeNode(child);
    i += 1;
  }
}

export function sanitizeMarkdownHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div id="md-root">${html}</div>`, "text/html");
  const root = doc.getElementById("md-root");
  if (!root) return "";
  sanitizeNode(root);
  return root.innerHTML;
}

function renderTex(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, {
    throwOnError: false,
    displayMode,
    output: "html",
    trust: false,
    strict: "ignore",
    maxSize: 20,
    maxExpand: 1000,
  });
}

function mathToken(index: number): string {
  return `%%FL-MATH-${index}%%`;
}

function stashMath(tex: string, displayMode: boolean, slots: string[]): string {
  const html = renderTex(tex, displayMode);
  slots.push(html);
  return mathToken(slots.length - 1);
}

function replaceMathInText(segment: string, slots: string[]): string {
  const withDisplay = segment.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex: string) =>
    stashMath(tex, true, slots),
  );
  return withDisplay.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_match, tex: string) =>
    stashMath(tex, false, slots),
  );
}

function extractMath(source: string): { text: string; slots: string[] } {
  const slots: string[] = [];
  const parts = source.split(/(```[\s\S]*?```|`[^`]+`)/g);
  const text = parts
    .map((part) => {
      if (part.startsWith("```") || (part.startsWith("`") && part.endsWith("`"))) {
        return part;
      }
      return replaceMathInText(part, slots);
    })
    .join("");
  return { text, slots };
}

function restoreMath(html: string, slots: string[]): string {
  return html.replace(/%%FL-MATH-(\d+)%%/g, (_match, index: string) => slots[Number(index)] ?? "");
}

export function renderMarkdownHtml(source: string): string {
  const { text, slots } = extractMath(source);
  const html = marked.parse(text, { async: false }) as string;
  return restoreMath(sanitizeMarkdownHtml(html), slots);
}
