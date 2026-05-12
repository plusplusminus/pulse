import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Anon client for client-side reads (RLS is off, queries filter by user_id)
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

// Service role client for API routes (server-side only)
export const supabaseAdmin = supabaseServiceKey
  ? createSupabaseClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : supabase

export type Profile = {
  id: string
  email: string
  linear_api_token?: string
  created_at: string
  updated_at: string
}


export type PublicView = {
  id: string
  user_id: string
  name: string
  slug: string
  project_id?: string
  team_id?: string
  project_name?: string
  team_name?: string
  view_title: string
  description?: string
  is_active: boolean
  show_assignees: boolean
  show_labels: boolean
  show_priorities: boolean
  show_descriptions: boolean
  allowed_statuses: string[]
  password_protected: boolean
  password_hash?: string
  expires_at?: string
  allow_issue_creation: boolean
  created_at: string
  updated_at: string
}

export type KanbanColumn = {
  key: string
  label: string
  state_types: string[]
}

export type Roadmap = {
  id: string
  user_id: string
  name: string
  slug: string
  title: string
  description?: string
  layout_type: 'kanban' | 'timeline'
  timeline_granularity: 'month' | 'quarter'
  kanban_columns: KanbanColumn[]
  project_ids: string[]
  show_item_descriptions: boolean
  show_item_dates: boolean
  show_progress_percentage: boolean
  show_vote_counts: boolean
  show_comment_counts: boolean
  allow_voting: boolean
  allow_comments: boolean
  require_email_for_comments: boolean
  moderate_comments: boolean
  is_active: boolean
  password_protected: boolean
  password_hash?: string
  expires_at?: string
  created_at: string
  updated_at: string
}

export type RoadmapVote = {
  id: string
  roadmap_id: string
  issue_id: string
  visitor_fingerprint: string
  ip_hash?: string
  created_at: string
}

export type RoadmapComment = {
  id: string
  roadmap_id: string
  issue_id: string
  author_name: string
  author_email: string
  author_email_verified: boolean
  content: string
  is_approved: boolean
  is_hidden: boolean
  parent_id?: string
  visitor_fingerprint?: string
  ip_hash?: string
  created_at: string
  updated_at: string
}

export type SyncedIssue = {
  id: string
  linear_id: string
  user_id: string
  identifier: string
  team_id?: string
  project_id?: string
  state_name?: string
  priority: number
  assignee_name?: string
  updated_at: string
  created_at: string
  synced_at: string
  data: Record<string, unknown>
}

export type SyncedComment = {
  id: string
  linear_id: string
  issue_linear_id: string
  user_id: string
  updated_at: string
  created_at: string
  synced_at: string
  data: Record<string, unknown>
}

