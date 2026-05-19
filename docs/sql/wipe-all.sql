-- Полная очистка пользовательских данных: проекты, задачи, подзадачи,
-- напоминания, pending. Пользователи и настройки (timezone, digest)
-- остаются.
--
-- Каскадные FK сделают часть работы автоматически, но явный порядок
-- защищает от случаев, когда у кого-то FK без ON DELETE CASCADE.
--
-- ВНИМАНИЕ: данные не восстанавливаются. Запускать только через
-- workflow .github/workflows/wipe-prod.yml с workflow_dispatch.

BEGIN;

DELETE FROM reminders;
DELETE FROM subtasks;
DELETE FROM pending_tasks;
DELETE FROM tasks;
DELETE FROM projects;

COMMIT;
