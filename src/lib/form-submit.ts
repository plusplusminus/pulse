import {
  supabaseAdmin,
  type AttachmentMetadata,
  type FormField,
  type FormSubmission,
} from "./supabase";
import { createIssueInLinear, updateIssueTitle } from "./linear-push";
import {
  fetchFormWithFields,
  fetchHubFormConfig,
} from "./form-read";
import { logSyncEvent } from "./sync-logger";
import { applyEmojiToTitle, classifyIssueEmoji } from "./issue-emoji";
import { isImageMimeType, publicAttachmentUrl } from "./hub-upload";

const FORM_ATTACHMENTS_BUCKET = "form-attachments";

type AttachmentForDescription = AttachmentMetadata & { url: string };

/**
 * Convert stored attachment metadata into the shape used by description
 * building. Falls back to an image-typed entry per legacy `attachment_paths`
 * row when no rich metadata has been recorded for a submission (true for any
 * row created before PULSE-349 — those flows were image-only).
 */
function resolveAttachmentsForDescription(
  metadata: AttachmentMetadata[] | null | undefined,
  paths: string[] | null | undefined,
  supabaseUrl: string
): AttachmentForDescription[] {
  if (metadata && metadata.length > 0) {
    return metadata.map((m) => ({
      ...m,
      url: publicAttachmentUrl(supabaseUrl, FORM_ATTACHMENTS_BUCKET, m.path),
    }));
  }
  return (paths ?? []).map((path) => {
    const fileName = path.split("/").pop() ?? path;
    return {
      path,
      fileName,
      contentType: "image/*",
      url: publicAttachmentUrl(supabaseUrl, FORM_ATTACHMENTS_BUCKET, path),
    };
  });
}

// -- Types ────────────────────────────────────────────────────────────────────

export type SubmissionUser = {
  id: string;
  email: string;
  name?: string;
};

export type SubmissionResult = {
  submissionId: string;
  syncStatus: "synced" | "failed";
  linearIssueIdentifier?: string;
  confirmationMessage: string;
  errorMessage?: string;
};

// -- Description builder ─────────────────────────────────────────────────────

const PRIORITY_LABELS: Record<number, string> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

function formatFieldValue(field: FormField, val: unknown): string {
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (Array.isArray(val)) {
    return val
      .map((v) => resolveOptionLabel(field, String(v)))
      .join(", ");
  }

  const strVal = String(val).trim();

  // Map priority numbers to labels
  if (field.linear_field === "priority") {
    const num = Number(strVal);
    if (!isNaN(num) && num in PRIORITY_LABELS) {
      return PRIORITY_LABELS[num];
    }
  }

  // Resolve select/radio option values to their human-readable labels
  if (field.field_type === "select" || field.field_type === "radio") {
    return resolveOptionLabel(field, strVal);
  }

  return strVal;
}

/**
 * Look up the human-readable label for a select/radio option value.
 * Falls back to the raw value if no matching option is found.
 */
function resolveOptionLabel(field: FormField, value: string): string {
  if (!field.options?.length) return value;
  const match = field.options.find((o) => o.value === value);
  return match?.label ?? value;
}

/**
 * Build a markdown description for the Linear issue.
 * Linear-mapped fields (title, description) are handled separately.
 * Everything else goes into an "Additional Information" block.
 */
