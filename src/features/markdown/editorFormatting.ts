import type { TFunction } from "i18next";

export type FormatAction =
  | "bold"
  | "italic"
  | "heading"
  | "hr"
  | "ul"
  | "ol"
  | "code"
  | "quote"
  | "inlineMath"
  | "blockMath";

export interface FormattedText {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Apply a toolbar formatting action without depending on the editor DOM. */
export function formatMarkdownText(
  value: string,
  start: number,
  end: number,
  action: FormatAction,
  translate: TFunction,
): FormattedText {
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lineStart = before.lastIndexOf("\n") + 1;
  const currentLine = before.slice(lineStart);

  let result: string;
  let selectionStart: number;
  let selectionEnd: number;

  switch (action) {
    case "bold": {
      const fallback = translate("main.formatSample.boldText", { defaultValue: "粗体文本" });
      const wrapped = `**${selected || fallback}**`;
      result = before + wrapped + after;
      selectionStart = start + 2;
      selectionEnd = selectionStart + (selected || fallback).length;
      break;
    }
    case "italic": {
      const fallback = translate("main.formatSample.italicText", { defaultValue: "斜体文本" });
      const wrapped = `*${selected || fallback}*`;
      result = before + wrapped + after;
      selectionStart = start + 1;
      selectionEnd = selectionStart + (selected || fallback).length;
      break;
    }
    case "heading": {
      const prefix = currentLine.match(/^(#{1,5})\s/);
      if (prefix) {
        const newLevel = prefix[1].length < 5 ? "#".repeat(prefix[1].length + 1) : "#";
        const beforeLine = value.slice(0, lineStart);
        const afterPrefix = value.slice(lineStart + prefix[0].length);
        result = beforeLine + newLevel + " " + afterPrefix;
        const offset = newLevel.length + 1 - prefix[0].length;
        selectionStart = start + offset;
        selectionEnd = end + offset;
      } else if (currentLine.length > 0 && start === end) {
        result = value.slice(0, lineStart) + "## " + value.slice(lineStart);
        selectionStart = start + 3;
        selectionEnd = selectionStart;
      } else if (selected) {
        result = before + `## ${selected}` + after;
        selectionStart = start + 3;
        selectionEnd = selectionStart + selected.length;
      } else {
        result =
          before +
          `## ${translate("main.formatSample.headingText", { defaultValue: "标题" })}` +
          after;
        selectionStart = start + 3;
        selectionEnd = selectionStart + 2;
      }
      break;
    }
    case "hr": {
      const newlineBefore = before.endsWith("\n") || before === "" ? "" : "\n";
      const newlineAfter = after.startsWith("\n") || after === "" ? "" : "\n";
      result = before + `${newlineBefore}---${newlineAfter}` + after;
      selectionStart = selectionEnd = before.length + newlineBefore.length + 3;
      break;
    }
    case "ul": {
      if (selected.includes("\n")) {
        const lines = selected
          .split("\n")
          .map((line) => `- ${line}`)
          .join("\n");
        result = before + lines + after;
        selectionStart = start;
        selectionEnd = start + lines.length;
      } else {
        const fallback = translate("main.formatSample.listItem", { defaultValue: "列表项" });
        const item = `- ${selected || fallback}`;
        result = before + item + after;
        selectionStart = start + 2;
        selectionEnd = selectionStart + (selected || fallback).length;
      }
      break;
    }
    case "ol": {
      if (selected.includes("\n")) {
        const lines = selected
          .split("\n")
          .map((line, index) => `${index + 1}. ${line}`)
          .join("\n");
        result = before + lines + after;
        selectionStart = start;
        selectionEnd = start + lines.length;
      } else {
        const fallback = translate("main.formatSample.listItem", { defaultValue: "列表项" });
        const item = `1. ${selected || fallback}`;
        result = before + item + after;
        selectionStart = start + 3;
        selectionEnd = selectionStart + (selected || fallback).length;
      }
      break;
    }
    case "code": {
      if (selected.includes("\n")) {
        const wrapped = "```\n" + selected + "\n```";
        result = before + wrapped + after;
        selectionStart = start + 4;
        selectionEnd = selectionStart + selected.length;
      } else {
        const fallback = translate("main.formatSample.codeText", { defaultValue: "代码" });
        const wrapped = `\`${selected || fallback}\``;
        result = before + wrapped + after;
        selectionStart = start + 1;
        selectionEnd = selectionStart + (selected || fallback).length;
      }
      break;
    }
    case "quote": {
      if (selected.includes("\n")) {
        const lines = selected
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
        result = before + lines + after;
        selectionStart = start;
        selectionEnd = start + lines.length;
      } else {
        const fallback = translate("main.formatSample.quoteText", { defaultValue: "引用文本" });
        const item = `> ${selected || fallback}`;
        result = before + item + after;
        selectionStart = start + 2;
        selectionEnd = selectionStart + (selected || fallback).length;
      }
      break;
    }
    case "inlineMath": {
      const sample = selected || "E=mc^2";
      result = before + `$${sample}$` + after;
      selectionStart = start + 1;
      selectionEnd = selectionStart + sample.length;
      break;
    }
    case "blockMath": {
      const sample = selected || "x^2 + y^2 = r^2";
      result = before + `\n$$\n${sample}\n$$\n` + after;
      selectionStart = start + 4;
      selectionEnd = selectionStart + sample.length;
      break;
    }
  }

  return { value: result, selectionStart, selectionEnd };
}
