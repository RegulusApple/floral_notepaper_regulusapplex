// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { syncLanguage } from "../../locales";
import { NoteLibraryTree } from "./NoteLibraryTree";
import { FolderDialog, PeriodDialog } from "./LibraryDialogs";
import { LibraryHeader } from "./LibraryHeader";
import type { NoteMetadata } from "../notes/types";
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

const record = (id: string, fields: Partial<NoteMetadata> = {}): NoteMetadata => ({
  id,
  title: id,
  category: "",
  fileName: id + ".md",
  preview: "A note",
  wordCount: 6,
  createdAt: "2026-09-20T12:00:00Z",
  updatedAt: "2026-09-20T12:00:00Z",
  ...fields,
});

const treeProps = () => ({
  notes: [] as NoteMetadata[],
  folders: [] as string[],
  activeFolder: "",
  selectedId: null,
  onSelectFolder: vi.fn(),
  onSelectNote: vi.fn(),
  onNoteMenu: vi.fn(),
  onFolderMenu: vi.fn(),
  onMoveNote: vi.fn(),
  onRefresh: vi.fn(),
});

it.each([
  ["zh-CN", "笔记", "2020年第53周", "2026年10月", "2026年"],
  ["zh-HK", "筆記", "2020年第53週", "2026年10月", "2026年"],
  ["en-US", "Notes", "2020 · Week 53", "2026-10", "2026"],
])(
  "shows localized archive groups without changing paths in %s",
  async (locale, title, week, month, year) => {
    await syncLanguage(locale);
    const props = treeProps();
    props.folders = ["Work", "Empty"];
    props.notes = [
      record("New year diary", {
        recordType: "diary",
        recordPeriod: "2021-01-01",
        category: "diary/2020/2020-W53",
      }),
      record("Year-end diary", {
        recordType: "diary",
        recordPeriod: "2020-12-31",
        category: "diary/2020/2020-W53",
        createdAt: "2026-09-21T12:00:00Z",
      }),
      record("Weekly note", {
        recordType: "weekly",
        recordPeriod: "2026-W40",
        category: "weekly/2026/10",
      }),
      record("Monthly note", {
        recordType: "monthly",
        recordPeriod: "2026-09",
        category: "monthly/2026",
      }),
      record("Root note"),
    ];
    await act(() => root.render(<NoteLibraryTree {...props} />));
    const nav = container.querySelector("nav")!;
    expect(nav.getAttribute("aria-label")).toBe(title);
    expect(container.querySelector('[data-folder-path=""]')).toBeNull();
    expect(container.querySelector('[title="diary/2020"]')).toBeNull();
    expect(container.querySelector('[title="weekly/2026"]')).toBeNull();
    expect(container.querySelector(`[title="${week}"]`)!.textContent).toBe(week);
    expect(container.querySelector(`[title="${month}"]`)!.textContent).toBe(month);
    expect(container.querySelector(`[title="${year}"]`)!.textContent).toBe(year);
    expect(
      Array.from(container.querySelectorAll("[title]")).some((el) =>
        el.getAttribute("title")?.includes("diary/"),
      ),
    ).toBe(false);
    expect(
      Array.from(nav.children)
        .slice(0, 4)
        .map((el) => el.getAttribute("data-folder-path")),
    ).toEqual(["diary", "weekly", "monthly", "tiles"]);
    const diary = container.querySelector('[data-folder-path="diary"]')!;
    expect(
      Array.from(diary.querySelectorAll("[data-note-id]")).map((el) =>
        el.getAttribute("data-note-id"),
      ),
    ).toEqual(["New year diary", "Year-end diary"]);
    expect(diary.querySelector(".library-date")!.textContent).toBe("01-01");
    expect(nav.lastElementChild!.getAttribute("data-note-id")).toBe("Root note");
    await act(() =>
      diary.querySelector<HTMLButtonElement>(".library-folder-row > button[title]")!.click(),
    );
    expect(props.onSelectFolder).toHaveBeenCalledWith("diary");
    expect(props.onSelectNote).not.toHaveBeenCalled();
    await act(() => diary.querySelector<HTMLButtonElement>("[aria-expanded]")!.click());
    expect(diary.querySelector(".library-folder-children")?.getAttribute("data-expanded")).toBe(
      "false",
    );
    expect(diary.querySelector(".library-folder-chevron")?.classList).not.toContain("is-open");
    expect(diary.querySelector(".library-folder-children")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(props.onSelectNote).not.toHaveBeenCalled();
    await act(() => diary.querySelector<HTMLButtonElement>("[aria-expanded]")!.click());
    expect(diary.querySelector(".library-folder-children")?.getAttribute("data-expanded")).toBe(
      "true",
    );
    expect(diary.querySelector(".library-folder-chevron")?.classList).toContain("is-open");
    await act(() => diary.querySelector<HTMLButtonElement>("[data-note-id]")!.click());
    expect(props.onSelectNote).toHaveBeenCalledExactlyOnceWith("New year diary");
  },
);

it("keeps empty folders selectable with an empty state and no useless arrow", async () => {
  const props = treeProps();
  props.folders = ["Empty"];
  props.activeFolder = "Empty";
  await act(() => root.render(<NoteLibraryTree {...props} />));
  const empty = container.querySelector('[data-folder-path="Empty"]')!;
  expect(empty.querySelector("[aria-expanded]")).toBeNull();
  expect(empty.querySelector("p")!.textContent).toBeTruthy();
  await act(() => empty.querySelector<HTMLButtonElement>("button")!.click());
  expect(props.onSelectFolder).toHaveBeenCalledWith("Empty");
  expect(props.onSelectNote).not.toHaveBeenCalled();
});

it("retains context menus and drag destinations for custom folders only", async () => {
  const props = treeProps();
  props.folders = ["Work/Deep"];
  props.notes = [record("Movable")];
  await act(() => root.render(<NoteLibraryTree {...props} />));
  const row = container.querySelector('[data-note-id="Movable"]')!;
  const dataTransfer = { setData: vi.fn(), getData: vi.fn(() => "Movable"), effectAllowed: "" };
  const drag = (name: string) => {
    const event = new Event(name, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    return event;
  };
  await act(() => {
    row.dispatchEvent(drag("dragstart"));
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    container
      .querySelector('[data-folder-path="Work/Deep"] .library-folder-row')!
      .dispatchEvent(drag("drop"));
    container
      .querySelector('[data-folder-path="diary"] .library-folder-row')!
      .dispatchEvent(drag("drop"));
  });
  expect(dataTransfer.setData).toHaveBeenCalledWith("application/x-floral-note", "Movable");
  expect(props.onNoteMenu).toHaveBeenCalledWith(expect.anything(), "Movable");
  expect(props.onMoveNote).toHaveBeenCalledExactlyOnceWith("Movable", "Work/Deep");
});

it("keeps a root destination in the Notes header after hiding the root node", async () => {
  const props = {
    count: 3,
    externalCount: 0,
    active: true,
    onSelectRoot: vi.fn(),
    onNewFolder: vi.fn(),
    onRefresh: vi.fn(),
    onMoveNote: vi.fn(),
  };
  await act(() => root.render(<LibraryHeader {...props} />));
  const header = container.querySelector<HTMLButtonElement>(".library-root-button")!;
  await act(() => header.click());
  expect(props.onSelectRoot).toHaveBeenCalledTimes(1);
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", { value: { getData: () => "note-id" } });
  await act(() => header.dispatchEvent(drop));
  expect(props.onMoveNote).toHaveBeenCalledExactlyOnceWith("note-id", "");
  await act(() => container.querySelector<HTMLButtonElement>('[aria-label="刷新"]')!.click());
  expect(props.onRefresh).toHaveBeenCalledTimes(1);
  await act(() => container.querySelectorAll<HTMLButtonElement>("button")[2].click());
  expect(props.onNewFolder).toHaveBeenCalledTimes(1);
});
it("selects folders independently of expanding them and retains nested paths", async () => {
  const onSelectFolder = vi.fn(),
    onRefresh = vi.fn();
  await act(() =>
    root.render(
      <NoteLibraryTree
        notes={[]}
        folders={["Work/Deep"]}
        activeFolder=""
        selectedId={null}
        onSelectFolder={onSelectFolder}
        onSelectNote={vi.fn()}
        onNoteMenu={vi.fn()}
        onFolderMenu={vi.fn()}
        onMoveNote={vi.fn()}
        onRefresh={onRefresh}
      />,
    ),
  );
  await act(() =>
    container
      .querySelector<HTMLButtonElement>('[data-folder-path="Work/Deep"] button[title]')!
      .click(),
  );
  expect(onSelectFolder).toHaveBeenCalledExactlyOnceWith("Work/Deep");
  await act(() =>
    container.querySelector<HTMLButtonElement>('button[aria-label="收起 Work"]')!.click(),
  );
  expect(onSelectFolder).toHaveBeenCalledTimes(1);
  expect(
    container
      .querySelector('[data-folder-path="Work"] .library-folder-children')
      ?.getAttribute("data-expanded"),
  ).toBe("false");
  expect(container.querySelector('[data-folder-path="Work/Deep"] button[title]')).not.toBeNull();
  expect(onRefresh).toHaveBeenCalledTimes(2);
});
it("adopts without moving by default, keeps dialog open on a conflict", async () => {
  const onSubmit = vi.fn().mockRejectedValue({ code: "recordPeriodConflict" });
  const onClose = vi.fn();
  await act(() =>
    root.render(
      <PeriodDialog
        kind="diary"
        period="2024-02-29"
        editing
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    ),
  );
  expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  await act(() =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("diary", "2024-02-29", false);
  expect(container.querySelector('[role="alert"]')!.textContent).toContain("该周期已有记录");
  expect(onClose).not.toHaveBeenCalled();
});
it("prevents double submit while a period note is being created", async () => {
  let finish!: () => void;
  const onSubmit = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const onClose = vi.fn();
  await act(() =>
    root.render(
      <PeriodDialog
        kind="weekly"
        period="2026-W40"
        editing={false}
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    ),
  );
  expect(container.textContent).toContain("weekly/2026/10");
  await act(() => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  await act(() => finish());
  expect(onClose).toHaveBeenCalledTimes(1);
});
it("cancels a dialog without changing files and excludes a folder's descendants", async () => {
  const onSubmit = vi.fn(),
    onClose = vi.fn();
  await act(() =>
    root.render(
      <FolderDialog
        path="Work"
        folders={["Work", "Work/Deep", "Other", "diary", "tiles"]}
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    ),
  );
  expect(Array.from(container.querySelectorAll("option")).map((option) => option.value)).toEqual([
    "",
    "Other",
  ]);
  await act(() =>
    container
      .querySelector('[role="dialog"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onSubmit).not.toHaveBeenCalled();
});
