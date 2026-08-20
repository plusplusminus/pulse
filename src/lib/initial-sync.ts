import { supabaseAdmin, type HubTeamMapping } from "./supabase";
import { getWorkspaceToken } from "./workspace";
import { LinearRateLimiter } from "./linear-rate-limiter";

const LINEAR_API = "https://api.linear.app/graphql";
const PAGE_SIZE = 20;

// -- GraphQL queries ---------------------------------------------------------

function buildIssuesQuery(since?: Date) {
  const updatedAtFilter = since
    ? `, updatedAt: { gt: "${since.toISOString()}" }`
    : "";
  return `
  query TeamIssues($teamId: ID!, $after: String) {
    issues(
      filter: { team: { id: { eq: $teamId } }${updatedAtFilter} }
      first: ${PAGE_SIZE}
      after: $after
      orderBy: updatedAt
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        identifier
        title
        description
        priority
        priorityLabel
        url
        dueDate
        state { id name color type }
        assignee { id name }
        labels { nodes { id name color } }
        team { id name key }
        project { id name }
        cycle { id name number }
        createdAt
        updatedAt
      }
    }
  }
`;
}

const COMMENTS_QUERY = `
  query IssueComments($issueId: ID!, $after: String) {
    comments(
      filter: { issue: { id: { eq: $issueId } } }
      first: ${PAGE_SIZE}
      after: $after
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        body
        user { id name }
        issue { id }
        createdAt
        updatedAt
      }
    }
  }
`;

const TEAMS_QUERY = `
  query ViewerTeams($after: String) {
    teams(
      first: ${PAGE_SIZE}
      after: $after
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        displayName
        key
        description
        icon
        color
        private
        parent { id name key }
        children { id }
        members { nodes { id name } }
        createdAt
        updatedAt
      }
    }
  }
`;

function buildProjectsQuery(since?: Date) {
  const updatedAtFilter = since
    ? `, updatedAt: { gt: "${since.toISOString()}" }`
    : "";
  return `
  query TeamProjects($teamId: ID!, $after: String) {
    projects(
      filter: { accessibleTeams: { id: { eq: $teamId } }${updatedAtFilter} }
      first: ${PAGE_SIZE}
      after: $after
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        description
        content
        icon
        color
        url
        priority
        priorityLabel
        progress
        health
        startDate
        targetDate
        status { id name color type }
        lead { id name }
        labels { nodes { id name color } }
        teams { nodes { id name key } }
        initiatives { nodes { id name } }
        projectMilestones { nodes { id name targetDate } }
        externalLinks { nodes { id label url createdAt } }
        documents { nodes { id title content slugId icon color updatedAt } }
        createdAt
        updatedAt
      }
    }
  }
`;
}

function buildProjectUpdatesQuery() {
  // first: 50 is an intentional cap, not unpaginated truncation: health updates
  // are infrequent (~weekly), so the newest 50 cover a long history. New updates
  // arrive via the ProjectUpdate webhook; older ones can be re-surfaced by
  // editing them in Linear (which fires a webhook), so backfill depth is not
  // load-bearing for client visibility.
  return `
  query ProjectUpdates($projectId: String!) {
    project(id: $projectId) {
      projectUpdates(first: 50) {
        nodes {
          id
          body
          health
          createdAt
          updatedAt
          editedAt
          user { id name }
        }
      }
    }
  }
`;
}

function buildInitiativesQuery(since?: Date) {
  const filter = since
    ? `\n      filter: { updatedAt: { gt: "${since.toISOString()}" } }`
    : "";
  return `
  query ViewerInitiatives($after: String) {
    initiatives(${filter}
      first: ${PAGE_SIZE}
      after: $after
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        description
        icon
        color
        url
        status
        health
        healthUpdatedAt
        targetDate
        owner { id name }
        projects { nodes { id name } }
        subInitiatives { nodes { id name } }
        parentInitiative { id name }
        createdAt
        updatedAt
      }
    }
  }
`;
}

function buildCyclesQuery(since?: Date) {
  const updatedAtFilter = since
    ? `, updatedAt: { gt: "${since.toISOString()}" }`
    : "";
  return `
  query TeamCycles($teamId: ID!, $after: String) {
    cycles(
      filter: { team: { id: { eq: $teamId } }${updatedAtFilter} }
      first: ${PAGE_SIZE}
      after: $after
      orderBy: createdAt
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        number
        description
        startsAt
        endsAt
        completedAt
        progress
        completedIssueCountHistory
        issueCountHistory
        completedScopeHistory
        scopeHistory
        links { nodes { id label url createdAt } }
        documents { nodes { id title content slugId icon color updatedAt } }
        team { id name key }
        createdAt
        updatedAt
      }
    }
  }
`;
}

// -- Types -------------------------------------------------------------------

