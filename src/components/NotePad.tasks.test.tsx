// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotePad } from "./NotePad";
import { invoke } from "@tauri-apps/api/core";
import type { Note } from "../features/notes/types";
import type { AppConfig } from "../features/settings/types";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  config: vi.fn(),
  opacity: vi.fn(),
  close: vi.fn(),
  drag: vi.fn(),
  toast: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name, callback) => {
    mocks.listeners.set(name, callback);
    return () => mocks.listeners.delete(name);
  }),
  emit: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "tile-test" }) }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => {}),
  convertFileSrc: (value: string) => value,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../features/settings/api", () => ({
  getConfig: mocks.config,
  saveTileOpacity: mocks.opacity,
}));
vi.mock("../features/notes/api", () => ({
  getNote: mocks.get,
  updateNote: mocks.update,
  listNotes: mocks.list,
  createNote: vi.fn(),
  getErrorMessage: (error: unknown) => String(error),
}));
vi.mock("../features/windows/controls", () => ({
  animateCurrentWindowBounds: vi.fn(async () => {}),
  closeCurrentWindow: mocks.close,
  getCurrentWindowBounds: vi.fn(async () => ({ x: 0, y: 0, width: 300, height: 280 })),
  recycleCurrentNotepad: vi.fn(async () => {}),
  setCurrentWindowAlwaysOnTop: vi.fn(async () => {}),
  showCurrentWindow: vi.fn(async () => {}),
  startCurrentWindowDrag: mocks.drag,
  startCurrentWindowDragWithOffset: mocks.drag,
  startCurrentWindowResize: vi.fn(async () => {}),
}));
vi.mock("../features/images/useImageBaseDir", () => ({ useImageBaseDir: () => null }));
vi.mock("../features/images/useImagePaste", () => ({ useImagePaste: () => ({}) }));
vi.mock("../features/markdown/MarkdownPreviewLazy", async () => {
  const { MarkdownPreview } = await import("../features/markdown/MarkdownPreview");
  return { MarkdownPreviewLazy: MarkdownPreview };
});
vi.mock("./Toast", () => ({ showToast: mocks.toast }));

let container: HTMLDivElement;
let root: Root;
let saved: Note;
let config: Partial<AppConfig>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  mocks.listeners.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  saved = {
    id: "test",
    title: "Today",
    content: "- [ ] First\r\n- [ ] Second\r\n",
    category: "tiles",
    fileName: "test.md",
    createdAt: "2026-09-22",
    updatedAt: "2026-09-22",
    wordCount: 10,
  };
  config = {
    noteSurfaceAutoSave: true,
    tileRenderMarkdown: true,
    tileDoubleClickToEdit: true,
    tileStyle: "floral-purple",
    tileAppearance: "light",
    tileOpacityByNoteId: {},
  };
  mocks.get.mockImplementation(async () => ({ ...saved }));
  mocks.list.mockImplementation(async () => [{ ...saved, preview: "First Second" }]);
  mocks.config.mockImplementation(async () => config);
  mocks.opacity.mockResolvedValue(config);
  mocks.update.mockImplementation(async (_id, request) => {
    saved = { ...saved, ...request };
    return saved;
  });
  mocks.close.mockResolvedValue(undefined);
  mocks.drag.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const renderTile = () =>
  act(() => root.render(<NotePad initialNoteId="test" initialSurfaceMode="tile" />));
const box = (index = 0) => container.querySelectorAll<HTMLInputElement>(".task-checkbox")[index];
const emitNotes = () => act(() => mocks.listeners.get("notes-changed")?.({ payload: null }));
const saveKey = () =>
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }),
    ),
  );

it("matches the native glass backing to explicit dark tiles independently of OS mode", async () => {
  config.tileAppearance = "dark";
  await renderTile();
  expect(invoke).toHaveBeenCalledWith("set_tile_glass", { enabled: true, dark: true });
});

