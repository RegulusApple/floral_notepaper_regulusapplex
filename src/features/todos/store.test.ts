import { describe, expect, it, vi } from "vitest";
import { createTodoClient, optimisticTodo, type TodoState } from "./store";

const empty = (): TodoState => ({ revision: 0, items: [], opacity: 0.45 });
describe("independent todo action queue", () => {
  it("rebases pending actions on other windows without erasing either task", async () => {
    let release!: (value: TodoState) => void;
    const save = vi.fn(
      () =>
        new Promise<TodoState>((resolve) => {
          release = resolve;
        }),
    );
    const client = createTodoClient(save);
    client.receive(empty());
    client.dispatch({ type: "add", id: "local", text: "local" });
    const remote = {
      ...optimisticTodo(empty(), { type: "add", id: "remote", text: "remote" }),
      revision: 1,
    };
    client.receive(remote);
    expect(client.snapshot().state.items.map((item) => item.id)).toEqual(["remote", "local"]);
    release({
      ...optimisticTodo(remote, { type: "add", id: "local", text: "local" }),
      revision: 2,
    });
    await client.flush();
    client.receive(empty()); // A late initial read must not undo a newer event.
    expect(client.snapshot().state.items.map((item) => item.id)).toEqual(["remote", "local"]);
    expect(client.snapshot().pending).toBe(0);
  });
  it("keeps a failed draft and retries the same ID after an uncertain acknowledgement", async () => {
    let disk = empty();
    let first = true;
    const client = createTodoClient(async (action) => {
      disk = { ...optimisticTodo(disk, action), revision: disk.revision + 1 };
      if (first) {
        first = false;
        throw new Error("lost response");
      }
      return disk;
    });
    client.receive(disk);
    client.dispatch({ type: "add", id: "a", text: "Keep me" });
    await expect(client.flush()).rejects.toThrow("lost response");
    expect(client.snapshot().state.items[0].text).toBe("Keep me");
    await client.retry();
    await client.flush();
    expect(disk.items).toHaveLength(1);
    expect(client.snapshot().error).toBeNull();
  });
  it("serializes rapid edits, completion, reorder and opacity separately", async () => {
    let disk = empty();
    let inFlight = 0;
    const client = createTodoClient(async (action) => {
      expect(++inFlight).toBe(1);
      await Promise.resolve();
      disk = { ...optimisticTodo(disk, action), revision: disk.revision + 1 };
      --inFlight;
      return disk;
    });
    client.receive(disk);
    client.dispatch({ type: "add", id: "a", text: "first" });
    client.dispatch({ type: "add", id: "b", text: "second" });
    client.dispatch({ type: "edit", id: "a", text: "first\ncontinued" });
    client.dispatch({ type: "complete", id: "a", completed: true });
    client.dispatch({ type: "move", id: "b", before: "a" });
    client.dispatch({ type: "opacity", value: 0.123 });
    await client.flush();
    expect(disk.items.map((item) => item.id)).toEqual(["b", "a"]);
    expect(disk.items[1]).toMatchObject({ text: "first\ncontinued", completed: true });
    expect(disk.opacity).toBe(0.1);
    client.dispatch({ type: "delete", id: "a" });
    await client.flush();
    expect(disk.items.map((item) => item.id)).toEqual(["b"]);
  });
});