export function buildIssueDescription(
  fields: FormField[],
  fieldValues: Record<string, unknown>,
  attachments: AttachmentForDescription[],
  submitter?: { name?: string | null; email: string }
): string {
  const parts: string[] = [];

  // Submitter attribution
  if (submitter) {
    const who = submitter.name ? `${submitter.name} (${submitter.email})` : submitter.email;
    parts.push(`**Submitted by:** ${who}`);
  }

  // Find the description-mapped field
  const descField = fields.find((f) => f.linear_field === "description");
  if (descField) {
    const val = fieldValues[descField.field_key];
    if (val && typeof val === "string" && val.trim()) {
      parts.push(val.trim());
    }
  }

  // Custom fields (not mapped to title or description)
  const customFields = fields.filter(
    (f) =>
      f.linear_field !== "title" &&
      f.linear_field !== "description" &&
      !f.is_hidden
  );

  const customParts: string[] = [];
  for (const field of customFields) {
    const val = fieldValues[field.field_key];
    if (val === undefined || val === null || val === "") continue;

    // Skip file fields (handled via attachments)
    if (field.field_type === "file") continue;

    const displayVal = formatFieldValue(field, val);

    if (displayVal) {
      customParts.push(`### ${field.label}\n${displayVal}`);
    }
  }

  if (customParts.length > 0) {
    parts.push("---");
    parts.push("## Additional Information");
    parts.push(customParts.join("\n\n"));
  }

  // Attachments — images render inline, everything else as a file link so it
  // shows as a clickable chip rather than a broken image in Linear or Pulse.
  if (attachments.length > 0) {
    parts.push("---");
    parts.push("## Attachments");
    for (const att of attachments) {
      const label = att.fileName || "attachment";
      parts.push(
        isImageMimeType(att.contentType)
          ? `![${label}](${att.url})`
          : `[${label}](${att.url})`
      );
    }
  }

  return parts.join("\n\n");
}

// -- Emoji reconciliation ────────────────────────────────────────────────────

/**
 * After an issue is created, classify it by labels + priority and prepend
 * the appropriate emoji to its title (if any). Returns the final title that
 * should be persisted to `form_submissions.derived_title`.
 *
 * Idempotent: applying the same emoji twice is a no-op, both for the title
 * string itself and for the Linear API call (skipped when nothing changes).
 */
async function reconcileEmojiOnCreate(issue: {
  id: string;
  title: string;
  priority: number;
  labels: Array<{ id: string; name: string; color: string }>;
}): Promise<string> {
  const newEmoji = classifyIssueEmoji(issue.labels, issue.priority);
  const finalTitle = applyEmojiToTitle(issue.title, newEmoji);
  if (finalTitle !== issue.title) {
    try {
      await updateIssueTitle(issue.id, finalTitle);
    } catch (err) {
      console.error(
        `[issue-emoji] Failed to update title for ${issue.id}:`,
        err
      );
      return issue.title;
    }
  }
  return finalTitle;
}

// -- Submission pipeline ─────────────────────────────────────────────────────

/**
 * Process a form submission end-to-end:
 * 1. Fetch form + fields + hub config
 * 2. Resolve routing
 * 3. Extract Linear-mapped field values
 * 4. Build description
 * 5. Insert submission row (pending)
 * 6. Create issue in Linear
 * 7. Update submission row (synced/failed)
 */
