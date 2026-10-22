-- Подключение аккаунта площадки — после подтверждения на странице возврата (AccountsService.confirm)
ALTER TABLE "OAuthPending" ADD COLUMN "account" JSONB;