export type SyncSubscription = {
  id: string
  user_id: string
  linear_team_id: string
  webhook_id?: string
  webhook_secret?: string
  events: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export type SyncedTeam = {
  id: string
  linear_id: string
  user_id: string
  name: string
  key?: string
  parent_team_id?: string
  updated_at: string
  created_at: string
  synced_at: string
  data: Record<string, unknown>
}

export type SyncedProject = {
  id: string
  linear_id: string
  user_id: string
  name: string
  status_name?: string
  lead_name?: string
  priority: number
  updated_at: string
  created_at: string
  synced_at: string
  data: Record<string, unknown>
}

export type SyncedInitiative = {
  id: string
  linear_id: string
  user_id: string
  name: string
  status?: string
  owner_name?: string
  updated_at: string
  created_at: string
  synced_at: string
  data: Record<string, unknown>
}

export type NotificationQueueItem = {
  id: string
  user_id: string
  event_type: string
  issue_linear_id?: string
  payload: Record<string, unknown>
  sent_at?: string
  created_at: string
}

// ============================================================
// Client Hub types (multi-tenant client portal)
// ============================================================

export type ClientHub = {
  id: string
  name: string
  slug: string
  is_active: boolean
  created_by: string
  workos_org_id: string | null
  created_at: string
  updated_at: string
}

export type HubTeamMapping = {
  id: string
  hub_id: string
  linear_team_id: string
  linear_team_name: string | null
  visible_project_ids: string[]
  visible_initiative_ids: string[]
  visible_label_ids: string[]
  hidden_label_ids: string[]
  auto_include_projects: boolean
  include_unassigned_issues: boolean
  overview_only_project_ids: string[]
  task_priority_project_ids: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Client roles: 'default' | 'view_only'. 'admin' is synthetic (PPM admins only, never stored). */
export type HubMemberRole = 'default' | 'view_only' | 'admin'

export type HubMember = {
  id: string
  hub_id: string
  user_id: string | null
  email: string | null
  role: HubMemberRole
  invited_by: string | null
  workos_invitation_id: string | null
  created_at: string
  updated_at: string
}

export type WorkspaceSetting = {
  id: string
  key: string
  value: string
  updated_by: string | null
  created_at: string
  updated_at: string
}

export type HubComment = {
  id: string
  hub_id: string
  issue_linear_id: string
  linear_comment_id: string | null
  parent_comment_id: string | null
  author_user_id: string
  author_name: string
  author_email: string | null
  body: string
  created_at: string
  updated_at: string
}

export type WorkflowTriggerType = 'label_added' | 'label_removed' | 'label_changed'
export type WorkflowActionType = 'set_status'

export type HubWorkflowRule = {
  id: string
  mapping_id: string
  trigger_type: WorkflowTriggerType
  trigger_label_id: string
  trigger_from_label_id: string | null
  condition_state_ids: string[] | null
  action_type: WorkflowActionType
  action_config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type HubWorkflowLog = {
  id: string
  hub_id: string
  issue_linear_id: string
  rule_id: string
  trigger_label_id: string
  action_type: string
  action_config: Record<string, unknown>
  result: 'success' | 'failure'
  error_message: string | null
  triggered_by: string
  created_at: string
}

// ============================================================
// Form system types
// ============================================================

export type FormTemplate = {
  id: string
  hub_id: string | null
  type: 'bug' | 'feature' | 'custom'
  name: string
  description: string | null
  is_active: boolean
  target_team_id: string | null
  target_project_id: string | null
  target_cycle_id: string | null
  target_label_ids: string[]
  target_priority: number | null
  button_label: string | null
  button_icon: string | null
  confirmation_message: string
  error_message: string
  display_order: number
  created_at: string
  updated_at: string
}

export type FormFieldType = 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'url'
export type LinearFieldMapping = 'title' | 'description' | 'priority' | 'label_ids' | 'project_id' | 'cycle_id'

export type FormField = {
  id: string
  form_id: string
  field_key: string
  field_type: FormFieldType
  label: string
  description: string | null
  placeholder: string | null
  is_required: boolean
  is_removable: boolean
  is_hidden: boolean
  linear_field: LinearFieldMapping | null
  options: Array<{ value: string; label: string }>
  default_value: string | null
  display_order: number
  created_at: string
  updated_at: string
}

export type HubFormConfig = {
  id: string
  hub_id: string
  form_id: string
  is_enabled: boolean
  target_team_id: string | null
  target_project_id: string | null
  target_cycle_id: string | null
  target_label_ids: string[] | null
  target_priority: number | null
  confirmation_message: string | null
  created_at: string
  updated_at: string
}

export type FormSubmission = {
  id: string
  form_id: string
  hub_id: string
  submitter_user_id: string
  submitter_email: string
  submitter_name: string | null
  field_values: Record<string, unknown>
  derived_title: string
  sync_status: 'pending' | 'synced' | 'failed'
  linear_issue_id: string | null
  linear_issue_identifier: string | null
  sync_error: string | null
  sync_attempted_at: string | null
  attachment_paths: string[]
  attachment_metadata: AttachmentMetadata[]
  created_at: string
  updated_at: string
}

export type AttachmentMetadata = {
  path: string
  fileName: string
  contentType: string
}

