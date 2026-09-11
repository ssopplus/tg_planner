-- Правило разбора очереди VDHWEBNEW («ВодоходЪ Сайт 2027»).
--
-- В очереди лежат тикеты двух проектов, и компонентов или тегов у них нет:
-- задачи интура помечены только префиксом «WEB Интур //» в заголовке.
-- Связка с фильтром забирает их в проект intur, а перенесённая миграцией 0010
-- связка без фильтра остаётся fallback'ом на vodohod-new-site.
--
-- Тот же результат даёт экран «Настройки → Очереди Трекера» в Mini App —
-- этот файл на случай, когда правило удобнее накатить psql'ом.
--
-- После наката прогнать синк: задачи VDHWEBNEW-2 и VDHWEBNEW-5 переедут
-- в intur сами (синк перезаписывает project_id при обновлении задачи).

INSERT INTO tracker_queue_links
  (id, user_id, queue_key, project_id, title_filter, is_default_for_project)
SELECT
  gen_random_uuid()::text,
  p.user_id,
  'VDHWEBNEW',
  p.id,
  'WEB Интур',
  false
FROM projects p
WHERE p.slug = 'intur'
ON CONFLICT DO NOTHING;

-- Проверка: ожидается две строки — фильтр «WEB Интур» → intur
-- и fallback (title_filter IS NULL) → vodohod-new-site.
SELECT l.queue_key, p.name AS project, l.title_filter, l.is_default_for_project
FROM tracker_queue_links l
JOIN projects p ON p.id = l.project_id
WHERE l.queue_key = 'VDHWEBNEW'
ORDER BY l.title_filter NULLS LAST;
