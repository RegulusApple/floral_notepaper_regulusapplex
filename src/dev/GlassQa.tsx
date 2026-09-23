// Development-only background. It exercises real native windows over a stock
// Windows image; the image is never placed inside a production glass surface.
import { useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { getConfig, saveConfig, saveTileOpacity } from "../features/settings/api";
import { createNote, listNotes } from "../features/notes/api";
import type { TileStyle, TileAppearance } from "../features/settings/types";
import type { TodoState } from "../features/todos/store";

export function GlassQa() {
  const [label, setLabel] = useState("紫白 45%");
  const [palette, setPalette] = useState<[TileStyle, TileAppearance]>(["floral-purple", "light"]);
  const [opacity, setOpacity] = useState(0.45);
  const [error, setError] = useState("");
  const openPair = async () => {
    const notes = await listNotes();
    const qa = getCurrentWindow();
    const [position, scale] = await Promise.all([qa.outerPosition(), qa.scaleFactor()]);
    for (const [index, title] of ["玻璃验收 A", "玻璃验收 B"].entries()) {
      let noteId = notes.find((item) => item.title === title)?.id;
      if (!noteId) {
        const note = await createNote({
          title,
          category: "tiles",
          content: "同一玻璃外壳，独立保存不透明度。\n拖动窗口时，实时模糊后面的画面。",
        });
        noteId = note.id;
        await saveTileOpacity(noteId, index === 0 ? 0.25 : 0.65);
      }
      await invoke("open_tile_window", {
        noteId,
        bounds: {
          x: Math.round(position.x + (60 + index * 510) * scale),
          y: Math.round(position.y + 200 * scale),
          width: Math.round(400 * scale),
          height: Math.round(360 * scale),
        },
      });
    }
  };
  const apply = async (style: TileStyle, appearance: TileAppearance, value: number) => {
    const config = await getConfig();
    await saveConfig({
      ...config,
      tileStyle: style,
      tileAppearance: appearance,
      tileColorMode: "system",
    });
    await invoke("todos_mutate", { action: { type: "opacity", value } });
    setPalette([style, appearance]);
    setOpacity(value);
    setLabel(
      `${style === "floral-purple" ? "紫" : "绿"}${appearance === "light" ? "白" : "暗"} ${Math.round(value * 100)}%`,
    );
  };
  useEffect(() => {
    void (async () => {
      const [config, state] = await Promise.all([getConfig(), invoke<TodoState>("todos_get")]);
      const style = config.tileStyle === "floral-green" ? "floral-green" : "floral-purple";
      const appearance = config.tileAppearance === "dark" ? "dark" : "light";
      setPalette([style, appearance]);
      setOpacity(state.opacity);
      setLabel(
        `${style === "floral-purple" ? "紫" : "绿"}${appearance === "light" ? "白" : "暗"} ${Math.round(state.opacity * 100)}%`,
      );
      const windowLabel = await invoke<string>("open_todo_window");
      const target = await Window.getByLabel(windowLabel);
      const qa = getCurrentWindow();
      const [position, size, scale] = await Promise.all([
        qa.outerPosition(),
        qa.innerSize(),
        qa.scaleFactor(),
      ]);
      await target?.setPosition(
        new PhysicalPosition(
          Math.round(position.x + size.width / 2 - 200 * scale),
          Math.round(position.y + 140 * scale),
        ),
      );
    })().catch((cause) => setError(String(cause)));
  }, []);
  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
        position: "relative",
        color: "white",
        background: "#096dda",
      }}
    >
      <img
        src={convertFileSrc("C:\\Windows\\Web\\Wallpaper\\Windows\\img0.jpg")}
        alt="Windows stock wallpaper"
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <aside
        style={{
          position: "absolute",
          bottom: 16,
          left: 20,
          right: 20,
          display: "flex",
          gap: 10,
          alignItems: "center",
          padding: 12,
          background: "#111c",
          borderRadius: 10,
          fontSize: 12,
        }}
      >
        <strong>{label}</strong>
        {(
          [
            ["floral-purple", "light", "紫白"],
            ["floral-green", "light", "绿白"],
            ["floral-purple", "dark", "紫暗"],
            ["floral-green", "dark", "绿暗"],
          ] as const
        ).map(([style, appearance, name]) => (
          <button
            style={{
              cursor: "pointer",
              padding: "6px 10px",
              border: "1px solid #999",
              borderRadius: 6,
            }}
            key={name}
            onClick={() =>
              void apply(style, appearance, opacity).catch((cause) => setError(String(cause)))
            }
          >
            {name}
          </button>
        ))}
        {[0.05, 0.45, 0.95].map((value) => (
          <button
            key={value}
            style={{
              cursor: "pointer",
              padding: "6px 10px",
              border: "1px solid #999",
              borderRadius: 6,
            }}
            onClick={() => void apply(...palette, value).catch((cause) => setError(String(cause)))}
          >
            {Math.round(value * 100)}%
          </button>
        ))}
        <button onClick={() => void invoke("open_todo_window")}>聚焦待办</button>
        <button onClick={() => void openPair().catch((cause) => setError(String(cause)))}>
          两张磁贴
        </button>
        {error && <span>{error}</span>}
      </aside>
    </main>
  );
}
