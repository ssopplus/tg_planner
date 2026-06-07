-- Объединение трёх проектов в pola-erp.
--
-- Контекст: раньше Pola ERP был тремя отдельными проектами (erp,
-- pola-tech-front, master-reporting-tool-electron). YT-задачи из
-- очереди POLAERP лились только в erp; ручной разбивки между фронтом
-- и electron не было — потому что в Tracker'е тоже один поток.
-- Объединили в один проект pola-erp.
--
-- Что делает скрипт:
--   1. Переключает все задачи erp/pola-tech-front/master-reporting-tool-electron
--      на проект pola-erp (создаётся скриптом sync-vault-projects.ts перед накаткой).
--   2. Удаляет три старых проекта.
--
-- Перед запуском:
--   - Запушить новую структуру vault в obsidian-docs (она у нас уже сделана).
--   - В коде поменять QUEUE_TO_PROJECT_SLUG: POLAERP -> pola-erp (отдельный коммит).
--   - Накатить pnpm sync:vault на прод, чтобы создался pola-erp.
--   - Только потом запускать этот SQL.
--
-- На прод НЕ накатывать руками; запустить через psql локально с прод-DATABASE_URL.

BEGIN;

-- 1. Перевешиваем задачи на pola-erp
WITH target AS (
  SELECT id FROM projects WHERE slug = 'pola-erp'
)
UPDATE tasks
SET project_id = (SELECT id FROM target)
WHERE project_id IN (
  SELECT id FROM projects
  WHERE slug IN ('erp', 'pola-tech-front', 'master-reporting-tool-electron')
);

-- 2. Удаляем старые проекты (cascade в schema нет — задачи мы уже перевесили,
--    напоминаний/подзадач у проектов нет напрямую, есть только через tasks).
DELETE FROM projects
WHERE slug IN ('erp', 'pola-tech-front', 'master-reporting-tool-electron');

-- 3. Контроль
SELECT slug, name, kind FROM projects WHERE slug LIKE '%erp%' OR slug LIKE '%pola%';
SELECT count(*) AS tasks_in_pola_erp
FROM tasks t JOIN projects p ON p.id = t.project_id
WHERE p.slug = 'pola-erp';

COMMIT;
