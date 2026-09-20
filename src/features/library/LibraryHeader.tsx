import { useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  count: number;
  externalCount: number;
  active: boolean;
  onSelectRoot: () => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  onMoveNote: (id: string, path: string) => void;
}

export function LibraryHeader(props: Props) {
  const { t } = useTranslation();
  const [dragOver, setDragOver] = useState(false);
  return (
    <div className="library-header group flex items-center gap-1 px-5 pb-1.5 shrink-0">
      <button
        type="button"
        aria-pressed={props.active}
        title={t("library.allNotes")}
        onClick={props.onSelectRoot}
        className={
          "library-root-button flex min-w-0 flex-1 items-center gap-2 text-left h-7 cursor-pointer " +
          (dragOver ? "bg-green-soft" : "")
        }
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          const id = event.dataTransfer.getData("application/x-floral-note");
          if (id) props.onMoveNote(id, "");
        }}
      >
        <span
          className={"text-[12px] font-medium " + (props.active ? "text-bamboo" : "text-ink-soft")}
        >
          {t("library.title")}
        </span>
        <span
          className="truncate text-[10px] font-mono text-ink-ghost"
          title={t("common.noteCount", { count: props.count })}
        >
          {props.count}
          {props.externalCount > 0
            ? " · " + t("common.externalFileCount", { count: props.externalCount })
            : ""}
        </span>
      </button>
      <button
        type="button"
        title={t("library.refresh")}
        aria-label={t("library.refresh")}
        onClick={props.onRefresh}
        className="library-header-action"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" />
        </svg>
      </button>
      <button
        type="button"
        title={t("library.newFolder")}
        aria-label={t("library.newFolder")}
        onMouseDown={(event) => event.preventDefault()}
        onClick={props.onNewFolder}
        className="library-header-action"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
