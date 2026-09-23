import chroma from "chroma-js";
import { describe, expect, it, vi } from "vitest";
import {
  normalizeTileOpacity,
  previewTaskCssVariables,
  resolveTileAppearance,
  stepTileOpacity,
  TILE_STYLES,
} from "./tileAppearance";
import { createLatestWriter } from "./useTileOpacity";

describe("tile appearance", () => {
  it.each(["light", "dark"] as const)(
    "keeps main-preview checkboxes readable on a %s app surface",
    (theme) => {
      for (const tileStyle of TILE_STYLES) {
        for (const tileAppearance of ["light", "dark"] as const) {
          const vars = previewTaskCssVariables(
            { theme, tileStyle, tileAppearance },
            false,
          ) as Record<string, string>;
          expect(
            chroma.contrast(vars["--task-accent"], theme === "dark" ? "#211b35" : "#ffffff"),
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            chroma.contrast(vars["--task-accent"], vars["--task-check"]),
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );
  it("defaults legacy configs to purple glass and follows OS, not app theme", () => {
    expect(resolveTileAppearance({}, false).style).toBe("floral-purple");
    expect(resolveTileAppearance({ theme: "light" }, true).dark).toBe(true);
    expect(resolveTileAppearance({ theme: "dark" }, false).dark).toBe(false);
  });
  it.each(["floral-purple", "floral-green"] as const)(
    "supports %s system and explicit modes",
    (tileStyle) => {
      expect(resolveTileAppearance({ tileStyle, tileAppearance: "system" }, true).dark).toBe(true);
      expect(resolveTileAppearance({ tileStyle, tileAppearance: "light" }, true).dark).toBe(false);
      expect(resolveTileAppearance({ tileStyle, tileAppearance: "dark" }, false).dark).toBe(true);
    },
  );
  it.each(TILE_STYLES)("keeps readable marks in %s", (tileStyle) => {
    for (const systemDark of [true, false]) {
      const result = resolveTileAppearance({ tileStyle }, systemDark);
      expect(chroma.contrast(result.mark, result.accent)).toBeGreaterThanOrEqual(4.5);
      expect(chroma.contrast(result.foreground, result.background)).toBeGreaterThanOrEqual(4.5);
      if (!tileStyle.startsWith("floral-")) expect(result.dark).toBe(false);
    }
  });
  it.each(["#ffffff", "#000000", "#ff00ff", "#00ff00"])("adapts custom color %s", (tileColor) => {
    const result = resolveTileAppearance({ tileColor, tileColorMode: "custom" }, false);
    expect(result.background).toBe(tileColor);
    expect(chroma.contrast(result.mark, result.accent)).toBeGreaterThanOrEqual(4.5);
  });
  it("clamps opacity and steps by five percent", () => {
    expect(normalizeTileOpacity(undefined)).toBe(0.45);
    expect(normalizeTileOpacity(NaN)).toBe(0.45);
    expect(normalizeTileOpacity(Infinity)).toBe(0.45);
    expect(normalizeTileOpacity("0.6")).toBe(0.45);
    expect(normalizeTileOpacity(-10)).toBe(0.05);
    expect(normalizeTileOpacity(10)).toBe(0.95);
    expect(normalizeTileOpacity(0.123)).toBe(0.1);
    expect(stepTileOpacity(0.9, 120)).toBe(0.85);
    expect(stepTileOpacity(0.9, -1)).toBe(0.95);
    expect(stepTileOpacity(0.05, 100)).toBe(0.05);
    expect(stepTileOpacity(0.95, -100)).toBe(0.95);
  });
});

describe("opacity persistence", () => {
  it("never replays an older failed value over a newer in-flight save on close", async () => {
    let release!: () => void;
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const writer = createLatestWriter(save, vi.fn());
    writer.push(0.2);
    await vi.waitFor(() => expect(writer.busy()).toBe(false));
    writer.push(0.7);
    const flush = writer.flush();
    release();
    await flush;
    expect(save.mock.calls).toEqual([[0.2], [0.7]]);
  });
  it("retries the latest failed value on close and reports a persistent failure", async () => {
    const save = vi.fn().mockRejectedValue(new Error("disk full"));
    const writer = createLatestWriter(save, vi.fn());
    writer.push(0.6);
    await vi.waitFor(() => expect(writer.busy()).toBe(false));
    await expect(writer.flush()).rejects.toThrow("disk full");
    expect(save.mock.calls).toEqual([[0.6], [0.6]]);
  });
  it("retains pending values for different note IDs when the window changes notes", async () => {
    let release!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const writer = createLatestWriter<{ id: string; opacity: number }>(
      save,
      vi.fn(),
      (value) => value.id,
    );
    writer.push({ id: "A", opacity: 0.85 });
    writer.push({ id: "A", opacity: 0.8 });
    writer.push({ id: "B", opacity: 0.6 });
    release();
    await vi.waitFor(() => expect(writer.busy()).toBe(false));
    expect(save.mock.calls).toEqual([
      [{ id: "A", opacity: 0.85 }],
      [{ id: "A", opacity: 0.8 }],
      [{ id: "B", opacity: 0.6 }],
    ]);
  });
  it("serializes fast changes and saves the latest pending value", async () => {
    let release!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const error = vi.fn();
    const writer = createLatestWriter(save, error);
    writer.push(0.85);
    writer.push(0.8);
    writer.push(0.75);
    expect(save.mock.calls).toEqual([[0.85]]);
    release();
    await vi.waitFor(() => expect(writer.busy()).toBe(false));
    expect(save.mock.calls).toEqual([[0.85], [0.75]]);
    expect(error).not.toHaveBeenCalled();
  });
  it("reports failures and allows the next value to be saved", async () => {
    const error = vi.fn();
    const save = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);
    const writer = createLatestWriter(save, error);
    writer.push(0.6);
    writer.push(0.7);
    await vi.waitFor(() => expect(writer.busy()).toBe(false));
    expect(error).toHaveBeenCalledTimes(1);
    expect(save.mock.calls).toEqual([[0.6], [0.7]]);
  });
});
