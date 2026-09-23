// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GlassSurface, type WorkspaceMode } from "./GlassSurface";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../features/settings/useSystemDark", () => ({ useSystemDark: () => false }));
vi.mock("../features/windows/controls", () => ({ startCurrentWindowDrag: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
const close = vi.fn();
function Surface({ material = "gaussian-blur" }: { material?: string }) {
  const [opacity, setOpacity] = useState(0.45);
  const [mode, setMode] = useState<WorkspaceMode>("todo");
  return (
    <GlassSurface
      config={{ tileStyle: "floral-purple", tileAppearance: "light" }}
      opacity={opacity}
      changeOpacity={setOpacity}
      mode={mode}
      changeMode={setMode}
      onClose={close}
      material={material}
    >
      <main>Content stays here</main>
    </GlassSurface>
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  close.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});

it("keeps the footer space without a visible opacity label, percentage or entry", async () => {
  await act(() => root.render(<Surface />));
  const footer = container.querySelector(".surface-footer");
  expect(footer).not.toBeNull();
  expect(footer!.textContent).toBe("");
  expect(footer!.querySelector("details,summary,output,input,button")).toBeNull();
  expect(container.querySelector("main")!.textContent).toBe("Content stays here");
});

it("preserves Ctrl+wheel in 5% steps, limits and ordinary scrolling", async () => {
  await act(() => root.render(<Surface />));
  const surface = container.querySelector<HTMLElement>(".glass-surface")!;
  const opacity = () => Number(surface.style.getPropertyValue("--tile-opacity"));
  async function wheel(deltaY: number, ctrlKey = true) {
    const event = new WheelEvent("wheel", { deltaY, ctrlKey, bubbles: true, cancelable: true });
    await act(() => surface.dispatchEvent(event));
    return event;
  }
  expect((await wheel(-100)).defaultPrevented).toBe(true);
  expect(opacity()).toBe(0.5);
  await wheel(100);
  expect(opacity()).toBe(0.45);
  expect((await wheel(100, false)).defaultPrevented).toBe(false);
  expect(opacity()).toBe(0.45);
  for (let i = 0; i < 20; i++) await wheel(-100);
  expect(opacity()).toBe(0.95);
  for (let i = 0; i < 20; i++) await wheel(100);
  expect(opacity()).toBe(0.05);
});

it("leaves the mode switch, close control and material fallback unchanged", async () => {
  await act(() => root.render(<Surface material="transparent" />));
  const modes = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  await act(() => modes[0].click());
  expect(container.querySelector(".glass-surface")!.getAttribute("data-workspace-mode")).toBe(
    "note",
  );
  expect(modes[0].getAttribute("aria-selected")).toBe("true");
  await act(() => modes[1].click());
  expect(container.querySelector(".glass-surface")!.getAttribute("data-workspace-mode")).toBe(
    "todo",
  );
  await act(() => container.querySelector<HTMLButtonElement>(".surface-close")!.click());
  expect(close).toHaveBeenCalledOnce();
  expect(container.querySelector(".surface-footer span")!.textContent).toBe(
    "desktopTasks.fallback",
  );
});