it("keeps a note tile's own opacity when showing the shared task list", async () => {
  config.tileOpacityByNoteId = { test: 0.25 };
  vi.mocked(invoke).mockImplementation(
    async (command) =>
      (command === "todos_get"
        ? { revision: 0, items: [], opacity: 0.65 }
        : "gaussian-blur") as never,
  );
  await renderTile();
  await act(() => (container.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement).click());
  const surface = container.querySelector<HTMLElement>(".glass-surface")!;
  expect(surface.dataset.workspaceMode).toBe("todo");
  expect(surface.style.getPropertyValue("--tile-opacity")).toBe("0.25");
});

it("single-clicks save only source markers and controls never start dragging or edit mode", async () => {
  await renderTile();
  await act(() => {
    box().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    box().click();
    box().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
  expect(box().checked).toBe(true);
  expect(container.querySelector('[data-surface-mode="tile"]')).not.toBeNull();
  expect(mocks.drag).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(950));
  expect(mocks.update).toHaveBeenLastCalledWith("test", {
    title: "Today",
    content: "- [x] First\r\n- [ ] Second\r\n",
    category: "tiles",
  });
});

it("manual mode stays dirty until Ctrl+S; clean tiles sync external saves without replacing dirty edits", async () => {
  config.noteSurfaceAutoSave = false;
  await renderTile();
  saved.content = "- [x] First\r\n- [ ] Second\r\n";
  await emitNotes();
  expect(box().checked).toBe(true);
  await act(() => box(1).click());
  saved.content = "- [ ] Other window";
  await emitNotes();
  expect(box(1).checked).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(mocks.update).not.toHaveBeenCalled();
  await saveKey();
  expect(saved.content).toBe("- [x] First\r\n- [x] Second\r\n");
});

it("failed saves retain the draft, reject external refresh, and prevent tile close until retry succeeds", async () => {
  await renderTile();
  mocks.update.mockRejectedValue(new Error("disk full"));
  await act(() => box().click());
  await act(() => vi.advanceTimersByTimeAsync(950));
  expect(container.textContent).toContain("保存失败");
  saved.content = "- [ ] Other window";
  await emitNotes();
  expect(box().checked).toBe(true);
  await act(() => (container.querySelector("button[aria-label]") as HTMLButtonElement).click());
  expect(mocks.close).not.toHaveBeenCalled();
  expect(box().checked).toBe(true);
  mocks.update.mockImplementation(async (_id, request) => {
    saved = { ...saved, ...request };
    return saved;
  });
  await saveKey();
  expect(saved.content).toBe("- [x] First\r\n- [ ] Second\r\n");
});

it("queues rapid manual saves so an older write cannot overwrite a later toggle", async () => {
  config.noteSurfaceAutoSave = false;
  let finish!: (note: Note) => void;
  mocks.update.mockImplementationOnce(
    () =>
      new Promise<Note>((resolve) => {
        finish = resolve;
      }),
  );
  await renderTile();
  await act(() => box().click());
  await saveKey();
  await act(() => box(1).click());
  await saveKey();
  expect(mocks.update).toHaveBeenCalledTimes(1);
  await act(() => finish({ ...saved, content: "- [x] First\r\n- [ ] Second\r\n" }));
  expect(mocks.update).toHaveBeenCalledTimes(2);
  expect(saved.content).toBe("- [x] First\r\n- [x] Second\r\n");
  expect(box().checked && box(1).checked).toBe(true);
});

it("Ctrl+wheel changes this note's background only; ordinary scrolling is untouched", async () => {
  await renderTile();
  const tile = container.querySelector<HTMLDivElement>(".glass-tile")!;
  const ordinary = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
  await act(() => tile.dispatchEvent(ordinary));
  expect(ordinary.defaultPrevented).toBe(false);
  expect(mocks.opacity).not.toHaveBeenCalled();
  const modified = new WheelEvent("wheel", {
    deltaY: 120,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  await act(() => tile.dispatchEvent(modified));
  expect(modified.defaultPrevented).toBe(true);
  expect(mocks.opacity).toHaveBeenLastCalledWith("test", 0.4);
  expect(tile.style.getPropertyValue("--tile-opacity")).toBe("0.4");
  expect(tile.style.opacity).toBe("");
});
