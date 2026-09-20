import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "../notes/api";
import {
  canonicalFolder,
  defaultPeriod,
  isSystemFolder,
  RECORD_KINDS,
  type RecordKind,
} from "./model";

function Dialog({
  title,
  children,
  onClose,
  busy,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog
      .querySelector<HTMLElement>(
        "input:not(:disabled),select:not(:disabled),button:not(:disabled)",
      )
      ?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="fixed inset-0 z-[10000] bg-ink/20 flex items-center justify-center p-4"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="w-full max-w-md rounded-xl border border-paper-deep/50 bg-cloud p-5 shadow-xl text-ink-soft font-body"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" && !busy) onClose();
          if (e.key === "Tab") {
            const items = Array.from(
              ref.current!.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input:not(:disabled),select:not(:disabled)",
              ),
            );
            if (!items.length) return;
            const first = items[0],
              last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            }
            if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <h2 id={id} className="font-display text-base mb-4">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
const inputClass =
  "w-full mt-1 mb-3 px-2 py-1.5 rounded-lg border border-paper-deep/40 bg-paper-warm text-ink text-sm";
const buttonClass =
  "px-3 py-1.5 rounded-lg text-sm hover:bg-bamboo-mist/60 disabled:opacity-50 cursor-pointer";

export function PeriodDialog({
  kind: initialKind,
  period: initialPeriod,
  editing,
  onSubmit,
  onClose,
}: {
  kind: RecordKind;
  period?: string;
  editing: boolean;
  onSubmit: (kind: RecordKind, period: string, move: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState(initialKind);
  const [period, setPeriod] = useState(initialPeriod ?? defaultPeriod(initialKind));
  const [move, setMove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  const folder = canonicalFolder(kind, period);
  return (
    <Dialog
      title={t(editing ? "library.manageRecord" : "library.createRecord")}
      onClose={onClose}
      busy={busy}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!folder || running.current) return;
          running.current = true;
          setBusy(true);
          setError("");
          try {
            await onSubmit(kind, period, move);
            onClose();
          } catch (err) {
            setError(getErrorMessage(err, t));
          } finally {
            running.current = false;
            setBusy(false);
          }
        }}
      >
        <label className="text-xs">
          {t("library.recordType")}
          <select
            className={inputClass}
            value={kind}
            disabled={busy || !editing}
            onChange={(e) => {
              const next = e.target.value as RecordKind;
              setKind(next);
              setPeriod(defaultPeriod(next));
            }}
          >
            {RECORD_KINDS.map((type) => (
              <option key={type} value={type}>
                {t(`noteTemplates.${type}.name`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          {t("library.recordPeriod")}
          <input
            className={inputClass}
            type={kind === "diary" ? "date" : kind === "weekly" ? "week" : "month"}
            required
            value={period}
            disabled={busy}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </label>
        <p className="text-xs text-ink-faint mb-3">{t("library.periodHelp")}</p>
        {editing && (
          <label className="text-xs flex gap-2 items-center mb-3">
            <input
              type="checkbox"
              checked={move}
              disabled={busy}
              onChange={(e) => setMove(e.target.checked)}
            />
            {t("library.moveToStandard")}
          </label>
        )}
        <p className="text-xs text-ink-ghost mb-3 break-all">
          {folder
            ? t("library.standardLocation", { path: folder })
            : t("errors.recordPeriodInvalid")}
        </p>
        {error && (
          <p role="alert" className="text-red-500 text-xs mb-3">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass} onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className={buttonClass + " text-bamboo bg-bamboo-mist/60"}
            disabled={busy || !folder}
          >
            {t(editing ? "common.save" : "library.createOrOpen")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function FolderDialog({
  path,
  folders,
  onSubmit,
  onClose,
}: {
  path: string;
  folders: string[];
  onSubmit: (newPath: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const parts = path.split("/");
  const [name, setName] = useState(parts.pop()!);
  const [parent, setParent] = useState(parts.join("/"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  return (
    <Dialog title={t("library.renameMoveFolder")} onClose={onClose} busy={busy}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (running.current) return;
          if (name.includes("/") || name.includes("\\")) {
            setError(t("errors.categoryNameInvalidChars"));
            return;
          }
          running.current = true;
          setBusy(true);
          setError("");
          try {
            await onSubmit(parent ? `${parent}/${name.trim()}` : name.trim());
            onClose();
          } catch (err) {
            setError(getErrorMessage(err, t));
          } finally {
            running.current = false;
            setBusy(false);
          }
        }}
      >
        <label className="text-xs">
          {t("library.folderName")}
          <input
            className={inputClass}
            value={name}
            required
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="text-xs">
          {t("library.parentFolder")}
          <select
            className={inputClass}
            value={parent}
            disabled={busy}
            onChange={(e) => setParent(e.target.value)}
          >
            <option value="">{t("library.title")}</option>
            {folders
              .filter(
                (folder) =>
                  !isSystemFolder(folder) && folder !== path && !folder.startsWith(path + "/"),
              )
              .map((folder) => (
                <option key={folder} value={folder}>
                  {folder}
                </option>
              ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="text-red-500 text-xs mb-3">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass} disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className={buttonClass + " text-bamboo bg-bamboo-mist/60"}
            disabled={busy || !name.trim()}
          >
            {t("common.save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
