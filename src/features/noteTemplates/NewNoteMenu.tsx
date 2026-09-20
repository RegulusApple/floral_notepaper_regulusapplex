import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  POPUP_VIEWPORT_MARGIN,
  useViewportPopupPosition,
  type PopupPosition,
} from "../../components/popupPosition";
import { NOTE_TEMPLATE_TYPES, getNoteTemplateLabel, type NoteTemplateType } from "./templates";

interface NewNoteMenuProps {
  onCreate: (type: NoteTemplateType) => Promise<void>;
}

export function NewNoteMenu({ onCreate }: NewNoteMenuProps) {
  const { t, i18n } = useTranslation();
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const [anchor, setAnchor] = useState<PopupPosition | null>(null);
  const { popupRef, popupPosition } = useViewportPopupPosition(anchor, i18n.resolvedLanguage);

  useLayoutEffect(() => {
    if (anchor) itemRefs.current[0]?.focus();
  }, [anchor]);

  useEffect(() => {
    if (!anchor) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popupRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setAnchor(null);
      }
    };
    const close = () => setAnchor(null);
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [anchor, popupRef]);

  const choose = async (type: NoteTemplateType) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setAnchor(null);
    try {
      await onCreate(type);
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        aria-controls={anchor ? menuId : undefined}
        disabled={creating}
        onClick={() => {
          if (anchor) {
            setAnchor(null);
          } else {
            const rect = buttonRef.current!.getBoundingClientRect();
            setAnchor({ x: rect.left, y: rect.bottom + 4 });
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            setAnchor({ x: rect.left, y: rect.bottom + 4 });
          }
        }}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-body text-bamboo hover:bg-bamboo-mist/60 transition-all cursor-pointer group disabled:opacity-50 disabled:cursor-wait"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="group-hover:rotate-90 transition-transform duration-200"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span>{t("main.sidebar.newNote")}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          className="ml-auto"
          aria-hidden="true"
        >
          <path d="m2 4 3 3 3-3" />
        </svg>
      </button>
      {anchor &&
        createPortal(
          <div
            ref={popupRef}
            id={menuId}
            role="menu"
            aria-label={t("main.sidebar.newNote")}
            className="fixed z-[9999] min-w-[152px] py-1.5 bg-cloud/95 backdrop-blur-sm border border-paper-deep/50 rounded-lg overflow-x-hidden overflow-y-auto select-none animate-menu-enter"
            style={{
              left: popupPosition?.x ?? anchor.x,
              top: popupPosition?.y ?? anchor.y,
              maxWidth: `calc(100vw - ${POPUP_VIEWPORT_MARGIN * 2}px)`,
              maxHeight: `calc(100vh - ${POPUP_VIEWPORT_MARGIN * 2}px)`,
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" || event.key === "Tab") {
                if (event.key === "Escape") event.preventDefault();
                setAnchor(null);
                buttonRef.current?.focus();
                return;
              }
              const current = itemRefs.current.findIndex((item) => item === document.activeElement);
              const count = NOTE_TEMPLATE_TYPES.length;
              const next =
                event.key === "ArrowDown"
                  ? (current + 1) % count
                  : event.key === "ArrowUp"
                    ? (current - 1 + count) % count
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? count - 1
                        : null;
              if (next !== null) {
                event.preventDefault();
                itemRefs.current[next]?.focus();
              }
            }}
          >
            {NOTE_TEMPLATE_TYPES.map((type, index) => (
              <button
                key={type}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => void choose(type)}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo focus:bg-bamboo-mist/60 focus:text-bamboo transition-colors cursor-pointer outline-none"
              >
                {getNoteTemplateLabel(type, t)}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
