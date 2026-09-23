interface MarkdownNode {
  type: string;
  checked?: boolean | null;
  position?: { start: { offset?: number } };
  data?: { hProperties?: Record<string, unknown> };
  children?: MarkdownNode[];
}

interface HtmlNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
}

const INLINE_TASK_ELEMENTS = new Set([
  "a",
  "br",
  "code",
  "del",
  "em",
  "img",
  "s",
  "span",
  "strong",
  "sub",
  "sup",
]);

/** Change exactly the marker identified by the parser, preserving every other byte. */
export function toggleTaskMarker(source: string, offset: number, checked: boolean): string {
  if (
    !Number.isInteger(offset) ||
    offset < 1 ||
    !/^\[[ xX]\]$/.test(source.slice(offset - 1, offset + 2))
  ) {
    return source;
  }
  return source.slice(0, offset) + (checked ? "x" : " ") + source.slice(offset + 1);
}

/** Only GFM listItem nodes are eligible; code fences and raw HTML are never tasks. */
export function remarkTaskPositions() {
  return (tree: MarkdownNode, file: { value: unknown }) => {
    const source = String(file.value);
    const walk = (node: MarkdownNode) => {
      const start = node.position?.start.offset;
      if (node.type === "listItem" && typeof node.checked === "boolean" && start != null) {
        const marker = /^(?:[-+*]|\d+[.)])[\t ]+\[([ xX])\](?=[\t \r\n]|$)/.exec(
          source.slice(start),
        );
        if (marker) {
          node.data = {
            ...node.data,
            hProperties: {
              ...node.data?.hProperties,
              "data-task-offset": start + marker[0].lastIndexOf("[") + 1,
              "data-task-checked": String(node.checked),
            },
          };
        }
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

/** Tag the generated checkbox before raw HTML parsing. Style only its own task text. */
export function rehypeTaskControls() {
  return (tree: HtmlNode) => {
    const walk = (node: HtmlNode) => {
      node.children?.forEach(walk);
      const offset = node.properties?.["data-task-offset"];
      if (node.tagName !== "li" || typeof offset !== "number") return;
      const first = node.children?.find((child) => child.type === "element");
      const input = first?.tagName === "p" ? first.children?.[0] : first;
      if (input?.tagName !== "input" || input.properties?.type !== "checkbox") return;
      input.properties = { ...input.properties, "data-task-offset": offset };
      const completed = node.properties?.["data-task-checked"] === "true";
      const wrap = (children: HtmlNode[]): HtmlNode[] =>
        children.map((child) => {
          if (child.tagName === "ul" || child.tagName === "ol" || child.tagName === "input")
            return child;
          // Keep block structure (quotes, code blocks, tables) intact. Decorating
          // its text instead also avoids inheriting strike-through into child tasks.
          if (child.type !== "text" && !INLINE_TASK_ELEMENTS.has(child.tagName ?? "")) {
            return child.children ? { ...child, children: wrap(child.children) } : child;
          }
          return {
            type: "element",
            tagName: "span",
            properties: {
              className: completed ? ["task-text", "task-completed"] : ["task-text"],
            },
            children: [child],
          };
        });
      node.children = wrap(node.children ?? []);
    };
    walk(tree);
  };
}