type LinearGqlIssue = {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority: number;
  priorityLabel?: string;
  url: string;
  dueDate?: string;
  state?: { id: string; name: string; color: string; type: string };
  assignee?: { id: string; name: string };
  labels: { nodes: Array<{ id: string; name: string; color: string }> };
  team?: { id: string; name: string; key: string };
  project?: { id: string; name: string };
  cycle?: { id: string; name: string; number: number };
  createdAt: string;
  updatedAt: string;
};

type LinearGqlComment = {
  id: string;
  body?: string;
  user?: { id: string; name: string };
  issue?: { id: string };
  createdAt: string;
  updatedAt: string;
};

type LinearGqlTeam = {
  id: string;
  name: string;
  displayName?: string;
  key: string;
  description?: string;
  icon?: string;
  color?: string;
  private?: boolean;
  parent?: { id: string; name: string; key: string };
  children: Array<{ id: string }>;
  members: { nodes: Array<{ id: string; name: string }> };
  createdAt: string;
  updatedAt: string;
};

type LinearGqlProject = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  url?: string;
  priority: number;
  priorityLabel?: string;
  progress?: number;
  health?: string;
  startDate?: string;
  targetDate?: string;
  status?: { id: string; name: string; color: string; type: string };
  lead?: { id: string; name: string };
  labels: { nodes: Array<{ id: string; name: string; color: string }> };
  teams: { nodes: Array<{ id: string; name: string; key: string }> };
  initiatives: { nodes: Array<{ id: string; name: string }> };
  projectMilestones: { nodes: Array<{ id: string; name: string; targetDate?: string }> };
  externalLinks: { nodes: Array<{ id: string; label: string; url: string; createdAt: string }> };
  documents: { nodes: Array<{ id: string; title: string; content?: string; slugId: string; icon?: string; color?: string; updatedAt: string }> };
  createdAt: string;
  updatedAt: string;
};

type LinearGqlProjectUpdate = {
  id: string;
  body?: string;
  health?: string;
  createdAt: string;
  updatedAt?: string;
  editedAt?: string;
  user?: { id: string; name: string };
};

type LinearGqlInitiative = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  url?: string;
  status?: string;
  health?: string;
  healthUpdatedAt?: string;
  targetDate?: string;
  owner?: { id: string; name: string };
  projects: { nodes: Array<{ id: string; name: string }> };
  subInitiatives: { nodes: Array<{ id: string; name: string }> };
  parentInitiative?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
};

type LinearGqlCycle = {
  id: string;
  name?: string;
  number: number;
  description?: string;
  startsAt: string;
  endsAt: string;
  completedAt?: string;
  progress?: number;
  completedIssueCountHistory: number[];
  issueCountHistory: number[];
  completedScopeHistory: number[];
  scopeHistory: number[];
  links: { nodes: Array<{ id: string; label: string; url: string; createdAt: string }> };
  documents: { nodes: Array<{ id: string; title: string; content?: string; slugId: string; icon?: string; color?: string; updatedAt: string }> };
  team: { id: string; name: string; key: string };
  createdAt: string;
  updatedAt: string;
};

type PageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

