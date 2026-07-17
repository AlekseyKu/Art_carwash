import { nanoid } from "nanoid";
import { db, getSetting } from "./db.js";

export function enqueueOutbox(type: string, payload: unknown) {
  db.prepare(
    "INSERT INTO outbox (id, type, payload, created_at, synced_at) VALUES (?, ?, ?, ?, NULL)"
  ).run(nanoid(), type, JSON.stringify(payload), new Date().toISOString());
}

export async function flushOutbox(): Promise<{ synced: number; error?: string }> {
  const url = getSetting("cloud_sync_url");
  const token = getSetting("cloud_sync_token") ?? "art-sync-secret";
  if (!url) return { synced: 0, error: "cloud_sync_url не задан" };

  const rows = db
    .prepare("SELECT * FROM outbox WHERE synced_at IS NULL ORDER BY created_at ASC LIMIT 50")
    .all() as { id: string; type: string; payload: string; created_at: string }[];

  if (!rows.length) return { synced: 0 };

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sync-token": token,
      },
      body: JSON.stringify({
        events: rows.map((r) => ({
          id: r.id,
          type: r.type,
          payload: JSON.parse(r.payload),
          createdAt: r.created_at,
        })),
      }),
    });
    if (!res.ok) {
      return { synced: 0, error: `cloud ${res.status}` };
    }
    const now = new Date().toISOString();
    const upd = db.prepare("UPDATE outbox SET synced_at = ? WHERE id = ?");
    db.exec("BEGIN");
    try {
      for (const r of rows) upd.run(now, r.id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { synced: rows.length };
  } catch (e) {
    return { synced: 0, error: e instanceof Error ? e.message : "sync failed" };
  }
}

export function startSyncLoop(intervalMs = 15_000) {
  const tick = async () => {
    const result = await flushOutbox();
    if (result.synced > 0) {
      console.log(`[sync] synced ${result.synced}`);
    } else if (result.error) {
      console.log(`[sync] ${result.error}`);
    }
  };
  void tick();
  return setInterval(() => void tick(), intervalMs);
}
