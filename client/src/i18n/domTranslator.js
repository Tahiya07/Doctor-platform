import { translate } from "./translate.js";

/**
 * Shows the whole page in Bengali. It translates the text and the label-like attributes (placeholder, aria-label,
 * title, alt) of everything on the page, and keeps doing so for whatever appears later: dialogs, loaded data, toasts.
 * Text that has no Bengali entry (names, emails, what people typed) is left exactly as it is.
 *
 * The English text is remembered per node, so switching back restores it exactly. React keeps working normally:
 * when it writes new English text into a node, the change is seen and translated again before the next paint.
 */
const ATTRIBUTES = ["placeholder", "aria-label", "title", "alt"];
const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE", "NOSCRIPT"]);

const original = new WeakMap(); // text node -> { source, shown }
const originalAttributes = new WeakMap(); // element -> { [attribute]: { source, shown } }

const skipped = (node) => {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  return !element || SKIPPED_TAGS.has(element.tagName) || Boolean(element.closest?.("[translate='no']"));
};

function translateText(node) {
  if (skipped(node)) return;
  const remembered = original.get(node);
  if (remembered && node.nodeValue === remembered.shown) return; // our own write
  const value = node.nodeValue ?? "";
  const bengali = translate(value);
  if (!bengali) {
    original.delete(node);
    return;
  }
  const lead = value.match(/^\s*/)[0];
  const trail = value.match(/\s*$/)[0];
  const shown = lead + bengali + trail;
  original.set(node, { source: value, shown });
  node.nodeValue = shown;
}

function translateAttributes(element) {
  // A text box's placeholder is interface text even though what is typed into it is not.
  if (element.closest?.("[translate='no']") || ["SCRIPT", "STYLE"].includes(element.tagName)) return;
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value == null) continue;
    const remembered = originalAttributes.get(element)?.[name];
    if (remembered && value === remembered.shown) continue;
    const bengali = translate(value);
    if (!bengali) {
      const map = originalAttributes.get(element);
      if (map) delete map[name];
      continue;
    }
    const map = originalAttributes.get(element) ?? {};
    map[name] = { source: value, shown: bengali };
    originalAttributes.set(element, map);
    element.setAttribute(name, bengali);
  }
}

function walk(root) {
  if (root.nodeType === Node.TEXT_NODE) return translateText(root);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const selector = ATTRIBUTES.map((name) => `[${name}]`).join(",");
  if (root.matches(selector)) translateAttributes(root);
  root.querySelectorAll(selector).forEach(translateAttributes);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) translateText(node);
}

function restore(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const remembered = original.get(node);
    if (remembered && node.nodeValue === remembered.shown) node.nodeValue = remembered.source;
    original.delete(node);
  }
  root.querySelectorAll(ATTRIBUTES.map((name) => `[${name}]`).join(",")).forEach((element) => {
    const map = originalAttributes.get(element);
    if (!map) return;
    for (const [name, { source, shown }] of Object.entries(map))
      if (element.getAttribute(name) === shown) element.setAttribute(name, source);
    originalAttributes.delete(element);
  });
}

/** Starts translating `root` (and the document title). Returns a function that stops and restores the English text. */
export function startBengaliTranslation(root = document.body) {
  const title = document.querySelector("title");
  const everything = () => {
    walk(root);
    if (title) walk(title);
  };
  everything();

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") translateText(record.target);
      else if (record.type === "attributes") translateAttributes(record.target);
      else record.addedNodes.forEach((node) => walk(node));
    }
  });
  const options = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRIBUTES,
  };
  observer.observe(root, options);
  if (title) observer.observe(title, { childList: true, subtree: true, characterData: true });

  return () => {
    observer.disconnect();
    restore(root);
    if (title) restore(title);
  };
}