// -- Helpers -----------------------------------------------------------------

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const PAGE_DELAY_MS = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function linearRequest<T>(
  apiToken: string,
  query: string,
  variables: Record<string, unknown>,
  rateLimiter?: LinearRateLimiter
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAY_MS * attempt);
    }

    const res = await fetch(LINEAR_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiToken.trim(),
      },
      body: JSON.stringify({ query, variables }),
    });

    // Always track rate limit headers when a limiter is provided
    if (rateLimiter) {
      rateLimiter.updateFromResponse(res);
    }

    if (res.status === 429) {
      // Rate limited — retry with backoff using reset header or exponential delay
      const waitMs = rateLimiter?.getWaitTime() || RETRY_DELAY_MS * Math.pow(2, attempt);
      const cappedWaitMs = Math.min(waitMs, 30_000); // Cap at 30s to avoid Vercel timeout
      console.warn(`[rate-limit] Linear API 429 — waiting ${cappedWaitMs}ms before retry (attempt ${attempt + 1}/${MAX_RETRIES})`);
      lastError = new Error(`Linear API 429: rate limited (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(cappedWaitMs);
      continue;
    }

    if (res.status >= 500) {
      lastError = new Error(`Linear API ${res.status} (attempt ${attempt + 1}/${MAX_RETRIES})`);
      console.warn(lastError.message);
      continue;
    }

    if (!res.ok) {
      throw new Error(`Linear API ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as {
      data?: T;
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
    };

    if (json.errors) {
      // GraphQL RATELIMITED — retry with backoff (same as HTTP 429)
      const isRateLimited = json.errors.some((e) => e.extensions?.code === "RATELIMITED");
      if (isRateLimited && attempt < MAX_RETRIES - 1) {
        const waitMs = rateLimiter?.getWaitTime() || RETRY_DELAY_MS * Math.pow(2, attempt);
        const cappedWaitMs = Math.min(waitMs, 30_000);
        console.warn(`[rate-limit] GraphQL RATELIMITED — waiting ${cappedWaitMs}ms before retry (attempt ${attempt + 1}/${MAX_RETRIES})`);
        lastError = new Error(`GraphQL RATELIMITED (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(cappedWaitMs);
        continue;
      }
      throw new Error(`GraphQL: ${json.errors.map((e) => e.message).join(", ")}`);
    }

    if (!json.data) {
      throw new Error("No data returned from Linear API");
    }

    return json.data;
  }

  throw lastError ?? new Error("Linear API request failed after retries");
}

// -- Core sync logic ---------------------------------------------------------

export async function fetchAllIssues(
  apiToken: string,
  teamId: string,
  rateLimiter?: LinearRateLimiter,
  since?: Date
): Promise<LinearGqlIssue[]> {
  const allIssues: LinearGqlIssue[] = [];
  let cursor: string | undefined;
  let hasMore = true;
  const query = buildIssuesQuery(since);

  while (hasMore) {
    if (rateLimiter && !rateLimiter.canProceed()) {
      console.warn(`[rate-limit] fetchAllIssues stopping early — ${allIssues.length} issues fetched so far`, rateLimiter.getStatus());
      break;
    }

    const data = await linearRequest<{
      issues: { pageInfo: PageInfo; nodes: LinearGqlIssue[] };
    }>(apiToken, query, { teamId, after: cursor }, rateLimiter);

    allIssues.push(...data.issues.nodes);
    hasMore = data.issues.pageInfo.hasNextPage;
    cursor = data.issues.pageInfo.endCursor ?? undefined;
    if (hasMore) await sleep(PAGE_DELAY_MS);
  }

  return allIssues;
}

export async function fetchCommentsForIssue(
  apiToken: string,
  issueId: string,
  rateLimiter?: LinearRateLimiter
): Promise<LinearGqlComment[]> {
  const allComments: LinearGqlComment[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    if (rateLimiter && !rateLimiter.canProceed()) {
      console.warn(`[rate-limit] fetchCommentsForIssue stopping early — ${allComments.length} comments fetched so far`, rateLimiter.getStatus());
      break;
    }

    const data = await linearRequest<{
      comments: { pageInfo: PageInfo; nodes: LinearGqlComment[] };
    }>(apiToken, COMMENTS_QUERY, { issueId, after: cursor }, rateLimiter);

    allComments.push(...data.comments.nodes);
    hasMore = data.comments.pageInfo.hasNextPage;
    cursor = data.comments.pageInfo.endCursor ?? undefined;
    if (hasMore) await sleep(PAGE_DELAY_MS);
  }

  return allComments;
}

export async function fetchAllTeams(
  apiToken: string,
  rateLimiter?: LinearRateLimiter
): Promise<LinearGqlTeam[]> {
  const all: LinearGqlTeam[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    if (rateLimiter && !rateLimiter.canProceed()) {
      console.warn(`[rate-limit] fetchAllTeams stopping early — ${all.length} teams fetched so far`, rateLimiter.getStatus());
      break;
    }

    const data = await linearRequest<{
      teams: { pageInfo: PageInfo; nodes: LinearGqlTeam[] };
    }>(apiToken, TEAMS_QUERY, { after: cursor }, rateLimiter);

    all.push(...data.teams.nodes);
    hasMore = data.teams.pageInfo.hasNextPage;
    cursor = data.teams.pageInfo.endCursor ?? undefined;
    if (hasMore) await sleep(PAGE_DELAY_MS);
  }

  return all;
}

export async function fetchAllProjects(
  apiToken: string,
  teamId: string,
  rateLimiter?: LinearRateLimiter,
  since?: Date
): Promise<LinearGqlProject[]> {
  const all: LinearGqlProject[] = [];
  let cursor: string | undefined;
  let hasMore = true;
  const query = buildProjectsQuery(since);

  while (hasMore) {
    if (rateLimiter && !rateLimiter.canProceed()) {
      console.warn(`[rate-limit] fetchAllProjects stopping early — ${all.length} projects fetched so far`, rateLimiter.getStatus());
      break;
    }

    const data = await linearRequest<{
      projects: { pageInfo: PageInfo; nodes: LinearGqlProject[] };
    }>(apiToken, query, { teamId, after: cursor }, rateLimiter);

    all.push(...data.projects.nodes);
    hasMore = data.projects.pageInfo.hasNextPage;
    cursor = data.projects.pageInfo.endCursor ?? undefined;
    if (hasMore) await sleep(PAGE_DELAY_MS);
  }

  return all;
}

/**
 * Fetch a project's health updates (ProjectUpdate). Newest 50 — updates are
 * infrequent, so no pagination. Every update is fetched; client-facing
 * filtering happens at read time (hub-read.ts).
 */
export async function fetchProjectUpdatesForProject(
  apiToken: string,
  projectId: string,
  rateLimiter?: LinearRateLimiter
): Promise<LinearGqlProjectUpdate[]> {
  const data = await linearRequest<{
    project: { projectUpdates: { nodes: LinearGqlProjectUpdate[] } } | null;
  }>(apiToken, buildProjectUpdatesQuery(), { projectId }, rateLimiter);
  return data.project?.projectUpdates?.nodes ?? [];
}

export async function fetchAllInitiatives(
  apiToken: string,
  rateLimiter?: LinearRateLimiter,
  since?: Date
): Promise<LinearGqlInitiative[]> {
  const all: LinearGqlInitiative[] = [];
  let cursor: string | undefined;
  let hasMore = true;
  const query = buildInitiativesQuery(since);

  while (hasMore) {
    if (rateLimiter && !rateLimiter.canProceed()) {
      console.warn(`[rate-limit] fetchAllInitiatives stopping early — ${all.length} initiatives fetched so far`, rateLimiter.getStatus());
      break;
    }

    const data = await linearRequest<{
      initiatives: { pageInfo: PageInfo; nodes: LinearGqlInitiative[] };
    }>(apiToken, query, { after: cursor }, rateLimiter);

    all.push(...data.initiatives.nodes);
    hasMore = data.initiatives.pageInfo.hasNextPage;
    cursor = data.initiatives.pageInfo.endCursor ?? undefined;
    if (hasMore) await sleep(PAGE_DELAY_MS);
  }

  return all;
}

export async function fetchAllCycles(
  apiToken: string,
  teamId: string,
  rateLimiter?: LinearRateLimiter,
  since?: Date
): Promise<LinearGqlCycle[]> {
  const all: LinearGqlCycle[] = [];
  let cursor: string | undefined;
  let hasMore = true;
  const query = buildCyclesQuery(since);

  while (hasMore) {
    if (rateLimiter && !rateLimiter.canProceed()) {
      console.warn(`[rate-limit] fetchAllCycles stopping early — ${all.length} cycles fetched so far`, rateLimiter.getStatus());
      break;
    }

    const data = await linearRequest<{
      cycles: { pageInfo: PageInfo; nodes: LinearGqlCycle[] };
    }>(apiToken, query, { teamId, after: cursor }, rateLimiter);

    all.push(...data.cycles.nodes);
    hasMore = data.cycles.pageInfo.hasNextPage;
    cursor = data.cycles.pageInfo.endCursor ?? undefined;
    if (hasMore) await sleep(PAGE_DELAY_MS);
  }

  return all;
}

// -- Diff-check: lightweight checksum fetches --------------------------------

export type EntityChecksum = { id: string; updatedAt: string };

const CHECKSUM_PAGE_SIZE = 250;

/**
 * Fetch only id + updatedAt for all issues in a team (paginated).
 * Much lighter than full entity fetches — used for diff-check reconciliation.
 */
export async function fetchIssueChecksums(
  teamId: string,
  accessToken: string,
  rateLimiter?: LinearRateLimiter
): Promise<EntityChecksum[]> {
  const query = `
    query IssueChecksums($teamId: ID!, $after: String) {
      issues(
        filter: { team: { id: { eq: $teamId } } }
        first: ${CHECKSUM_PAGE_SIZE}
        after: $after
        orderBy: updatedAt
      ) {
        pageInfo { hasNextPage endCursor }
        nodes { id updatedAt }
      }
    }
  `;
  return fetchChecksumPages<{ issues: { pageInfo: PageInfo; nodes: EntityChecksum[] } }>(
    accessToken, query, { teamId }, "issues", rateLimiter
  );
}

/**
 * Fetch only id + updatedAt for all projects accessible to a team (paginated).
 */
export async function fetchProjectChecksums(
  teamId: string,
  accessToken: string,
  rateLimiter?: LinearRateLimiter
): Promise<EntityChecksum[]> {
  const query = `
    query ProjectChecksums($teamId: ID!, $after: String) {
      projects(
        filter: { accessibleTeams: { id: { eq: $teamId } } }
        first: ${CHECKSUM_PAGE_SIZE}
        after: $after
      ) {
        pageInfo { hasNextPage endCursor }
        nodes { id updatedAt }
      }
    }
  `;
  return fetchChecksumPages<{ projects: { pageInfo: PageInfo; nodes: EntityChecksum[] } }>(
    accessToken, query, { teamId }, "projects", rateLimiter
  );
}

/**
 * Fetch only id + updatedAt for all cycles in a team (paginated).
 */
export async function fetchCycleChecksums(
  teamId: string,
  accessToken: string,
  rateLimiter?: LinearRateLimiter
): Promise<EntityChecksum[]> {
  const query = `
    query CycleChecksums($teamId: ID!, $after: String) {
      cycles(
        filter: { team: { id: { eq: $teamId } } }
        first: ${CHECKSUM_PAGE_SIZE}
        after: $after
        orderBy: createdAt
      ) {
        pageInfo { hasNextPage endCursor }
        nodes { id updatedAt }
      }
    }
  `;
  return fetchChecksumPages<{ cycles: { pageInfo: PageInfo; nodes: EntityChecksum[] } }>(
    accessToken, query, { teamId }, "cycles", rateLimiter
  );
}

/**
 * Fetch only id + updatedAt for all initiatives (org-level, paginated).
 */
export async function fetchInitiativeChecksums(
  accessToken: string,
  rateLimiter?: LinearRateLimiter
): Promise<EntityChecksum[]> {
  const query = `
    query InitiativeChecksums($after: String) {
      initiatives(
        first: ${CHECKSUM_PAGE_SIZE}
        after: $after
      ) {
        pageInfo { hasNextPage endCursor }
        nodes { id updatedAt }
      }
    }
  `;
  return fetchChecksumPages<{ initiatives: { pageInfo: PageInfo; nodes: EntityChecksum[] } }>(
    accessToken, query, {}, "initiatives", rateLimiter
  );
}

/** Generic paginator for checksum queries. */
async function fetchChecksumPages<T extends Record<string, { pageInfo: PageInfo; nodes: EntityChecksum[] }>>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
  rootKey: string,
  rateLimiter?: LinearRateLimiter
): Promise<EntityChecksum[]> {
  const all: EntityChecksum[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    if (rateLimiter && !rateLimiter.canProceed()) {
      console.warn(`[rate-limit] fetchChecksums(${rootKey}) stopping early — ${all.length} fetched so far`, rateLimiter.getStatus());
      break;
    }

    const data = await linearRequest<T>(
      accessToken, query, { ...variables, after: cursor }, rateLimiter
    );

    const page = data[rootKey as keyof T] as { pageInfo: PageInfo; nodes: EntityChecksum[] };
    all.push(...page.nodes);
    hasMore = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor ?? undefined;
    if (hasMore) await sleep(PAGE_DELAY_MS);
  }

  return all;
}

// -- Diff-check: compare remote checksums against local DB -------------------

export type DiffResult = {
  stale: string[];
  missing: string[];
  deleted: string[];
};

/**
 * Compare remote entity checksums against locally synced data.
 *
 * - `stale`: remote updatedAt is newer than local synced_at
 * - `missing`: exists in remote but not in local DB
 * - `deleted`: exists in local DB (for this team) but not in remote
 *
 * For team-scoped entities, pass `teamId` to scope the local query.
 * For org-level entities (initiatives), pass `teamId = undefined`.
 */
export async function diffEntities(
  tableName: string,
  remoteChecksums: EntityChecksum[],
  teamId?: string
): Promise<DiffResult> {
  // Fetch local entities: id + updated_at (Linear's updatedAt) for direct comparison
  let query = supabaseAdmin
    .from(tableName)
    .select("linear_id, updated_at")
    .eq("user_id", "workspace");

  if (teamId) {
    query = query.eq("team_id", teamId);
  }

  const { data: localRows, error } = await query;

  if (error) {
    console.error(`diffEntities: failed to query ${tableName}:`, error);
    throw error;
  }

  // Build a map of local entities: linear_id -> updated_at (Linear's updatedAt)
  const localMap = new Map<string, string>();
  for (const row of localRows ?? []) {
    localMap.set(row.linear_id, row.updated_at);
  }

  // Build set of remote IDs for deletion detection
  const remoteIds = new Set<string>();

  const stale: string[] = [];
  const missing: string[] = [];

  for (const remote of remoteChecksums) {
    remoteIds.add(remote.id);
    const localUpdatedAt = localMap.get(remote.id);

    if (!localUpdatedAt) {
      // Not in local DB at all
      missing.push(remote.id);
    } else if (new Date(remote.updatedAt) > new Date(localUpdatedAt)) {
      // Remote updatedAt is newer than what we stored
      stale.push(remote.id);
    }
  }

  // Deleted: in local but not in remote
  const deleted: string[] = [];
  for (const localId of localMap.keys()) {
    if (!remoteIds.has(localId)) {
      deleted.push(localId);
    }
  }

  return { stale, missing, deleted };
}

// -- Batch-fetch-by-ID: fetch full entities for specific IDs -----------------

const BATCH_IDS_SIZE = 50;
/** Projects & initiatives have many nested relations, so Linear's query
 *  complexity limit (10 000) is hit well before 50 items. Use a smaller
 *  page size for these entity types. */
const COMPLEX_BATCH_SIZE = 15;

/**
 * Fetch full issue data for specific IDs using Linear's `nodes` query.
 * Batches in groups of 50 to avoid query size limits.
 */
export async function fetchIssuesByIds(
  ids: string[],
  accessToken: string,
  rateLimiter?: LinearRateLimiter
): Promise<LinearGqlIssue[]> {
  if (ids.length === 0) return [];

  const query = `
    query IssuesByIds($ids: [ID!]!, $after: String) {
      issues(filter: { id: { in: $ids } }, first: ${BATCH_IDS_SIZE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          identifier
          title
          description
          priority
          priorityLabel
          url
          dueDate
          state { id name color type }
          assignee { id name }
          labels { nodes { id name color } }
          team { id name key }
          project { id name }
          cycle { id name number }
          createdAt
          updatedAt
        }
      }
    }
  `;

  return batchFetchByIds<LinearGqlIssue>(ids, accessToken, query, "issues", rateLimiter);
}

/**
 * Fetch full project data for specific IDs using Linear's `projects` query with ID filter.
 */
export async function fetchProjectsByIds(
  ids: string[],
  accessToken: string,
  rateLimiter?: LinearRateLimiter
): Promise<LinearGqlProject[]> {
  if (ids.length === 0) return [];

  const query = `
    query ProjectsByIds($ids: [ID!]!, $after: String) {
      projects(filter: { id: { in: $ids } }, first: ${COMPLEX_BATCH_SIZE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          name
          description
          content
          icon
          color
          url
          priority
          priorityLabel
          progress
          health
          startDate
          targetDate
          status { id name color type }
          lead { id name }
          labels { nodes { id name color } }
          teams { nodes { id name key } }
          initiatives { nodes { id name } }
          projectMilestones { nodes { id name targetDate } }
          externalLinks { nodes { id label url createdAt } }
          documents { nodes { id title content slugId icon color updatedAt } }
          createdAt
          updatedAt
        }
      }
    }
  `;

  return batchFetchByIds<LinearGqlProject>(ids, accessToken, query, "projects", rateLimiter, COMPLEX_BATCH_SIZE);
}

/**
 * Fetch full cycle data for specific IDs using Linear's `cycles` query with ID filter.
 */
export async function fetchCyclesByIds(
  ids: string[],
  accessToken: string,
  rateLimiter?: LinearRateLimiter
): Promise<LinearGqlCycle[]> {
  if (ids.length === 0) return [];

  const query = `
    query CyclesByIds($ids: [ID!]!, $after: String) {
      cycles(filter: { id: { in: $ids } }, first: ${BATCH_IDS_SIZE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          name
          number
          description
          startsAt
          endsAt
          completedAt
          progress
          completedIssueCountHistory
          issueCountHistory
          completedScopeHistory
          scopeHistory
          links { nodes { id label url createdAt } }
          documents { nodes { id title content slugId icon color updatedAt } }
          team { id name key }
          createdAt
          updatedAt
        }
      }
    }
  `;

  return batchFetchByIds<LinearGqlCycle>(ids, accessToken, query, "cycles", rateLimiter);
}

/**
 * Fetch full initiative data for specific IDs using Linear's `initiatives` query with ID filter.
 */
export async function fetchInitiativesByIds(
  ids: string[],
  accessToken: string,
  rateLimiter?: LinearRateLimiter
): Promise<LinearGqlInitiative[]> {
  if (ids.length === 0) return [];

  const query = `
    query InitiativesByIds($ids: [ID!]!, $after: String) {
      initiatives(filter: { id: { in: $ids } }, first: ${COMPLEX_BATCH_SIZE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          name
          description
          icon
          color
          url
          status
          health
          healthUpdatedAt
          targetDate
          owner { id name }
          projects { nodes { id name } }
          subInitiatives { nodes { id name } }
          parentInitiative { id name }
          createdAt
          updatedAt
        }
      }
    }
  `;

  return batchFetchByIds<LinearGqlInitiative>(ids, accessToken, query, "initiatives", rateLimiter, COMPLEX_BATCH_SIZE);
}

/** Generic batch-fetch-by-ID using Linear's list queries with `id: { in: [...] }` filter.
 *  Batches IDs and paginates within each batch. */
async function batchFetchByIds<T extends { id: string }>(
  ids: string[],
  accessToken: string,
  query: string,
  rootField: string,
  rateLimiter?: LinearRateLimiter,
  batchSize: number = BATCH_IDS_SIZE
): Promise<T[]> {
  const all: T[] = [];

  for (let i = 0; i < ids.length; i += batchSize) {
    if (rateLimiter && !rateLimiter.canProceed()) {
      console.warn(`[rate-limit] batchFetchByIds stopping early — ${all.length}/${ids.length} fetched`, rateLimiter.getStatus());
      break;
    }

    const batch = ids.slice(i, i + batchSize);
    let after: string | null = null;

    // Paginate within this batch
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const resp = await linearRequest<{ [key: string]: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: T[] } }>(
        accessToken, query, { ids: batch, after }, rateLimiter
      );

      const connection = resp[rootField] as { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: T[] } | undefined;
      if (!connection) break;

      all.push(...connection.nodes);

      if (connection.pageInfo.hasNextPage && connection.pageInfo.endCursor) {
        after = connection.pageInfo.endCursor;
        await sleep(PAGE_DELAY_MS);
      } else {
        break;
      }
    }

    if (i + batchSize < ids.length) await sleep(PAGE_DELAY_MS);
  }

  return all;
}

// -- Upsert batching ---------------------------------------------------------

export function mapIssueToRow(issue: LinearGqlIssue, userId: string) {
  // Normalize labels from GraphQL { nodes: [...] } to flat array for the data blob
  const data = {
    ...issue,
    labels: issue.labels.nodes,
  };

  return {
    linear_id: issue.id,
    user_id: userId,
    identifier: issue.identifier,
    // Indexed columns for filtering/sorting
    state_name: issue.state?.name ?? null,
    priority: issue.priority,
    assignee_name: issue.assignee?.name ?? null,
    team_id: issue.team?.id ?? null,
    project_id: issue.project?.id ?? null,
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    synced_at: new Date().toISOString(),
    data, // Full payload for reads
  };
}

export function mapCommentToRow(
  comment: LinearGqlComment,
  issueLinearId: string,
  userId: string
) {
  return {
    linear_id: comment.id,
    user_id: userId,
    issue_linear_id: issueLinearId,
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
    synced_at: new Date().toISOString(),
    data: comment, // Full payload for reads
  };
}

export function mapTeamToRow(team: LinearGqlTeam, userId: string) {
  const data = {
    ...team,
    children: team.children,
    members: team.members.nodes,
  };

  return {
    linear_id: team.id,
    user_id: userId,
    name: team.name,
    key: team.key,
    parent_team_id: team.parent?.id ?? null,
    created_at: team.createdAt,
    updated_at: team.updatedAt,
    synced_at: new Date().toISOString(),
    data,
  };
}

export function mapProjectToRow(project: LinearGqlProject, userId: string) {
  const data = {
    ...project,
    labels: project.labels.nodes,
    teams: project.teams.nodes,
    initiatives: project.initiatives.nodes,
    milestones: project.projectMilestones.nodes,
    links: project.externalLinks.nodes,
    documents: project.documents.nodes,
  };

  return {
    linear_id: project.id,
    user_id: userId,
    name: project.name,
    status_name: project.status?.name ?? null,
    lead_name: project.lead?.name ?? null,
    priority: project.priority,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
    synced_at: new Date().toISOString(),
    data,
  };
}

export function mapProjectUpdateToRow(
  update: LinearGqlProjectUpdate,
  projectId: string,
  userId: string
) {
  return {
    linear_id: update.id,
    user_id: userId,
    project_id: projectId,
    health: update.health ?? null,
    created_at: update.createdAt,
    updated_at: update.updatedAt ?? update.createdAt,
    synced_at: new Date().toISOString(),
    // Mirror the webhook row shape: full update + nested project { id } so the
    // read layer can rely on data.body / data.health uniformly across sources.
    data: { ...update, project: { id: projectId } },
  };
}

export function mapInitiativeToRow(initiative: LinearGqlInitiative, userId: string) {
  const data = {
    ...initiative,
    projects: initiative.projects.nodes,
    subInitiatives: initiative.subInitiatives.nodes,
  };

  return {
    linear_id: initiative.id,
    user_id: userId,
    name: initiative.name,
    status: initiative.status ?? null,
    owner_name: initiative.owner?.name ?? null,
    created_at: initiative.createdAt,
    updated_at: initiative.updatedAt,
    synced_at: new Date().toISOString(),
    data,
  };
}

export function mapCycleToRow(cycle: LinearGqlCycle, userId: string) {
  const data = {
    ...cycle,
    links: cycle.links.nodes,
    documents: cycle.documents.nodes,
  };

  return {
    linear_id: cycle.id,
    user_id: userId,
    name: cycle.name ?? null,
    number: cycle.number,
    team_id: cycle.team.id,
    starts_at: cycle.startsAt,
    ends_at: cycle.endsAt,
    created_at: cycle.createdAt,
    updated_at: cycle.updatedAt,
    synced_at: new Date().toISOString(),
    data,
  };
}

// -- Public API --------------------------------------------------------------

export type SyncResult = {
  success: boolean;
  issueCount: number;
  commentCount: number;
  teamCount: number;
  projectCount: number;
  initiativeCount: number;
  cycleCount: number;
  error?: string;
};

/**
 * Batch upsert helper — upserts rows in chunks of BATCH_SIZE.
 */
export async function batchUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string
): Promise<void> {
  const BATCH_SIZE = 50;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabaseAdmin
      .from(table)
      .upsert(batch, { onConflict });

    if (error) {
      console.error(`${table} upsert batch error:`, error);
      throw error;
    }
  }
}

// -- Hub-scoped sync ---------------------------------------------------------

const WORKSPACE_USER_ID = "workspace";

export type HubTeamSyncResult = {
  teamId: string;
  teamName: string | null;
  issueCount: number;
  projectCount: number;
  commentCount: number;
  cycleCount: number;
};

export type HubSyncResult = {
  success: boolean;
  hubId: string;
  teamResults: HubTeamSyncResult[];
  teamCount: number;
  initiativeCount: number;
  error?: string;
};

/**
 * Run sync for a Client Hub: fetches data for all configured teams
 * and stores everything with user_id = 'workspace'.
 *
 * Does NOT filter by visible_project_ids — stores all data for the team.
 * Visibility filtering happens at read time (hub-read.ts).
 */
export async function runHubSync(
  hubId: string,
  teamMappings: HubTeamMapping[],
  rateLimiter?: LinearRateLimiter
): Promise<HubSyncResult> {
  const result: HubSyncResult = {
    success: false,
    hubId,
    teamResults: [],
    teamCount: 0,
    initiativeCount: 0,
  };

  try {
    const apiToken = await getWorkspaceToken();

    // 1. Teams — org-level, fetch once
    const teams = await fetchAllTeams(apiToken, rateLimiter);
    if (teams.length > 0) {
      await batchUpsert(
        "synced_teams",
        teams.map((t) => mapTeamToRow(t, WORKSPACE_USER_ID)),
        "user_id,linear_id"
      );
    }
    result.teamCount = teams.length;

    // 2. Initiatives — org-level, fetch once
    try {
      const initiatives = await fetchAllInitiatives(apiToken, rateLimiter);
      if (initiatives.length > 0) {
        await batchUpsert(
          "synced_initiatives",
          initiatives.map((i) => mapInitiativeToRow(i, WORKSPACE_USER_ID)),
          "user_id,linear_id"
        );
      }
      result.initiativeCount = initiatives.length;
    } catch (err) {
      console.warn("Initiative sync failed (may lack org scope):", err);
    }

    // 3. Per-team: projects, issues, comments
    for (const mapping of teamMappings) {
      // Check rate limit before starting a new team
      if (rateLimiter && !rateLimiter.canProceed()) {
        console.warn(`[rate-limit] runHubSync stopping team loop early — rate limit approaching`, rateLimiter.getStatus());
        break;
      }
      const teamResult: HubTeamSyncResult = {
        teamId: mapping.linear_team_id,
        teamName: mapping.linear_team_name,
        issueCount: 0,
        projectCount: 0,
        commentCount: 0,
        cycleCount: 0,
      };

      try {
        // Projects for this team
        const projects = await fetchAllProjects(apiToken, mapping.linear_team_id, rateLimiter);
        if (projects.length > 0) {
          await batchUpsert(
            "synced_projects",
            projects.map((p) => mapProjectToRow(p, WORKSPACE_USER_ID)),
            "user_id,linear_id"
          );
        }
        teamResult.projectCount = projects.length;

        // Project health updates for each project (synced unfiltered; the
        // pulse/heyclient body prefix is applied at read time)
        for (const project of projects) {
          if (rateLimiter && !rateLimiter.canProceed()) {
            console.warn(`[rate-limit] Skipping remaining project-update fetches — rate limit approaching`, rateLimiter.getStatus());
            break;
          }
          const updates = await fetchProjectUpdatesForProject(
            apiToken,
            project.id,
            rateLimiter
          );
          if (updates.length > 0) {
            await batchUpsert(
              "synced_project_updates",
              updates.map((u) =>
                mapProjectUpdateToRow(u, project.id, WORKSPACE_USER_ID)
              ),
              "user_id,linear_id"
            );
          }
        }

        // Cycles for this team
        const cycles = await fetchAllCycles(apiToken, mapping.linear_team_id, rateLimiter);
        if (cycles.length > 0) {
          await batchUpsert(
            "synced_cycles",
            cycles.map((c) => mapCycleToRow(c, WORKSPACE_USER_ID)),
            "user_id,linear_id"
          );
        }
        teamResult.cycleCount = cycles.length;

        // Issues for this team
        const issues = await fetchAllIssues(apiToken, mapping.linear_team_id, rateLimiter);
        if (issues.length > 0) {
          await batchUpsert(
            "synced_issues",
            issues.map((issue) => mapIssueToRow(issue, WORKSPACE_USER_ID)),
            "user_id,linear_id"
          );
        }
        teamResult.issueCount = issues.length;

        // Comments for each issue
        for (const issue of issues) {
          if (rateLimiter && !rateLimiter.canProceed()) {
            console.warn(`[rate-limit] Skipping remaining comment fetches — rate limit approaching`, rateLimiter.getStatus());
            break;
          }
          const comments = await fetchCommentsForIssue(apiToken, issue.id, rateLimiter);
          if (comments.length > 0) {
            const rows = comments.map((c) =>
              mapCommentToRow(c, issue.id, WORKSPACE_USER_ID)
            );
            const { error } = await supabaseAdmin
              .from("synced_comments")
              .upsert(rows, { onConflict: "user_id,linear_id" });

            if (error) {
              console.error(`Comment upsert error for issue ${issue.id}:`, error);
            } else {
              teamResult.commentCount += comments.length;
            }
          }
        }
      } catch (error) {
        console.error(
          `Hub sync failed for team ${mapping.linear_team_id}:`,
          error
        );
        // Continue with other teams — don't fail the whole hub sync
      }

      result.teamResults.push(teamResult);
    }

    result.success = true;
    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown hub sync error";
    console.error(`Hub sync failed for hub ${hubId}:`, message);
    return { ...result, error: message };
  }
}
