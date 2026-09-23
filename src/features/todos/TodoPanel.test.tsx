// @vitest-environment jsdom
import { act, createRef, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TodoPanel, type TodoPanelHandle } from "./TodoPanel";
import { createTodoClient, optimisticTodo, type TodoState } from "./store";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../notes/api", () => ({ getErrorMessage: String }));
let container: HTMLDivElement;
let root: Root;
let client: ReturnType<typeof createTodoClient>;
let disk: TodoState;
let fail = false;
const panel = createRef<TodoPanelHandle>();
function Harness() {
  const snapshot = useSyncExternalStore(client.subscribe, client.snapshot);
  return <TodoPanel ref={panel} model={{ ...snapshot, client }} active />;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fail = false;
  disk = { revision: 0, items: [], opacity: 0.45 };
  client = createTodoClient(async (action) => {
    if (fail) throw new Error("disk full");
    disk = { ...optimisticTodo(disk, action), revision: disk.revision + 1 };
    return disk;
  });
  client.receive(disk);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root.render(<Harness />));
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});
const composer = () => container.querySelector<HTMLTextAreaElement>(".todo-composer textarea")!;
const input = async (element: HTMLTextAreaElement, text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      element,
      text,
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
const key = (element: Element, init: KeyboardEventInit) =>
  act(() =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    ),
  );

it("Enter adds a task and stays ready for the next; empty Enter/Escape create nothing", async () => {
  const list = container.querySelector<HTMLDivElement>(".todo-list")!;
  Object.defineProperty(list, "scrollHeight", { value: 500 });
  await input(composer(), "One");
  await key(composer(), { key: "Enter" });
  expect(list.scrollTop).toBe(500);
  expect(disk.items.map((item) => item.text)).toEqual(["One"]);
  expect(document.activeElement).toBe(composer());
  expect(composer().value).toBe("");
  await input(composer(), "Two");
  await key(composer(), { key: "Enter" });
  expect(disk.items).toHaveLength(2);
  await key(composer(), { key: "Enter" });
  expect(document.activeElement).not.toBe(composer());
  composer().focus();
  await key(composer(), { key: "Escape" });
  expect(disk.items).toHaveLength(2);
});
it("Shift+Enter and IME confirmation do not submit; multiline content is preserved", async () => {
  await input(composer(), "中文");
  await key(composer(), { key: "Enter", isComposing: true });
  await key(composer(), { key: "Enter", keyCode: 229 });
  await key(composer(), { key: "Enter", shiftKey: true });
  expect(disk.items).toHaveLength(0);
  await input(composer(), "中文\n第二行");
  await key(composer(), { key: "Enter" });
  expect(disk.items[0].text).toBe("中文\n第二行");
});
it("single click checks/unchecks; edits autosave and keyboard reordering preserves IDs", async () => {
  await input(composer(), "One");
  await key(composer(), { key: "Enter" });
  await input(composer(), "Two");
  await key(composer(), { key: "Enter" });
  const firstId = disk.items[0].id;
  const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(() => box.click());
  expect(disk.items[0].completed).toBe(true);
  await act(() => box.click());
  expect(disk.items[0].completed).toBe(false);
  await act(() => container.querySelector<HTMLButtonElement>(".todo-text")!.click());
  const edit = container.querySelector<HTMLTextAreaElement>(".todo-editor")!;
  vi.useFakeTimers();
  await input(edit, "Edited");
  await act(() => vi.advanceTimersByTimeAsync(450));
  expect(disk.items[0]).toMatchObject({ id: firstId, text: "Edited" });
  await key(edit, { key: "Enter" });
  await key(container.querySelectorAll(".todo-grip")[1], { key: "ArrowUp", altKey: true });
  expect(disk.items[1].id).toBe(firstId);
});
it("a failed close retains the draft, and repeated flush never duplicates it", async () => {
  await input(composer(), "Unsaved draft");
  fail = true;
  await act(async () => {
    await expect(panel.current!.flush()).rejects.toThrow("disk full");
  });
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.textContent).toContain("Unsaved draft");
  fail = false;
  await act(async () => {
    await client.retry();
    await Promise.all([panel.current!.flush(), panel.current!.flush()]);
  });
  expect(disk.items).toHaveLength(1);
});
