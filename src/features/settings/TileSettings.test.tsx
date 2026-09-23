// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TileSettings } from "./TileSettings";
import { Tile } from "../../components/Tile";
import { syncLanguage } from "../../locales";
import type { AppConfig } from "./types";
import type { NoteMetadata } from "../notes/types";

const saveOpacity = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("./api", () => ({ saveTileOpacity: saveOpacity }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  saveOpacity.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const initial: AppConfig = {
  locale: "zh-CN",
  dataDir: "",
  globalShortcut: "",
  closeToTray: false,
  autostart: false,
  defaultViewMode: "split",
  noteAutoSave: true,
  noteSurfaceAutoSave: true,
  tileColor: "#f6f3ec",
  theme: "light",
  fontSize: 14,
  surfaceFontSize: 14,
  tabIndentSize: 2,
  externalFileAutoSave: true,
  rememberSurfaceSize: true,
  tileCtrlClose: true,
  tileDoubleClickToEdit: false,
  tileSaveReturnsToPin: false,
  tileRenderMarkdown: true,
  renderHtmlMarkdown: false,
  splitScrollSync: true,
  toggleVisibilityShortcut: "",
  openAtCursor: false,
  tileStyle: "floral-purple",
  tileAppearance: "system",
  tileColorMode: "system",
  tileOpacityByNoteId: { A: 0.9, B: 0.6 },
};
const notes = ["A", "B"].map((id) => ({
  id,
  title: id,
  category: "tiles",
  fileName: `${id}.md`,
  createdAt: "2026-09-22",
  updatedAt: "2026-09-22",
  wordCount: 0,
  preview: "",
})) satisfies NoteMetadata[];
function Settings() {
  const [config, setConfig] = useState(initial);
  return <TileSettings config={config} notes={notes} onChange={setConfig} />;
}
it.each(["zh-CN", "zh-HK", "en-US"])(
  "provides five localized presets and per-note sliders in %s",
  async (locale) => {
    await syncLanguage(locale);
    await act(() => root.render(<Settings />));
    const selects = container.querySelectorAll("select");
    expect(selects[0].options).toHaveLength(5);
    expect(selects[1].options).toHaveLength(3);
    expect(container.textContent).not.toContain("settings.tiles.");
    const sliders = container.querySelectorAll<HTMLInputElement>('input[type="range"]');
    expect([...sliders].map((el) => el.value)).toEqual(["0.9", "0.6"]);
    await act(() => {
      selects[0].value = "floral-green";
      selects[0].dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect([...sliders].map((el) => el.value)).toEqual(["0.9", "0.6"]);
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(() => {
      setValue.call(sliders[0], "0.7");
      sliders[0].dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(saveOpacity).toHaveBeenLastCalledWith("A", 0.7);
    expect(sliders[1].value).toBe("0.6");
  },
);

it("reacts to OS appearance events, honors overrides and removes the listener", async () => {
  const handlers = new Set<() => void>();
  const media = {
    matches: false,
    addEventListener: vi.fn((_name, callback) => handlers.add(callback)),
    removeEventListener: vi.fn((_name, callback) => handlers.delete(callback)),
  };
  vi.stubGlobal("matchMedia", () => media);
  await act(() => root.render(<Tile content="Readable" config={initial} />));
  const tile = () => container.querySelector<HTMLElement>(".glass-tile")!;
  expect(tile().style.getPropertyValue("--tile-tint")).toBe("#dcd4f1");
  await act(() => {
    media.matches = true;
    handlers.forEach((callback) => callback());
  });
  expect(tile().style.getPropertyValue("--tile-tint")).toBe("#302641");
  await act(() =>
    root.render(<Tile content="Readable" config={{ ...initial, tileAppearance: "light" }} />),
  );
  expect(tile().style.getPropertyValue("--tile-tint")).toBe("#dcd4f1");
  await act(() => root.render(null));
  expect(handlers.size).toBe(0);
});
