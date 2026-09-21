import type { NoteMetadata } from "../notes/types";
import { isoWeek } from "../noteTemplates/templates";

export type RecordKind = "diary" | "weekly" | "monthly";
export const RECORD_KINDS: RecordKind[] = ["diary", "weekly", "monthly"];
export const SYSTEM_ROOTS = [...RECORD_KINDS, "tiles"];
export const isSystemFolder = (path: string) =>
  SYSTEM_ROOTS.includes(path.split("/")[0].toLowerCase());
export const isWritableFolder = (path: string) => !isSystemFolder(path) || path === "tiles";

export function defaultPeriod(kind: RecordKind, date = new Date()): string {
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return kind === "diary"
    ? `${month}-${String(date.getDate()).padStart(2, "0")}`
    : kind === "weekly"
      ? isoWeek(date)
      : month;
}

export function periodDate(kind: RecordKind, period: string): Date | null {
  if (kind === "weekly") {
    const match = /^(\d{4})-W(\d{2})$/.exec(period);
    if (!match) return null;
    const date = new Date(Number(match[1]), 0, 4, 12);
    date.setDate(date.getDate() + 4 - (date.getDay() || 7) + (Number(match[2]) - 1) * 7);
    return isoWeek(date) === period && date.getFullYear() >= 1000 ? date : null;
  }
  const match = (kind === "diary" ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{4})-(\d{2})$/).exec(period);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3] ?? 1), 12);
  return date.getFullYear() >= 1000 && defaultPeriod(kind, date) === period ? date : null;
}

export function canonicalFolder(kind: RecordKind, period: string): string | null {
  const date = periodDate(kind, period);
  if (!date) return null;
  if (kind === "diary") {
    const week = isoWeek(date);
    return `diary/${week.slice(0, 4)}/${week}`;
  }
  if (kind === "weekly") return `weekly/${defaultPeriod("monthly", date).replace("-", "/")}`;
  return `monthly/${period.slice(0, 4)}`;
}

export interface LibraryNode {
  path: string;
  name: string;
  children: LibraryNode[];
  notes: NoteMetadata[];
}

export function countLibraryNotes(node: LibraryNode): number {
  const ids = new Set<string>();
  const visit = (entry: LibraryNode) => {
    entry.notes.forEach((note) => ids.add(note.id));
    entry.children.forEach(visit);
  };
  visit(node);
  return ids.size;
}

export function buildLibraryTree(notes: NoteMetadata[], folders: string[]): LibraryNode {
  const root: LibraryNode = { path: "", name: "", children: [], notes: [] };
  const nodes = new Map<string, LibraryNode>([["", root]]);
  const ensure = (path: string): LibraryNode => {
    const existing = nodes.get(path);
    if (existing) return existing;
    const parts = path.split("/");
    const name = parts.pop()!;
    const parent = ensure(parts.join("/"));
    const node = { path, name, children: [], notes: [] };
    parent.children.push(node);
    nodes.set(path, node);
    return node;
  };
  SYSTEM_ROOTS.forEach(ensure);
  const visibleFolders = new Set(folders);
  // Only populated period branches are shown. User folders remain visible even empty.
  folders.filter((path) => !isSystemFolder(path)).forEach(ensure);
  for (const note of notes) {
    const managed =
      note.recordType && note.recordType !== "ordinary" && note.recordPeriod
        ? canonicalFolder(note.recordType, note.recordPeriod)
        : null;
    if (managed) ensure(managed).notes.push(note);
    if (!managed || !isSystemFolder(note.category) || note.category === "tiles") {
      // The backend decides which physical folders belong in the library.
      // Keep indexed notes accessible without reintroducing hidden paths.
      const category =
        isSystemFolder(note.category) || visibleFolders.has(note.category) ? note.category : "";
      if (!managed || category) ensure(category).notes.push(note);
    }
  }
  const sort = (node: LibraryNode) => {
    node.notes.sort((a, b) =>
      isSystemFolder(node.path) && node.path !== "tiles"
        ? (b.recordPeriod ?? "").localeCompare(a.recordPeriod ?? "") ||
          b.createdAt.localeCompare(a.createdAt)
        : b.createdAt.localeCompare(a.createdAt),
    );
    node.children.sort((a, b) => {
      if (!node.path) {
        const ai = SYSTEM_ROOTS.indexOf(a.path),
          bi = SYSTEM_ROOTS.indexOf(b.path);
        if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      }
      return isSystemFolder(node.path)
        ? b.name.localeCompare(a.name)
        : a.name.localeCompare(b.name);
    });
    node.children.forEach(sort);
  };
  sort(root);
  return root;
}
