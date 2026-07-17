# Desktop (сенсорная касса)

Electron kiosk + sidecar `local-api`.

## Команды (из корня репо)

```bash
pnpm dist:pos      # portable exe → apps/desktop/release/
pnpm dev:desktop   # сборка web + Electron (нужен Node в PATH)
pnpm kiosk         # без Electron: Edge/Chrome --kiosk
```

Выход из kiosk: `Ctrl+Shift+Q`. Документация: `doc/features/02-windows-exe-packaging.md`.
