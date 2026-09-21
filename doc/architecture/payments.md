# Адаптеры оплаты (этап 3)

## Карта — CardTerminalProvider

Настройка в админке → «Терминал»:

| adapter | Поведение |
|---------|-----------|
| `emulator` | UI подтверждение / отмена |
| `generic_http` | POST `http://{host}:{port}/pay` |
| `sdk_bridge` | POST на `ART_TERMINAL_BRIDGE_URL` (по умолчанию `http://127.0.0.1:3920/pay`) |

Заготовка bridge: `services/terminal-bridge` — замените тело на вызов SDK конкретной модели.

```bash
pnpm dev:bridge
```

## СБП — SbpQrProvider

| Режим | Env |
|-------|-----|
| Эмулятор (по умолчанию) | `ART_SBP_MODE` не задан или `emulator` |
| HTTP-провайдер | `ART_SBP_MODE=http`, `ART_SBP_API_URL`, `ART_SBP_API_TOKEN` |

Без интернета кнопка СБП блокируется на кассе.
