/**
 * Заготовка local bridge для SDK банковского терминала.
 * Запуск рядом с local-api, когда адаптер = sdk_bridge.
 *
 * POST /pay { amountKopecks, orderId, paymentId }
 * → { status: "paid" | "cancelled" | "failed", message? }
 *
 * Сейчас отвечает эмулятором успеха — замените вызов на SDK модели терминала.
 */
import http from "node:http";

const port = Number(process.env.PORT ?? 3920);

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/pay") {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    console.log("[bridge] pay", body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "paid", message: "Bridge emulator OK" }));
    return;
  }
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`terminal-bridge emulator on :${port}`);
});
