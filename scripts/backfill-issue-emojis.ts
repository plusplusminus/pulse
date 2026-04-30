// Backfill: walk all synced_issues, compute the correct emoji prefix per the
// classifier in src/lib/issue-emoji.ts, and update the title in Linear when
// it differs. Pass --apply to actually call Linear; default is dry-run.
//
// Usage:
//   node scripts/backfill-issue-emojis.mjs           # dry-run
//   node scripts/backfill-issue-emojis.mjs --apply   # update Linear titles

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import {
  classifyIssueEmoji,
  applyEmojiToTitle,
} from "../src/lib/issue-emoji.ts";
import { getWorkspaceToken } from "../src/lib/workspace.ts";

const APPLY = process.argv.includes("--apply");
const LINEAR_API = "https://api.linear.app/graphql";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let cachedToken: string | null = null;
async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  cachedToken = await getWorkspaceToken();
  return cachedToken;
}

function authHeader(token: string): string {
  return token.startsWith("lin_api_") ? token : `Bearer ${token}`;
}

async function updateIssueTitle(issueId: string, title: string): Promise<void> {
  const token = await getToken();
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(token),
    },
    body: JSON.stringify({
      query: `mutation($id: String!, $title: String!) {
        issueUpdate(id: $id, input: { title: $title }) { success }
      }`,
      variables: { id: issueId, title },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    data?: { issueUpdate?: { success: boolean } };
    errors?: Array<{ message: string }>;
  };
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join(", "));
  if (!json.data?.issueUpdate?.success) throw new Error("issueUpdate not successful");
}

// -- Main ---------------------------------------------------------------------

async function main() {
  const PAGE = 1000;
  let from = 0;
  let scanned = 0;
  let drift = 0;
  let applied = 0;
  let errors = 0;
  const driftSamples: Array<{
    id: string;
    from: string;
    to: string;
    labels: string;
    priority: number | undefined;
  }> = [];

  console.log(
    `Mode: ${APPLY ? "APPLY (will mutate Linear titles)" : "DRY-RUN"}\n`
  );

  while (true) {
    const { data, error } = await sb
      .from("synced_issues")
      .select("linear_id, identifier, data")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(error);
      process.exit(1);
    }
    if (!data?.length) break;

    for (const row of data) {
      scanned++;
      const d = row.data ?? {};
      const title = d.title;
      if (typeof title !== "string") continue;

      const expected = classifyIssueEmoji(d.labels, d.priority);
      const expectedTitle = applyEmojiToTitle(title, expected);
      if (expectedTitle === title) continue;

      drift++;
      if (driftSamples.length < 20) {
        driftSamples.push({
          id: row.identifier,
          from: title.slice(0, 70),
          to: expectedTitle.slice(0, 70),
          labels: (d.labels ?? [])
            .map((l: { name?: string }) => l.name)
            .join(", "),
          priority: d.priority,
        });
      }

      if (APPLY) {
        try {
          await updateIssueTitle(row.linear_id, expectedTitle);
          applied++;
          await new Promise((r) => setTimeout(r, 120));
        } catch (err) {
          errors++;
          console.error(
            `  ✗ ${row.identifier}: ${(err as Error).message}`
          );
        }
      }
    }

    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`\nScanned:     ${scanned}`);
  console.log(`Drift:       ${drift}`);
  if (APPLY) {
    console.log(`Applied:     ${applied}`);
    console.log(`Errors:      ${errors}`);
  }

  if (driftSamples.length) {
    console.log(`\nFirst ${driftSamples.length} drifted titles:`);
    for (const s of driftSamples) {
      console.log(
        `  ${s.id}  pri=${s.priority}  [${s.labels}]\n    from: ${s.from}\n    to:   ${s.to}`
      );
    }
  }
}

main();
