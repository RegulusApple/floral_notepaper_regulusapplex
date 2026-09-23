import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AppConfig } from "../features/settings/types";
import { stepTileOpacity, tileCssVariables } from "../features/settings/tileAppearance";
import { useSystemDark } from "../features/settings/useSystemDark";
import { startCurrentWindowDrag } from "../features/windows/controls";

export type WorkspaceMode = "note" | "todo";
export function GlassSurface({
  config,
  opacity,
  changeOpacity,
  mode,
  changeMode,
  onClose,
  children,
  material,
  className = "",
}: {
  config: Partial<AppConfig>;
  opacity: number;
  changeOpacity: (value: number | ((old: number) => number)) => void;
  mode: WorkspaceMode;
  changeMode: (mode: WorkspaceMode) => void;
  onClose: () => void;
  children: ReactNode;
  material: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const dark = useSystemDark();
  const ref = useRef<HTMLDivElement>(null);
  const changeRef = useRef(changeOpacity);
  changeRef.current = changeOpacity;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      event.stopPropagation();
      changeRef.current((value) => stepTileOpacity(value, event.deltaY));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  return (
    <div
      ref={ref}
      className={`glass-surface glass-tile app-surface-frame ${className}`}
      data-workspace-mode={mode}
      data-native-material={material}
      style={{ ...tileCssVariables(config, dark), "--tile-opacity": opacity } as CSSProperties}
    >
      <header
        className="surface-header"
        onMouseDown={(event) => {
          if (
            event.button === 0 &&
            !(event.target as HTMLElement).closest("button,input,select,summary")
          )
            void startCurrentWindowDrag();
        }}
      >
        <span className="surface-brand">{t("about.productName")}</span>
        <div className="surface-modes" role="tablist" aria-label={t("desktopTasks.mode")}>
          {(["note", "todo"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => changeMode(value)}
            >
              {t(value === "note" ? "desktopTasks.note" : "desktopTasks.tasks")}
            </button>
          ))}
        </div>
        <button
          className="surface-close"
          type="button"
          aria-label={t("notepad.tooltip.close")}
          onClick={onClose}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      {children}
      <footer className="surface-footer">
        {material === "transparent" && (
          <span title={t("desktopTasks.glassFallback")}>{t("desktopTasks.fallback")}</span>
        )}
      </footer>
    </div>
  );
}
