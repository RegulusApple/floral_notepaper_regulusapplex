import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { checkGlobalShortcut, getConfig, normalizeViewMode, saveConfig } from "./api";
import type { AppConfig } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("settings api", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  test("gets config through Rust", async () => {
    const config: AppConfig = {
      locale: "zh-CN",
      dataDir: "D:\\notes",
      globalShortcut: "Ctrl+Space",
      closeToTray: true,
      autostart: false,
      defaultViewMode: "split",
      noteAutoSave: true,
      noteSurfaceAutoSave: true,
      tileColor: "#f6f3ec",
      tileColorMode: "system",
      theme: "light",
      fontSize: 14,
      surfaceFontSize: 14,
      tabIndentSize: 2,
      externalFileAutoSave: true,
      rememberSurfaceSize: true,
      tileCtrlClose: true,
      tileDoubleClickToEdit: false,
      tileSaveReturnsToPin: false,
      toggleVisibilityShortcut: "",
      tileRenderMarkdown: false,
      renderHtmlMarkdown: false,
      splitScrollSync: true,
      openAtCursor: true,
    };
    mockedInvoke.mockResolvedValue(config);

    await expect(getConfig()).resolves.toBe(config);

    expect(invoke).toHaveBeenCalledWith("config_get");
  });

  test("saves config through Rust", async () => {
    const config: AppConfig = {
      locale: "zh-CN",
      dataDir: "D:\\notes",
      globalShortcut: "Alt+Space",
      closeToTray: false,
      autostart: true,
      defaultViewMode: "preview",
      noteAutoSave: false,
      noteSurfaceAutoSave: false,
      tileColor: "#efe8dc",
      tileColorMode: "custom",
      theme: "dark",
      fontSize: 16,
      surfaceFontSize: 16,
      tabIndentSize: 4,
      externalFileAutoSave: true,
      rememberSurfaceSize: true,
      tileCtrlClose: true,
      tileDoubleClickToEdit: true,
      tileSaveReturnsToPin: true,
      toggleVisibilityShortcut: "",
      tileRenderMarkdown: false,
      renderHtmlMarkdown: false,
      splitScrollSync: true,
      openAtCursor: true,
    };
    mockedInvoke.mockResolvedValue(config);

    await expect(saveConfig(config)).resolves.toBe(config);

    expect(invoke).toHaveBeenCalledWith("config_save", { config });
  });

  test("checks global shortcut availability through Rust", async () => {
    const result = {
      available: false,
      conflictType: "system",
      message: "与 macOS 系统快捷键冲突",
    };
    mockedInvoke.mockResolvedValue(result);

    await expect(checkGlobalShortcut("Command+Space")).resolves.toBe(result);

    expect(invoke).toHaveBeenCalledWith("global_shortcut_check", {
      shortcut: "Command+Space",
    });
  });

  test("normalizes supported view modes and falls back to split", () => {
    expect(normalizeViewMode("edit")).toBe("edit");
    expect(normalizeViewMode("split")).toBe("split");
    expect(normalizeViewMode("preview")).toBe("preview");
    expect(normalizeViewMode("unknown")).toBe("split");
  });
});
