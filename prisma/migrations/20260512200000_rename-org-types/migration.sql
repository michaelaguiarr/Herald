-- RenameEnumValue: PAROQUIA → ORGANIZACAO, COMUNIDADE → FILIAL
-- PostgreSQL 10+ supports ALTER TYPE ... RENAME VALUE natively.
-- Existing rows in "organization"."type" are updated in-place (no data loss).
ALTER TYPE "OrgType" RENAME VALUE 'PAROQUIA' TO 'ORGANIZACAO';
ALTER TYPE "OrgType" RENAME VALUE 'COMUNIDADE' TO 'FILIAL';
