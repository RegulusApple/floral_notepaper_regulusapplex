import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { NoteMetadata } from "../notes/types";
import { formatTime, getDisplayTitle } from "../notes/noteUtils";
import {
  buildLibraryTree,
  countLibraryNotes,
  isSystemFolder,
  isWritableFolder,
  type LibraryNode,
} from "./model";
import {
  libraryFolderLabel,
  noteDateLabel,
  periodGroupLabel,
  recordedPeriod,
  visibleLibraryChildren,
} from "./presentation";

interface Props {
  notes: NoteMetadata[];
  folders: string[];
  selectedId: string | null;
  activeFolder: string;
  onSelectFolder: (path: string) => void;
  onSelectNote: (id: string) => void;
  onNoteMenu: (event: MouseEvent<HTMLElement>, id: string) => void;
  onFolderMenu: (event: MouseEvent, path: string) => void;
  onMoveNote: (id: string, path: string) => void;
  onRefresh: () => void;
}

function DocumentIcon() {
  return (
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
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}

export function NoteLibraryTree(props: Props) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dropPath, setDropPath] = useState<string | null>(null);
  const root = useMemo(
    () => buildLibraryTree(props.notes, props.folders),
    [props.notes, props.folders],
  );

  const label = (node: LibraryNode) => libraryFolderLabel(node, t);

  const toggle = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    props.onRefresh();
  };

  const renderNotes = (node: LibraryNode, depth: number) =>
    node.notes.map((note) => (
      <button
        type="button"
        key={note.id}
        data-note-id={note.id}
        aria-pressed={props.selectedId === note.id}
        title={
          getDisplayTitle(note, t) +
          " · " +
          t("library.location", { path: note.category || t("library.title") })
        }
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData("application/x-floral-note", note.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => props.onSelectNote(note.id)}
        onContextMenu={(event) => props.onNoteMenu(event, note.id)}
        className={`library-note-row group relative w-full py-2 text-left transition-colors cursor-pointer ${
          props.selectedId === note.id
            ? "bg-bamboo-mist/45 text-bamboo"
            : "text-ink-soft hover:bg-paper-warm/65"
        }`}
        style={{ paddingLeft: `${24 + depth * 12}px`, paddingRight: "8px" }}
      >
        <span
          className={`absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-r-full bg-bamboo transition-all ${
            props.selectedId === note.id ? "h-7 opacity-90" : "h-0 opacity-0"
          }`}
          aria-hidden="true"
        />
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="shrink-0 opacity-75" aria-hidden="true">
            <DocumentIcon />
          </span>
          <span
            className={`min-w-0 flex-1 truncate text-[12px] font-display font-medium ${
              props.selectedId === note.id ? "text-bamboo" : "text-ink-soft"
            }`}
          >
            {getDisplayTitle(note, t)}
          </span>
          <span
            className="library-date shrink-0 text-[10px] font-mono"
            title={recordedPeriod(note) ?? note.createdAt}
          >
            {noteDateLabel(note)}
          </span>
        </div>
        <div className="pl-5 text-[10px] text-ink-ghost font-mono leading-relaxed">
          {!recordedPeriod(note) && <>{formatTime(note.createdAt)} · </>}
          {t("common.wordCount", { count: note.wordCount })}
        </div>
        {note.preview && (
          <p className="pl-5 mt-0.5 text-[10px] text-ink-ghost truncate">{note.preview}</p>
        )}
      </button>
    ));

  const renderNode = (node: LibraryNode, depth: number): ReactNode => {
    const open = !collapsed.has(node.path);
    const writable = isWritableFolder(node.path);
    const hasContent = node.children.length > 0 || node.notes.length > 0;
    const active = props.activeFolder === node.path;
    const periodGroup = periodGroupLabel(node.path, t) !== null;

    return (
      <div key={node.path} className="relative" data-folder-path={node.path}>
        <div
          style={{ paddingLeft: `${depth * 12}px` }}
          className={`library-folder-row group flex min-h-8 items-center gap-0 transition-colors ${
            dropPath === node.path
              ? "bg-green-soft/55"
              : active
                ? "bg-bamboo-mist/35"
                : "hover:bg-paper-warm/55"
          }`}
          onContextMenu={(event) => {
            if (node.path && !isSystemFolder(node.path)) props.onFolderMenu(event, node.path);
          }}
          onDragOver={(event) => {
            if (writable) {
              event.preventDefault();
              event.stopPropagation();
              setDropPath(node.path);
            }
          }}
          onDragLeave={() => setDropPath(null)}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDropPath(null);
            const id = event.dataTransfer.getData("application/x-floral-note");
            if (id && writable) props.onMoveNote(id, node.path);
          }}
        >
          {hasContent ? (
            <button
              type="button"
              aria-label={t(open ? "library.collapse" : "library.expand", { name: label(node) })}
              aria-expanded={open}
              onClick={() => toggle(node.path)}
              className="flex h-8 w-6 shrink-0 items-center justify-center text-ink-ghost transition-colors cursor-pointer hover:text-ink-soft"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                className={`library-folder-chevron ${open ? "is-open" : ""}`}
                aria-hidden="true"
              >
                <path d="m9 5 7 7-7 7" />
              </svg>
            </button>
          ) : (
            <span className="w-6 shrink-0" aria-hidden="true" />
          )}
          <button
            type="button"
            aria-pressed={active}
            onClick={() => {
              props.onSelectFolder(node.path);
              props.onRefresh();
            }}
            title={node.path || t("library.title")}
            className={`min-w-0 flex-1 flex items-center gap-1.5 py-1 text-left cursor-pointer ${
              periodGroup ? "text-[11px] text-ink-faint" : "text-[12px] text-ink-soft"
            }`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 opacity-75"
              aria-hidden="true"
            >
              <path d="M3 7V5h6l2 3h10v12H3z" />
            </svg>
            <span className="truncate">{label(node)}</span>
          </button>
          <span className="pr-3 text-[9px] font-mono text-ink-ghost/70">
            {countLibraryNotes(node) || ""}
          </span>
        </div>
        {(hasContent || active) && (
          <div
            className={`library-folder-children ${open || !hasContent ? "is-expanded" : ""}`}
            data-expanded={open || !hasContent}
            aria-hidden={!open && hasContent}
            inert={!open && hasContent ? true : undefined}
          >
            <div className="library-folder-children-inner relative">
              <span
                aria-hidden="true"
                className="library-branch-line absolute top-0 bottom-0 pointer-events-none"
                style={{ left: `${12 + depth * 12}px` }}
              />
              {visibleLibraryChildren(node).map((child) => renderNode(child, depth + 1))}
              {renderNotes(node, depth + 1)}
              {!hasContent && (
                <p
                  className="py-2 text-[10px] text-ink-ghost"
                  style={{ paddingLeft: `${24 + depth * 12}px` }}
                >
                  {t("main.category.emptyFolder")}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <nav aria-label={t("library.title")} className="note-library">
      {root.children.map((child) => renderNode(child, 0))}
      {renderNotes(root, 0)}
    </nav>
  );
}
