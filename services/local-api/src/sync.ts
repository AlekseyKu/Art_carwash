import { nanoid } from "nanoid";
import { upsertLocalBooking, type BookingPayload } from "./bookings.js";
import { db, getSetting } from "./db.js";

export function enqueueOutbox(type: string, payload: unknown) {
  db.prepare(
    "INSERT INTO outbox (id, type, payload, created_at, synced_at) VALUES (?, ?, ?, ?, NULL)"
  ).run(nanoid(), type, JSON.stringify(payload), new Date().toISOString());
}

function applyPullEvents(
  events: { id: string; type: string; payload: unknown; createdAt: string }[]
) {
  for (const ev of events) {
    if (ev.type === "booking.upsert" || ev.type === "booking.status") {
      upsertLocalBooking(ev.payload as BookingPayload);
    }
  }
}

export async function flushOutbox(): Promise<{ synced: number; pulled: number; error?: string }> {
  const url = getSetting("cloud_sync_url");
  const token = getSetting("cloud_sync_token") ?? "art-sync-secret";
  if (!url) return { synced: 0, pulled: 0, error: "cloud_sync_url не задан" };

  const rows = db
    .prepare("SELECT * FROM outbox WHERE synced_at IS NULL ORDER BY created_at ASC LIMIT 50")
    .all() as { id: string; type: string; payload: string; created_at: string }[];

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
      return { synced: 0, pulled: 0, error: `cloud ${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as {
      events?: { id: string; type: string; payload: unknown; createdAt: string }[];
    };
    const pull = data.events ?? [];
    applyPullEvents(pull);

    const now = new Date().toISOString();
    if (rows.length) {
      const upd = db.prepare("UPDATE outbox SET synced_at = ? WHERE id = ?");
      db.exec("BEGIN");
      try {
        for (const r of rows) upd.run(now, r.id);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
    return { synced: rows.length, pulled: pull.length };
  } catch (e) {
    return { synced: 0, pulled: 0, error: e instanceof Error ? e.message : "sync failed" };
  }
}

export function startSyncLoop(intervalMs = 15_000) {
  const tick = async () => {
    const result = await flushOutbox();
    if (result.synced > 0 || result.pulled > 0) {
      console.log(`[sync] synced ${result.synced}, pulled ${result.pulled}`);
    } else if (result.error) {
      console.log(`[sync] ${result.error}`);
    }
  };
  void tick();
  return setInterval(() => void tick(), intervalMs);
}
