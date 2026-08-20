// PostHog event catalog — all custom events must be defined here
// Naming convention: noun_verb (e.g. form_submitted, comment_created)

export const POSTHOG_EVENTS = {
  // Hub — Forms & Submissions
  form_submitted: 'form_submitted',
  form_viewed: 'form_viewed',
  form_submission_created: 'form_submission_created',

  // Hub — Comments
  comment_created: 'comment_created',

  // Hub — Issues
  issue_viewed: 'issue_viewed',

  // Hub — Projects & Roadmap
  project_viewed: 'project_viewed',
  roadmap_viewed: 'roadmap_viewed',

  // Hub — Notifications
  notification_clicked: 'notification_clicked',
  notification_preferences_updated: 'notification_preferences_updated',

  // Hub — Voting
  vote_cast: 'vote_cast',

  // Hub — Priority Ranking (Projects)
  ranking_viewed: 'ranking_viewed',
  ranking_updated: 'ranking_updated',
  rice_score_updated: 'rice_score_updated',

  // Hub — Priority Ranking (Tasks)
  task_ranking_viewed: 'task_ranking_viewed',
  task_ranking_updated: 'task_ranking_updated',
  task_rice_score_updated: 'task_rice_score_updated',

  // Hub — Navigation
  tab_switched: 'tab_switched',

  // Admin — Hub Management
  hub_settings_updated: 'hub_settings_updated',
  hub_created: 'hub_created',

  // Admin — Members
  member_invited: 'member_invited',

  // Admin — Sync
  sync_triggered: 'sync_triggered',
  sync_completed: 'sync_completed',

  // Admin — Settings
  admin_added: 'admin_added',
  admin_removed: 'admin_removed',

  // Admin — Form Builder
  form_builder_saved: 'form_builder_saved',

  // Admin — Workflow
  workflow_rule_changed: 'workflow_rule_changed',

  // Server — Webhooks & Cron
  webhook_received: 'webhook_received',
  issue_created_via_api: 'issue_created_via_api',
  digest_sent: 'digest_sent',
  email_queue_processed: 'email_queue_processed',
} as const;

export type PostHogEvent = (typeof POSTHOG_EVENTS)[keyof typeof POSTHOG_EVENTS];
