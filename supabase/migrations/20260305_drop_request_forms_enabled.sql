-- Remove unused request_forms_enabled column from client_hubs
ALTER TABLE client_hubs
  DROP COLUMN IF EXISTS request_forms_enabled;
