import type { CSSProperties, HTMLAttributes } from "react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownPreviewLazy as MarkdownPreview } from "../features/markdown/MarkdownPreviewLazy";
import type { AppConfig } from "../features/settings/types";
import {
  normalizeTileOpacity,
  stepTileOpacity,
  tileCssVariables,
} from "../features/settings/tileAppearance";
import { useSystemDark } from "../features/settings/useSystemDark";

export interface TileProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "color" | "content" | "title"
> {
  title?: string;
  content: string;
  color?: string;
  config?: Partial<AppConfig>;
  opacity?: number;
  onOpacityChange?: (next: (previous: number) => number) => void;
  onContentChange?: (content: string) => void;
  width?: number | string;
  rotation?: number;
  fontSize?: number;
  renderMarkdown?: boolean;
  imageBaseDir?: string;
  bare?: boolean;
}

export function Tile({
  title,
  content,
  color,
  config,
  opacity = 0.45,
  onOpacityChange,
  onContentChange,
  width = 260,
  rotation = 0,
  fontSize = 14,
  renderMarkdown = false,
  imageBaseDir,
  bare = false,
  className = "",
  style,
  children,
  ...divProps
}: TileProps) {
  const { t } = useTranslation();
  const systemDark = useSystemDark();
  const ref = useRef<HTMLDivElement>(null);
  const changeRef = useRef(onOpacityChange);
  changeRef.current = onOpacityChange;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !changeRef.current || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      changeRef.current((value) => stepTileOpacity(value, event.deltaY));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  const paletteConfig =
    config ?? (color ? { tileColor: color, tileColorMode: "custom" as const } : {});
  const mergedStyle = {
    ...tileCssVariables(paletteConfig, systemDark),
    "--tile-opacity": normalizeTileOpacity(opacity),
    width,
    ...(rotation ? { transform: `rotate(${rotation}deg)` } : {}),
    ...style,
  } as CSSProperties;
  return (
    <div
      {...divProps}
      ref={ref}
      className={`${bare ? "surface-note-content" : "app-surface-frame glass-tile"} relative overflow-hidden ${className}`}
      style={mergedStyle}
    >
      <div className="relative px-4 py-4 h-full overflow-y-auto scrollbar-hidden">
        {title && (
          <div
            className="font-display font-medium tracking-wide mb-3 pr-6 leading-snug"
            style={{ fontSize: fontSize + 1 }}
          >
            {title}
          </div>
        )}
        {content ? (
          renderMarkdown ? (
            <MarkdownPreview
              content={content}
              onContentChange={onContentChange}
              fontSize={fontSize}
              renderHtml={false}
              imageBaseDir={imageBaseDir}
            />
          ) : (
            <div className="leading-[1.8] whitespace-pre-wrap font-body" style={{ fontSize }}>
              {content}
            </div>
          )
        ) : (
          <div className="font-body text-center py-6" style={{ fontSize }}>
            {t("tile.empty")}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
