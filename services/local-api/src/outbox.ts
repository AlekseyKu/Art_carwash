import { nanoid } from "nanoid";
import { db } from "./db.js";

export function enqueueOutbox(type: string, payload: unknown) {
  db.prepare(
    "INSERT INTO outbox (id, type, payload, created_at, synced_at) VALUES (?, ?, ?, ?, NULL)"
  ).run(nanoid(), type, JSON.stringify(payload), new Date().toISOString());
}