export async function processFormSubmission(
  formId: string,
  hubId: string,
  fieldValues: Record<string, unknown>,
  attachments: AttachmentMetadata[],
  user: SubmissionUser,
  clientTeamId?: string,
  clientProjectId?: string,
): Promise<SubmissionResult> {
  // 1. Fetch form + fields
  const form = await fetchFormWithFields(formId);
  if (!form) throw new Error("Form not found");
  if (!form.is_active) throw new Error("Form is not active");

  // 2. Resolve team — prefer client-provided (from URL context), fall back to hub mapping
  let teamId = clientTeamId;
  if (!teamId) {
    const { data: teamMapping } = await supabaseAdmin
      .from("hub_team_mappings")
      .select("linear_team_id")
      .eq("hub_id", hubId)
      .eq("is_active", true)
      .limit(1)
      .single();

    teamId = teamMapping?.linear_team_id;
  }

  if (!teamId) {
    throw new Error("No team specified and no team mapping found for this hub");
  }

  // Validate the team belongs to this hub
  const { data: validTeam } = await supabaseAdmin
    .from("hub_team_mappings")
    .select("id")
    .eq("hub_id", hubId)
    .eq("linear_team_id", teamId)
    .eq("is_active", true)
    .maybeSingle();

  if (!validTeam) {
    throw new Error("Selected team is not associated with this hub");
  }

  const projectId = clientProjectId ?? null;
  const hubConfig = await fetchHubFormConfig(hubId, formId);
  const defaultLabelIds = hubConfig?.target_label_ids ?? form.target_label_ids ?? [];

  // Merge user-selected labels from label_ids field with admin defaults
  const labelIdsField = form.fields.find((f) => f.linear_field === "label_ids");
  const userLabelIds = labelIdsField
    ? String(fieldValues[labelIdsField.field_key] ?? "")
        .split(",")
        .filter(Boolean)
    : [];
  const labelIds = [...new Set([...defaultLabelIds, ...userLabelIds])];

  // 3. Extract Linear-mapped field values
  const titleField = form.fields.find((f) => f.linear_field === "title");
  const title = titleField
    ? String(fieldValues[titleField.field_key] ?? "").trim()
    : "Untitled submission";

  if (!title) throw new Error("Title is required");

  // Apply hidden field defaults
  for (const field of form.fields) {
    if (field.is_hidden && field.default_value !== null) {
      fieldValues[field.field_key] = field.default_value;
    }
  }

  // Priority from hidden field (if any)
  const priorityField = form.fields.find(
    (f) => f.linear_field === "priority"
  );
  const priority = priorityField
    ? Number(fieldValues[priorityField.field_key])
    : undefined;

  // 4. Build description
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const attachmentsForDescription = resolveAttachmentsForDescription(
    attachments,
    attachments.map((a) => a.path),
    supabaseUrl
  );

  const description = buildIssueDescription(
    form.fields,
    fieldValues,
    attachmentsForDescription,
    { name: user.name, email: user.email }
  );

  // 5. Insert submission row
  const confirmationMessage =
    hubConfig?.confirmation_message ?? form.confirmation_message;

  const { data: submission, error: insertErr } = await supabaseAdmin
    .from("form_submissions")
    .insert({
      form_id: formId,
      hub_id: hubId,
      submitter_user_id: user.id,
      submitter_email: user.email,
      submitter_name: user.name ?? null,
      field_values: fieldValues,
      derived_title: title,
      sync_status: "pending",
      attachment_paths: attachments.map((a) => a.path),
      attachment_metadata: attachments,
    })
    .select("id")
    .single();

  if (insertErr) throw new Error(`Failed to save submission: ${insertErr.message}`);

  const submissionId = submission.id;

  // 6. Create issue in Linear
  const syncStart = Date.now();
  try {
    const authorName = user.name || user.email;
    const issue = await createIssueInLinear(
      {
        teamId,
        title,
        description: description || undefined,
        priority: priority ?? undefined,
        labelIds: labelIds.length > 0 ? labelIds : undefined,
        projectId: projectId ?? undefined,
      },
      undefined,
      { authorName },
    );

    // 6b. Apply emoji prefix based on labels + priority returned by Linear.
    const finalTitle = await reconcileEmojiOnCreate(issue);

    // 7a. Success — update row
    await supabaseAdmin
      .from("form_submissions")
      .update({
        sync_status: "synced",
        linear_issue_id: issue.id,
        linear_issue_identifier: issue.identifier,
        derived_title: finalTitle,
        sync_attempted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", submissionId);

    void logSyncEvent({
      eventType: "FormSubmission",
      action: "create",
      entityId: submissionId,
      teamId,
      status: "success",
      processingTimeMs: Date.now() - syncStart,
      payloadSummary: { title, formName: form.name, formId, hubId, issueIdentifier: issue.identifier },
    });

    return {
      submissionId,
      syncStatus: "synced",
      linearIssueIdentifier: issue.identifier,
      confirmationMessage,
    };
  } catch (err) {
    // 7b. Failure — update row
    const syncError =
      err instanceof Error ? err.message : "Unknown error creating issue";

    await supabaseAdmin
      .from("form_submissions")
      .update({
        sync_status: "failed",
        sync_error: syncError,
        sync_attempted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", submissionId);

    void logSyncEvent({
      eventType: "FormSubmission",
      action: "create",
      entityId: submissionId,
      teamId,
      status: "error",
      errorMessage: syncError,
      processingTimeMs: Date.now() - syncStart,
      payloadSummary: { title, formName: form.name, formId, hubId },
    });

    return {
      submissionId,
      syncStatus: "failed",
      confirmationMessage,
      errorMessage: form.error_message,
    };
  }

}

/**
 * Retry a failed submission: re-attempt the Linear issue creation.
 */
export async function retrySubmission(
  submissionId: string
): Promise<SubmissionResult> {
  // Fetch the submission
  const { data: sub, error: subErr } = await supabaseAdmin
    .from("form_submissions")
    .select("*")
    .eq("id", submissionId)
    .single();

  if (subErr) throw new Error(`Submission not found: ${subErr.message}`);

  const submission = sub as FormSubmission;

  if (submission.sync_status === "synced") {
    return {
      submissionId,
      syncStatus: "synced",
      linearIssueIdentifier: submission.linear_issue_identifier ?? undefined,
      confirmationMessage: "Already synced.",
    };
  }

  // Fetch form + hub config
  const form = await fetchFormWithFields(submission.form_id);
  if (!form) throw new Error("Form no longer exists");

  // Resolve team from hub mapping
  const { data: teamMapping, error: tmErr } = await supabaseAdmin
    .from("hub_team_mappings")
    .select("linear_team_id")
    .eq("hub_id", submission.hub_id)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (tmErr || !teamMapping?.linear_team_id) {
    throw new Error("No team mapping found for this hub");
  }

  const teamId = teamMapping.linear_team_id;

  const hubConfig = await fetchHubFormConfig(
    submission.hub_id,
    submission.form_id
  );
  const labelIds = hubConfig?.target_label_ids ?? form.target_label_ids ?? [];

  // Rebuild description from saved field values. Prefer the rich metadata
  // recorded by PULSE-349; fall back to attachment_paths for older rows that
  // predate that column (always image-only by construction).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const attachmentsForDescription = resolveAttachmentsForDescription(
    submission.attachment_metadata,
    submission.attachment_paths,
    supabaseUrl
  );

  const description = buildIssueDescription(
    form.fields,
    submission.field_values,
    attachmentsForDescription,
    { name: submission.submitter_name, email: submission.submitter_email }
  );

  // Priority from hidden field (if any)
  const priorityField = form.fields.find((f) => f.linear_field === "priority");
  const priority = priorityField
    ? Number(submission.field_values[priorityField.field_key])
    : undefined;

  const confirmationMessage =
    hubConfig?.confirmation_message ?? form.confirmation_message;

  const syncStart = Date.now();
  try {
    const retryAuthorName = submission.submitter_name || submission.submitter_email;
    const issue = await createIssueInLinear(
      {
        teamId,
        title: submission.derived_title,
        description: description || undefined,
        priority: priority ?? undefined,
        labelIds: labelIds.length > 0 ? labelIds : undefined,
      },
      undefined,
      { authorName: retryAuthorName },
    );

    const finalTitle = await reconcileEmojiOnCreate(issue);

    await supabaseAdmin
      .from("form_submissions")
      .update({
        sync_status: "synced",
        linear_issue_id: issue.id,
        linear_issue_identifier: issue.identifier,
        derived_title: finalTitle,
        sync_error: null,
        sync_attempted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", submissionId);

    void logSyncEvent({
      eventType: "FormSubmission",
      action: "retry",
      entityId: submissionId,
      teamId,
      status: "success",
      processingTimeMs: Date.now() - syncStart,
      payloadSummary: {
        title: submission.derived_title,
        formName: form.name,
        formId: submission.form_id,
        hubId: submission.hub_id,
        issueIdentifier: issue.identifier,
      },
    });

    return {
      submissionId,
      syncStatus: "synced",
      linearIssueIdentifier: issue.identifier,
      confirmationMessage,
    };
  } catch (err) {
    const syncError =
      err instanceof Error ? err.message : "Unknown error creating issue";

    await supabaseAdmin
      .from("form_submissions")
      .update({
        sync_status: "failed",
        sync_error: syncError,
        sync_attempted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", submissionId);

    void logSyncEvent({
      eventType: "FormSubmission",
      action: "retry",
      entityId: submissionId,
      teamId,
      status: "error",
      errorMessage: syncError,
      processingTimeMs: Date.now() - syncStart,
      payloadSummary: {
        title: submission.derived_title,
        formName: form.name,
        formId: submission.form_id,
        hubId: submission.hub_id,
      },
    });

    return {
      submissionId,
      syncStatus: "failed",
      confirmationMessage,
      errorMessage: form.error_message,
    };
  }
}
