import chroma from "chroma-js";
import type { CSSProperties } from "react";
import { normalizeTileColor } from "./tileColor";
import type { AppConfig, TileStyle } from "./types";

export const TILE_STYLES: TileStyle[] = [
  "paper",
  "minimal",
  "glass-blue",
  "floral-purple",
  "floral-green",
];
export const DEFAULT_TILE_OPACITY = 0.45;

export function normalizeTileOpacity(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.max(0.05, Math.min(0.95, value)) * 20) / 20
    : DEFAULT_TILE_OPACITY;
}

export function stepTileOpacity(value: number, deltaY: number): number {
  return normalizeTileOpacity(value + (deltaY === 0 ? 0 : deltaY < 0 ? 0.05 : -0.05));
}

export function resolveTileAppearance(config: Partial<AppConfig>, systemDark: boolean) {
  const style = TILE_STYLES.includes(config.tileStyle as TileStyle)
    ? config.tileStyle!
    : "floral-purple";
  const floral = style.startsWith("floral-");
  const dark =
    floral &&
    (config.tileAppearance === "dark" || (config.tileAppearance !== "light" && systemDark));
  const palette = {
    paper: ["#f5e6a7", "#735400"],
    minimal: ["#f1f4f8", "#475569"],
    "glass-blue": ["#89b5e9", "#144780"],
    "floral-purple": dark ? ["#302641", "#c4b5fd"] : ["#dcd4f1", "#68499a"],
    "floral-green": dark ? ["#183d32", "#9cddbd"] : ["#cfe9de", "#27634c"],
  }[style];
  const background =
    config.tileColorMode === "custom" ? normalizeTileColor(config.tileColor) : palette[0];
  const lightSurface = chroma(background).luminance() > 0.22;
  const foreground = lightSurface ? "#202938" : "#f7fafc";
  const accent =
    config.tileColorMode === "custom"
      ? chroma.mix(background, lightSurface ? "#101820" : "#ffffff", 0.65).hex()
      : palette[1];
  const mark = chroma.contrast(accent, "#fff") >= 4.5 ? "#fff" : "#000";
  return { style, dark, background, foreground, accent, mark };
}

export function tileCssVariables(config: Partial<AppConfig>, systemDark: boolean): CSSProperties {
  const palette = resolveTileAppearance(config, systemDark);
  return {
    "--tile-tint": palette.background,
    "--tile-text": palette.foreground,
    "--task-accent": palette.accent,
    "--task-check": palette.mark,
  } as CSSProperties;
}

/** Main preview keeps the same color family, with contrast for its own surface. */
export function previewTaskCssVariables(
  config: Partial<AppConfig>,
  systemDark: boolean,
): CSSProperties {
  const dark = config.theme === "dark" || (config.theme !== "light" && systemDark);
  const palette = resolveTileAppearance(config, systemDark);
  let accent = chroma(palette.accent);
  const surface = dark ? "#211b35" : "#ffffff";
  for (let step = 0; step < 20 && chroma.contrast(accent, surface) < 4.5; step++) {
    accent = dark ? accent.brighten(0.25) : accent.darken(0.25);
  }
  return {
    "--task-accent": accent.hex(),
    "--task-check": chroma.contrast(accent, "#fff") >= 4.5 ? "#fff" : "#000",
  } as CSSProperties;
}
