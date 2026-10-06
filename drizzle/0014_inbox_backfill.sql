-- Перенос внутренних задач на доску «Входящие».
--
-- Внутренняя задача — та, что не пришла ни из Трекера (external_source),
-- ни из Obsidian-vault (vault_path). После переработки такие задачи живут
-- на досках, поэтому каждой нужна доска по умолчанию.

-- Доска «Входящие» каждому пользователю, у кого её ещё нет.
INSERT INTO "boards" ("id", "user_id", "name", "emoji", "sort_order", "is_inbox")
SELECT gen_random_uuid()::text, u."id", 'Входящие', '📥', 0, true
FROM "users" u
WHERE NOT EXISTS (
  SELECT 1 FROM "boards" b WHERE b."user_id" = u."id" AND b."is_inbox"
);
--> statement-breakpoint

-- Сами задачи. description переезжает в body: на доске карточка показывает
-- заметку, а description остаётся полем синка с внешними системами.
-- Архивные не трогаем — они не должны всплыть на новой доске.
UPDATE "tasks" t
SET "board_id" = b."id",
    "body" = COALESCE(t."body", t."description")
FROM "boards" b
WHERE b."user_id" = t."user_id"
  AND b."is_inbox"
  AND t."board_id" IS NULL
  AND t."external_source" IS NULL
  AND t."vault_path" IS NULL
  AND t."status" <> 'ARCHIVED';
