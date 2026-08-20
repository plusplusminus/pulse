# PostHog Setup Guide

Step-by-step guide to configure PostHog for Pulse analytics.

## 1. Create the Project

- Go to [app.posthog.com](https://app.posthog.com) and create a new project
- Name it **Pulse**
- Select **US** region (matches the `https://us.i.posthog.com` host)
- Copy the **Project API Key** and set it as `NEXT_PUBLIC_POSTHOG_KEY` in your Vercel environment variables

## 2. Configure Group Analytics (Required)

**You must complete this step before hub-level breakdowns will work.** Without it, `hub` won't appear as a breakdown option in insights — you'll only see `hubId` as a plain event property.

Group analytics lets you see usage **per hub** instead of just per user. Retroactive grouping doesn't work, so configure this before events start flowing.

1. Navigate to **Settings > Project > Group analytics**
2. Add a new group type:
   - **Group type index:** `0`
   - **Type name:** `hub`
   - **Display name:** `Hub`
3. Save

This maps to the `posthog.group('hub', slug)` calls in the codebase. Once configured, you can break down any insight by `hub` group.

## 3. Define Person Properties

These will auto-populate from the app's `identify()` calls, but adding display names makes them easier to find.

- Navigate to **Data Management > Person properties**

| Property | Display Name | Type |
|----------|-------------|------|
| `email` | Email | String |
| `firstName` | First Name | String |
| `lastName` | Last Name | String |
| `userType` | User Type | String |

## 4. Create Cohorts

Cohorts allow you to filter any dashboard, insight, or replay by user type.

- Navigate to **People > Cohorts > New cohort**

**PPM Admins:**
- Match persons where `userType` equals `admin`

**Client Users:**
- Match persons where `userType` equals `client`

## 5. Session Replay Settings

- Navigate to **Settings > Project > Session replay**

| Setting | Recommended Value | Notes |
|---------|------------------|-------|
| Recording rate | 100% | Low-volume app, adjust down later if costs increase |
| Minimum duration | 2 seconds | Filters out bounces |
| Network recording | Enabled | Helps debug API issues |
| Console log recording | Disabled | Already off in code config |

Input masking is handled in the codebase — all inputs are masked by default.

### Create Replay Playlists

Navigate to **Session Replay > Playlists** and create these saved views:

| Playlist | Filter |
|----------|--------|
| Client Sessions | `userType` = `client` |
| Admin Sessions | `userType` = `admin` |
| Form Submissions | Has event `form_submitted` |
| Error Sessions | Has event `$exception` |

## 6. Build Dashboards

### Product Overview Dashboard

Create a new dashboard at **Dashboards > New dashboard** named "Product Overview" with these insights:

| Insight | Type | Configuration |
|---------|------|---------------|
| Daily Active Users | Trends | `$pageview` > unique users > last 30 days |
| Active Hubs | Trends | `$pageview` > unique `hub` groups > last 30 days |
| Admin vs Client Split | Trends | `$pageview` > unique users > breakdown by `userType` |
| Top Pages | Trends | `$pageview` > total count > breakdown by `$current_url` |
| Feature Usage | Trends | Multiple series: `form_submitted`, `comment_created`, `vote_cast`, `ranking_updated`, `issue_viewed` > total count |

### Client Engagement Dashboard

| Insight | Type | Configuration |
|---------|------|---------------|
| Forms Submitted | Trends | `form_submitted` > total > last 30 days |
| Comments Created | Trends | `comment_created` > total > last 30 days |
| Issues Viewed | Trends | `issue_viewed` > unique users > last 30 days |
| Votes Cast | Trends | `vote_cast` > total > last 30 days |
| Rankings Updated | Trends | `ranking_updated` > total > last 30 days |
| Hub Activity Ranking | Trends | `$pageview` > unique users > breakdown by `hub` group |
| Notification Engagement | Funnel | `notification_clicked` > any action within 5 min |

### Admin Operations Dashboard

| Insight | Type | Configuration |
|---------|------|---------------|
| Syncs Triggered | Trends | `sync_triggered` > total > last 30 days |
| Members Invited | Trends | `member_invited` > total, sum of `emailCount` |
| Webhooks Received | Trends | `webhook_received` > total > breakdown by `type` |
| Digests Sent | Trends | `digest_sent` > total, sum of `recipientCount` |
| Form Builder Saves | Trends | `form_builder_saved` > total |

## 7. Create Actions

Actions group related events for cleaner dashboard building.

- Navigate to **Data Management > Actions**

| Action | Events Included |
|--------|----------------|
| Client Engagement | `comment_created`, `form_submitted`, `vote_cast`, `ranking_updated` |
| Admin Management | `hub_settings_updated`, `member_invited`, `sync_triggered` |
| Content Viewed | `issue_viewed`, `project_viewed`, `roadmap_viewed` |

## 8. Create Funnels

### Client Onboarding Funnel

Tracks how new client users progress from first visit to active participation:

1. `$pageview` (first visit)
2. `tab_switched` (exploring the hub)
3. `issue_viewed` (engaging with content)
4. `comment_created` or `form_submitted` (active participation)

### Admin Setup Funnel

Tracks whether admins complete the full hub setup:

1. `hub_settings_updated`
2. `member_invited`
3. `sync_triggered`
4. `form_builder_saved`

## 9. Data Cleanup

After a few days of data flowing in:

- Navigate to **Data Management > Events**
- Add descriptions to your custom events so the team understands them
- Hide noisy auto-captured events you don't use (e.g. generic `$autocapture` clicks)
- Consider disabling `$autocapture` entirely if the custom events provide sufficient coverage

## Event Reference

All custom events tracked by the application:

| Event | Source | Description |
|-------|--------|-------------|
| `form_submitted` | Client | Form submitted in hub (request or modal) |
| `comment_created` | Client | Comment posted on an issue |
| `issue_viewed` | Client | Issue detail panel opened |
| `project_viewed` | Client | Project overview loaded |
| `roadmap_viewed` | Client | Roadmap page loaded |
| `notification_clicked` | Client | Notification item clicked |
| `notification_preferences_updated` | Client | Notification preferences saved |
| `vote_cast` | Client | Vote button clicked |
| `ranking_viewed` | Client | Priority ranking tab opened |
| `ranking_updated` | Client | Project ranking saved after drag |
| `tab_switched` | Client | Hub or team tab changed |
| `hub_settings_updated` | Client | Hub settings form saved |
| `hub_created` | Client | New hub created via wizard |
| `member_invited` | Client | Member invitation sent |
| `sync_triggered` | Client | Manual sync button clicked |
| `admin_added` | Client | PPM admin added |
| `admin_removed` | Client | PPM admin removed |
| `form_builder_saved` | Client | Form builder saved |
| `workflow_rule_changed` | Client | Workflow rule created or updated |
| `webhook_received` | Server | Linear webhook processed |
| `form_submission_created` | Server | Form submission saved via API |
| `issue_created_via_api` | Server | Issue created in Linear via API |
| `sync_completed` | Server | Hub sync finished |
| `digest_sent` | Server | Email digest batch sent |
| `email_queue_processed` | Server | Email retry queue processed |
