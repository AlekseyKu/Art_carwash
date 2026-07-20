import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  document.body.innerHTML =
    '<main style="font-family:sans-serif;padding:2rem;text-align:center"><h1>Нет #root</h1><p>Переустановите приложение.</p></main>';
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

// Глобальный запасной лог — чтобы сбои не «молчали»
window.addEventListener("unhandledrejection", (ev) => {
  console.error("[unhandledrejection]", ev.reason);
});
window.addEventListener("error", (ev) => {
  console.error("[window.error]", ev.error ?? ev.message);
});
