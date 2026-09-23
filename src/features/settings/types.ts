export type ViewMode = "edit" | "split" | "preview";

export type ThemeOption = "light" | "dark" | "system";

export type TileColorMode = "system" | "custom";
export type TileStyle = "paper" | "minimal" | "glass-blue" | "floral-purple" | "floral-green";
export type TileAppearance = "system" | "light" | "dark";
export type BackgroundFit = "cover" | "contain" | "repeat";

export interface AppConfig {
  locale: string;
  dataDir: string;
  globalShortcut: string;
  closeToTray: boolean;
  autostart: boolean;
  defaultViewMode: string;
  noteAutoSave: boolean;
  noteSurfaceAutoSave: boolean;
  tileColor: string;
  tileColorMode: TileColorMode;
  tileStyle?: TileStyle;
  tileAppearance?: TileAppearance;
  tileOpacityByNoteId?: Record<string, number>;
  theme: ThemeOption;
  fontSize: number;
  surfaceFontSize: number;
  tabIndentSize: number;
  externalFileAutoSave: boolean;
  rememberSurfaceSize: boolean;
  tileCtrlClose: boolean;
  tileDoubleClickToEdit: boolean;
  tileSaveReturnsToPin: boolean;
  tileRenderMarkdown: boolean;
  renderHtmlMarkdown: boolean;
  splitScrollSync: boolean;
  surfaceWidth?: number;
  surfaceHeight?: number;
  toggleVisibilityShortcut: string;
  todoShortcut?: string;
  openAtCursor: boolean;
  backgroundImagePath?: string;
  backgroundFit?: BackgroundFit;
  backgroundDim?: number;
  backgroundBlur?: number;
  backgroundScale?: number;
  backgroundPositionX?: number;
  backgroundPositionY?: number;
}
