// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
import { toggleTaskMarker } from "./taskList";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});

function Editor({
  initial,
  html = false,
  changed = () => {},
}: {
  initial: string;
  html?: boolean;
  changed?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MarkdownPreview
      content={value}
      renderHtml={html}
      onContentChange={(next) => {
        setValue(next);
        changed(next);
      }}
    />
  );
}

describe("source-position task controls", () => {
  it.each([false, true])(
    "toggles only the chosen duplicate, preserving CRLF and formatting (HTML %s)",
    async (html) => {
      const initial =
        "# 标题 😀\r\n\r\n- [ ] **相同**\r\n- [ ] **相同**\r\n  - [X] nested\r\n\r\n1. [ ] ordered\r\n\r\n```md\r\n- [ ] code\r\n```\r\n";
      const changed = vi.fn();
      await act(() => root.render(<Editor initial={initial} html={html} changed={changed} />));
      const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      expect(boxes).toHaveLength(4);
      expect([...boxes].every((box) => !box.disabled)).toBe(true);
      await act(() => boxes[1].click());
      const expected = initial.replace("- [ ] **相同**\r\n  -", "- [x] **相同**\r\n  -");
      expect(changed).toHaveBeenLastCalledWith(expected);
      expect(boxes[1].checked).toBe(true);
      await act(() => boxes[1].click());
      expect(changed).toHaveBeenLastCalledWith(initial);
      await act(() => boxes[2].click());
      expect(changed).toHaveBeenLastCalledWith(initial.replace("[X] nested", "[ ] nested"));
      await act(() => boxes[3].click());
      expect(changed).toHaveBeenLastCalledWith(
        initial.replace("[X] nested", "[ ] nested").replace("[ ] ordered", "[x] ordered"),
      );
    },
  );

  it("does not toggle text, propagate control gestures, or strike an incomplete child", async () => {
    const changed = vi.fn();
    const parentClick = vi.fn();
    const parentDrag = vi.fn();
    const parentDouble = vi.fn();
    await act(() =>
      root.render(
        <div onClick={parentClick} onMouseDown={parentDrag} onDoubleClick={parentDouble}>
          <Editor initial={"- [x] Parent\n  - [ ] Child"} changed={changed} />
        </div>,
      ),
    );
    const tasks = container.querySelectorAll("li");
    expect(
      [...tasks[0].querySelectorAll(".task-completed")].map((el) => el.textContent).join(""),
    ).toContain("Parent");
    expect(tasks[1].closest(".task-completed")).toBeNull();
    expect(tasks[1].querySelector(".task-completed")).toBeNull();
    await act(() => (tasks[1].querySelector(".task-text") as HTMLElement).click());
    expect(changed).not.toHaveBeenCalled();
    parentClick.mockClear();
    const box = tasks[1].querySelector("input")!;
    await act(() => {
      box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      box.click();
      box.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(parentClick).not.toHaveBeenCalled();
    expect(parentDrag).not.toHaveBeenCalled();
    expect(parentDouble).not.toHaveBeenCalled();
  });

  it("handles quoted and loose task lists and leaves raw HTML controls disabled", async () => {
    const changed = vi.fn();
    const source = '> - [ ] quote\n\n- [ ] loose\n\n  detail\n\n<input type="checkbox" />';
    await act(() => root.render(<Editor initial={source} html changed={changed} />));
    const boxes = container.querySelectorAll<HTMLInputElement>("input");
    expect(boxes).toHaveLength(3);
    expect(boxes[2].disabled).toBe(true);
    await act(() => boxes[0].click());
    await act(() => boxes[1].click());
    expect(changed).toHaveBeenLastCalledWith(
      source.replace("[ ] quote", "[x] quote").replace("[ ] loose", "[x] loose"),
    );
  });

  it("keeps read-only previews disabled and rejects invalid source offsets", async () => {
    await act(() => root.render(<MarkdownPreview content="- [ ] read only" />));
    expect(container.querySelector("input")!.disabled).toBe(true);
    for (const offset of [-1, 0, 2, 5, 100, NaN, 3.5]) {
      expect(toggleTaskMarker("- [ ] a", offset, true)).toBe("- [ ] a");
    }
  });

  it("keeps block content valid without striking unfinished nested tasks", async () => {
    await act(() =>
      root.render(
        <Editor
          initial={"- [x] Parent\n\n  > detail\n\n  ```txt\n  code\n  ```\n\n  - [ ] Child"}
        />,
      ),
    );
    expect(container.querySelector("span > blockquote, span > pre, span > p")).toBeNull();
    expect(container.querySelector("blockquote p .task-completed")?.textContent).toContain(
      "detail",
    );
    const child = container.querySelectorAll("li")[1];
    expect(child.closest(".task-completed")).toBeNull();
    expect(child.querySelector(".task-completed")).toBeNull();
  });

  it("keeps keyboard focus after toggling and ignores forged HTML task offsets", async () => {
    const changed = vi.fn();
    await act(() =>
      root.render(
        <Editor
          initial={'- [ ] Real\n\n<input type="checkbox" data-task-offset="3" />'}
          html
          changed={changed}
        />,
      ),
    );
    const boxes = container.querySelectorAll<HTMLInputElement>("input");
    expect(boxes[1].disabled).toBe(true);
    boxes[0].focus();
    await act(() => boxes[0].click());
    expect(document.activeElement).toBe(boxes[0]);
    expect(boxes[0].checked).toBe(true);
  });
});
