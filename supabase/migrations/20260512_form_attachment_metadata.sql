-- PULSE-349: capture original filename and content type for each form attachment.
--
-- Existing column `attachment_paths text[]` only stores the storage path
-- (UUID + extension), which loses the user-uploaded filename and forces every
-- attachment to be rendered as an inline image. To support PDFs/docs in the
-- form upload flow we need the original filename for the markdown link text
-- and the content type to decide between `![alt](url)` and `[label](url)`.
--
-- We add a parallel JSONB column instead of converting the existing one so
-- in-flight retries on already-stored submissions keep working unchanged.

ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS attachment_metadata jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN form_submissions.attachment_metadata IS
  'Array of {path, fileName, contentType} per attachment. Source of truth for new submissions; attachment_paths is kept in sync for backward compatibility.';
