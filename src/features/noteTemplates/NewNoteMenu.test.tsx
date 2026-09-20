// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewNoteMenu } from "./NewNoteMenu";
import { syncLanguage } from "../../locales";
import { NOTE_TEMPLATE_TYPES } from "./templates";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await syncLanguage("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});

async function openMenu(onCreate = vi.fn(async () => {})) {
  await act(() => root.render(<NewNoteMenu onCreate={onCreate} />));
  const trigger = container.querySelector("button")!;
  await act(() => trigger.click());
  return { trigger, onCreate };
}

describe("new-note menu", () => {
  it.each(NOTE_TEMPLATE_TYPES)("creates only the selected %s note and closes", async (type) => {
    const { trigger, onCreate } = await openMenu();
    const items = document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    expect(Array.from(items, (item) => item.textContent)).toEqual([
      "空白笔记",
      "日记",
      "周小结",
      "月报",
    ]);
    await act(() => items[NOTE_TEMPLATE_TYPES.indexOf(type)].click());
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(type);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("supports keyboard navigation and Escape without creating anything", async () => {
    const { trigger, onCreate } = await openMenu();
    const menu = document.querySelector('[role="menu"]')!;
    expect(document.activeElement?.textContent).toBe("空白笔记");
    await act(() =>
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    expect(document.activeElement?.textContent).toBe("日记");
    await act(() =>
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
    );
    expect(document.activeElement?.textContent).toBe("月报");
    await act(() =>
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("dismisses on outside click without creating anything", async () => {
    const { onCreate } = await openMenu();
    await act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("prevents another creation while saving", async () => {
    let finish!: () => void;
    const onCreate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { trigger } = await openMenu(onCreate);
    await act(() => document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
    expect(trigger.disabled).toBe(true);
    await act(() => trigger.click());
    expect(onCreate).toHaveBeenCalledTimes(1);
    await act(() => finish());
    expect(trigger.disabled).toBe(false);
  });

  it("refreshes the open menu when the application language changes", async () => {
    await openMenu();
    await act(() => syncLanguage("en-US"));
    expect(
      Array.from(document.querySelectorAll('[role="menuitem"]'), (item) => item.textContent),
    ).toEqual(["Blank Note", "Diary", "Weekly Summary", "Monthly Report"]);
    await act(() => syncLanguage("zh-HK"));
    expect(
      Array.from(document.querySelectorAll('[role="menuitem"]'), (item) => item.textContent),
    ).toEqual(["空白筆記", "日記", "週小結", "月報"]);
  });
});
