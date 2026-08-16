import type { R2Client } from "../../vault/r2-client";
import type { VaultConfig, ToolResult } from "../../types";
import type { VaultIndex } from "../../vault/index-store";
import { ok, err } from "../../types";
import { readNote, createNote, patchNote } from "./notes";

export interface MemoryRecallResult {
  query: string;
  matches: {
    path: string;
    snippet?: string;
    content?: string;
  }[];
}

export async function recallMemory(
  c: R2Client,
  cfg: VaultConfig,
  index: VaultIndex,
  args: {
    query: string;
    limit?: number;
  },
): Promise<ToolResult<MemoryRecallResult>> {
  const query = args.query.trim();

  if (!query) {
    return err("empty_query");
  }

  const limit = Math.min(Math.max(args.limit ?? 8, 1), 12);

  const search = await index.search(query.slice(0, 48), limit);

  const matches: MemoryRecallResult["matches"] = [];

  for (const result of search) {
    const path = result.path;

    const note = await readNote(c, cfg, { path });

    if (!note.ok) continue;

    matches.push({
      path,
      snippet: "snippet" in result ? result.snippet : undefined,
      content: note.value.content,
    });
  }

  return ok({
    query,
    matches,
  });
}

export async function remember(
  c: R2Client,
  cfg: VaultConfig,
  index: VaultIndex,
  args: {
    path: string;
    content: string;
    search_query?: string;
  },
): Promise<
  ToolResult<{
    action: "created" | "updated";
    path: string;
  }>
> {
  const path = args.path;

  const existing = await readNote(c, cfg, { path });

  if (existing.ok) {
    const oldContent = existing.value.content;

    if (oldContent === args.content) {
      return ok({
        action: "updated",
        path,
      });
    }

    const patched = await patchNote(c, cfg, {
      path,
      old_str: oldContent,
      new_str: args.content,
    });

    if (!patched.ok) {
      return patched;
    }

    index.upsertFromContent(
      path,
      patched.value.content,
      patched.value.etag,
    );

    return ok({
      action: "updated",
      path,
    });
  }

  const created = await createNote(c, cfg, {
    path,
    content: args.content,
  });

  if (!created.ok) {
    return created;
  }

  index.upsertFromContent(
    path,
    created.value.content,
    created.value.etag,
  );

  return ok({
    action: "created",
    path,
  });
}
