# Релиз кассы (POS)

Версия: `apps/desktop/package.json` → `version` (semver). Перед каждой сборкой — bump.

```bash
# только артефакты
pnpm dist:pos

# exe + art-pos-update.zip → GitHub Release pos-vX.Y.Z
pnpm release:pos
```

Нужен `gh auth login`. Подробности и установка на мини-ПК: [../pos/packaging.md](../pos/packaging.md).

На кассе: **Админ → Обновления → Проверить / Обновить** (скачивает zip в AppData, БД не трогает).
