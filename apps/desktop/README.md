# Desktop (сенсорная касса)

Electron kiosk + sidecar `local-api`.

## Команды (из корня репо)

```bash
pnpm dist:pos      # portable exe → apps/desktop/release/
pnpm release:pos   # сборка + GitHub Release (art-pos-update.zip + exe)
pnpm dev:desktop   # сборка web + Electron (нужен Node 22+ в PATH)
pnpm kiosk         # без Electron: Edge/Chrome --kiosk
```

Обновление на кассе: Админ → **Обновления**.

Выход из kiosk: `Ctrl+Shift+Q`. Документация: `doc/features/02-windows-exe-packaging.md`.
