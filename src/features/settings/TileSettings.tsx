import { useTranslation } from "react-i18next";
import type { NoteMetadata } from "../notes/types";
import { getErrorMessage } from "../notes/api";
import { showToast } from "../../components/Toast";
import type { AppConfig, TileStyle, TileAppearance } from "./types";
import { TILE_STYLES } from "./tileAppearance";
import { useTileOpacity } from "./useTileOpacity";

function TileOpacityRow({ note, config }: { note: NoteMetadata; config: AppConfig }) {
  const { t } = useTranslation();
  const [value, change] = useTileOpacity(note.id, config.tileOpacityByNoteId?.[note.id], (error) =>
    showToast(getErrorMessage(error)),
  );
  return (
    <label className="block space-y-1.5">
      <span className="block truncate text-[12px]" title={note.title}>
        {note.title || t("tile.empty")}
      </span>
      <span className="flex items-center gap-2">
        <input
          type="range"
          min={0.05}
          max={0.95}
          step={0.05}
          value={value}
          aria-label={t("settings.tiles.opacityFor", { title: note.title })}
          onChange={(event) => change(Number(event.target.value))}
          className="min-w-0 flex-1 accent-bamboo"
        />
        <output className="text-[11px] font-mono w-9 text-right">{Math.round(value * 100)}%</output>
      </span>
    </label>
  );
}

export function TileSettings({
  config,
  notes,
  onChange,
}: {
  config: AppConfig;
  notes: NoteMetadata[];
  onChange: (config: AppConfig) => void;
}) {
  const { t } = useTranslation();
  const style = config.tileStyle ?? "floral-purple";
  return (
    <section className="space-y-3 text-ink-soft">
      <label className="block space-y-2 text-[11px]">
        <span>{t("settings.tiles.style")}</span>
        <select
          value={style}
          onChange={(event) => onChange({ ...config, tileStyle: event.target.value as TileStyle })}
          className="w-full rounded-lg p-2 bg-paper-warm border border-paper-deep/40"
        >
          {TILE_STYLES.map((value) => (
            <option key={value} value={value}>
              {t(`settings.tiles.styles.${value}`)}
            </option>
          ))}
        </select>
      </label>
      {style.startsWith("floral-") && (
        <label className="block space-y-2 text-[11px]">
          <span>{t("settings.tiles.appearance")}</span>
          <select
            value={config.tileAppearance ?? "system"}
            onChange={(event) =>
              onChange({ ...config, tileAppearance: event.target.value as TileAppearance })
            }
            className="w-full rounded-lg p-2 bg-paper-warm border border-paper-deep/40"
          >
            {(["system", "light", "dark"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`settings.theme.${value}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-[11px] text-ink-faint">{t("settings.tiles.opacityHint")}</p>
      <div className="space-y-3 max-h-52 overflow-y-auto">
        {notes.map((note) => (
          <TileOpacityRow key={note.id} note={note} config={config} />
        ))}
        {notes.length === 0 && (
          <p className="text-[11px] text-ink-faint">{t("settings.tiles.empty")}</p>
        )}
      </div>
    </section>
  );
}
