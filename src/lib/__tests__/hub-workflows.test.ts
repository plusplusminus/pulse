import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildLabelChangeContext,
  evaluateWorkflowRules,
  executeWorkflowActions,
  type LabelChangeContext,
  type WorkflowAction,
} from "../hub-workflows";
import type { HubWorkflowRule } from "../supabase";

// -- Helpers ------------------------------------------------------------------

function makeRule(overrides: Partial<HubWorkflowRule> = {}): HubWorkflowRule {
  return {
    id: "rule-1",
    mapping_id: "mapping-1",
    trigger_type: "label_added",
    trigger_label_id: "label-a",
    trigger_from_label_id: null,
    condition_state_ids: null,
    action_type: "set_status",
    action_config: { stateId: "state-done" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// -- buildLabelChangeContext --------------------------------------------------

describe("buildLabelChangeContext", () => {
  it("correctly computes added labels", () => {
    const ctx = buildLabelChangeContext(["a"], ["a", "b", "c"]);
    expect(ctx.addedLabelIds).toEqual(["b", "c"]);
  });

  it("correctly computes removed labels", () => {
    const ctx = buildLabelChangeContext(["a", "b", "c"], ["a"]);
    expect(ctx.removedLabelIds).toEqual(["b", "c"]);
  });

  it("handles empty arrays", () => {
    const ctx = buildLabelChangeContext([], []);
    expect(ctx.addedLabelIds).toEqual([]);
    expect(ctx.removedLabelIds).toEqual([]);
    expect(ctx.previousLabelIds).toEqual([]);
    expect(ctx.newLabelIds).toEqual([]);
  });

  it("handles identical arrays (no changes)", () => {
    const ctx = buildLabelChangeContext(["x", "y"], ["x", "y"]);
    expect(ctx.addedLabelIds).toEqual([]);
    expect(ctx.removedLabelIds).toEqual([]);
  });

  it("handles complete swap (all removed, all added)", () => {
    const ctx = buildLabelChangeContext(["a", "b"], ["c", "d"]);
    expect(ctx.addedLabelIds).toEqual(["c", "d"]);
    expect(ctx.removedLabelIds).toEqual(["a", "b"]);
  });

  it("preserves original arrays in output", () => {
    const prev = ["a", "b"];
    const next = ["b", "c"];
    const ctx = buildLabelChangeContext(prev, next);
    expect(ctx.previousLabelIds).toBe(prev);
    expect(ctx.newLabelIds).toBe(next);
  });
});

// -- evaluateWorkflowRules ----------------------------------------------------

describe("evaluateWorkflowRules", () => {
  // -- label_added trigger --

  describe("label_added trigger", () => {
    it("matches when trigger_label_id is in addedLabelIds", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: [],
        newLabelIds: ["label-a"],
        addedLabelIds: ["label-a"],
        removedLabelIds: [],
      };
      const rules = [makeRule({ trigger_type: "label_added", trigger_label_id: "label-a" })];
      const actions = evaluateWorkflowRules(ctx, rules);
      expect(actions).toHaveLength(1);
      expect(actions[0].ruleId).toBe("rule-1");
      expect(actions[0].actionType).toBe("set_status");
      expect(actions[0].actionConfig).toEqual({ stateId: "state-done" });
    });

    it("does NOT match when trigger_label_id is NOT in addedLabelIds", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: [],
        newLabelIds: ["label-b"],
        addedLabelIds: ["label-b"],
        removedLabelIds: [],
      };
      const rules = [makeRule({ trigger_type: "label_added", trigger_label_id: "label-a" })];
      expect(evaluateWorkflowRules(ctx, rules)).toEqual([]);
    });

    it("does NOT match when label was already present (not in addedLabelIds)", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: ["label-a"],
        newLabelIds: ["label-a"],
        addedLabelIds: [],
        removedLabelIds: [],
      };
      const rules = [makeRule({ trigger_type: "label_added", trigger_label_id: "label-a" })];
      expect(evaluateWorkflowRules(ctx, rules)).toEqual([]);
    });
  });

  // -- label_removed trigger --

  describe("label_removed trigger", () => {
    it("matches when trigger_label_id is in removedLabelIds", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: ["label-a"],
        newLabelIds: [],
        addedLabelIds: [],
        removedLabelIds: ["label-a"],
      };
      const rules = [makeRule({ trigger_type: "label_removed", trigger_label_id: "label-a" })];
      const actions = evaluateWorkflowRules(ctx, rules);
      expect(actions).toHaveLength(1);
      expect(actions[0].ruleId).toBe("rule-1");
    });

    it("does NOT match when label is still present", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: ["label-a"],
        newLabelIds: ["label-a"],
        addedLabelIds: [],
        removedLabelIds: [],
      };
      const rules = [makeRule({ trigger_type: "label_removed", trigger_label_id: "label-a" })];
      expect(evaluateWorkflowRules(ctx, rules)).toEqual([]);
    });
  });

  // -- label_changed trigger --

  describe("label_changed trigger", () => {
    it("matches when from_label was removed and to_label was added", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: ["label-from"],
        newLabelIds: ["label-to"],
        addedLabelIds: ["label-to"],
        removedLabelIds: ["label-from"],
      };
      const rules = [
        makeRule({
          trigger_type: "label_changed",
          trigger_label_id: "label-to",
          trigger_from_label_id: "label-from",
        }),
      ];
      const actions = evaluateWorkflowRules(ctx, rules);
      expect(actions).toHaveLength(1);
      expect(actions[0].ruleId).toBe("rule-1");
    });

    it("does NOT match when only to_label is present (from_label was never there)", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: [],
        newLabelIds: ["label-to"],
        addedLabelIds: ["label-to"],
        removedLabelIds: [],
      };
      const rules = [
        makeRule({
          trigger_type: "label_changed",
          trigger_label_id: "label-to",
          trigger_from_label_id: "label-from",
        }),
      ];
      expect(evaluateWorkflowRules(ctx, rules)).toEqual([]);
    });

    it("does NOT match when only from_label was removed (to_label not added)", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: ["label-from"],
        newLabelIds: [],
        addedLabelIds: [],
        removedLabelIds: ["label-from"],
      };
      const rules = [
        makeRule({
          trigger_type: "label_changed",
          trigger_label_id: "label-to",
          trigger_from_label_id: "label-from",
        }),
      ];
      expect(evaluateWorkflowRules(ctx, rules)).toEqual([]);
    });

    it("does NOT match when from_label is still in newLabelIds (not actually removed)", () => {
      // Both labels present — from_label wasn't removed, so this isn't a "change"
      const ctx: LabelChangeContext = {
        previousLabelIds: ["label-from"],
        newLabelIds: ["label-from", "label-to"],
        addedLabelIds: ["label-to"],
        removedLabelIds: [],
      };
      const rules = [
        makeRule({
          trigger_type: "label_changed",
          trigger_label_id: "label-to",
          trigger_from_label_id: "label-from",
        }),
      ];
      expect(evaluateWorkflowRules(ctx, rules)).toEqual([]);
    });

    it("does NOT match when trigger_from_label_id is null", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: ["label-x"],
        newLabelIds: ["label-to"],
        addedLabelIds: ["label-to"],
        removedLabelIds: ["label-x"],
      };
      const rules = [
        makeRule({
          trigger_type: "label_changed",
          trigger_label_id: "label-to",
          trigger_from_label_id: null,
        }),
      ];
      expect(evaluateWorkflowRules(ctx, rules)).toEqual([]);
    });
  });

  // -- Status condition --

  describe("status condition", () => {
    it("matches when issue state is in condition_state_ids", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: [],
        newLabelIds: ["label-a"],
        addedLabelIds: ["label-a"],
        removedLabelIds: [],
        currentStateId: "state-staging",
      };
      const rules = [
        makeRule({
          trigger_type: "label_added",
          trigger_label_id: "label-a",
          condition_state_ids: ["state-staging", "state-qa"],
          action_config: { stateId: "state-ready" },
        }),
      ];
      const actions = evaluateWorkflowRules(ctx, rules);
      expect(actions).toHaveLength(1);
    });

    it("does NOT match when issue state is NOT in condition_state_ids", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: [],
        newLabelIds: ["label-a"],
        addedLabelIds: ["label-a"],
        removedLabelIds: [],
        currentStateId: "state-prod",
      };
      const rules = [
        makeRule({
          trigger_type: "label_added",
          trigger_label_id: "label-a",
          condition_state_ids: ["state-staging"],
          action_config: { stateId: "state-ready" },
        }),
      ];
      expect(evaluateWorkflowRules(ctx, rules)).toEqual([]);
    });

    it("null condition_state_ids fires unconditionally", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: [],
        newLabelIds: ["label-a"],
        addedLabelIds: ["label-a"],
        removedLabelIds: [],
        currentStateId: "state-anything",
      };
      const rules = [
        makeRule({
          trigger_type: "label_added",
          trigger_label_id: "label-a",
          condition_state_ids: null,
        }),
      ];
      const actions = evaluateWorkflowRules(ctx, rules);
      expect(actions).toHaveLength(1);
    });

    it("empty condition_state_ids array never fires", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: [],
        newLabelIds: ["label-a"],
        addedLabelIds: ["label-a"],
        removedLabelIds: [],
        currentStateId: "state-staging",
      };
      const rules = [
        makeRule({
          trigger_type: "label_added",
          trigger_label_id: "label-a",
          condition_state_ids: [],
        }),
      ];
      expect(evaluateWorkflowRules(ctx, rules)).toEqual([]);
    });

    it("same label triggers different actions based on current state", () => {
      const ctxStaging: LabelChangeContext = {
        previousLabelIds: [],
        newLabelIds: ["label-approved"],
        addedLabelIds: ["label-approved"],
        removedLabelIds: [],
        currentStateId: "state-staging-review",
      };
      const ctxProd: LabelChangeContext = {
        previousLabelIds: [],
        newLabelIds: ["label-approved"],
        addedLabelIds: ["label-approved"],
        removedLabelIds: [],
        currentStateId: "state-prod-review",
      };
      const rules = [
        makeRule({
          id: "rule-staging",
          trigger_type: "label_added",
          trigger_label_id: "label-approved",
          condition_state_ids: ["state-staging-review"],
          action_config: { stateId: "state-ready-for-release" },
        }),
        makeRule({
          id: "rule-prod",
          trigger_type: "label_added",
          trigger_label_id: "label-approved",
          condition_state_ids: ["state-prod-review"],
          action_config: { stateId: "state-done" },
        }),
      ];

      const stagingActions = evaluateWorkflowRules(ctxStaging, rules);
      expect(stagingActions).toHaveLength(1);
      expect(stagingActions[0].ruleId).toBe("rule-staging");
      expect(stagingActions[0].actionConfig).toEqual({ stateId: "state-ready-for-release" });

      const prodActions = evaluateWorkflowRules(ctxProd, rules);
      expect(prodActions).toHaveLength(1);
      expect(prodActions[0].ruleId).toBe("rule-prod");
      expect(prodActions[0].actionConfig).toEqual({ stateId: "state-done" });
    });

    it("does NOT match when currentStateId is undefined and condition is set", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: [],
        newLabelIds: ["label-a"],
        addedLabelIds: ["label-a"],
        removedLabelIds: [],
        // currentStateId is undefined
      };
      const rules = [
        makeRule({
          trigger_type: "label_added",
          trigger_label_id: "label-a",
          condition_state_ids: ["state-staging"],
        }),
      ];
      expect(evaluateWorkflowRules(ctx, rules)).toEqual([]);
    });
  });

  // -- Edge cases --

  describe("edge cases", () => {
    it("no rules returns empty array", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: [],
        newLabelIds: ["label-a"],
        addedLabelIds: ["label-a"],
        removedLabelIds: [],
      };
      expect(evaluateWorkflowRules(ctx, [])).toEqual([]);
    });

    it("no matching rules returns empty array", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: [],
        newLabelIds: ["label-x"],
        addedLabelIds: ["label-x"],
        removedLabelIds: [],
      };
      const rules = [
        makeRule({ trigger_type: "label_added", trigger_label_id: "label-a" }),
        makeRule({ id: "rule-2", trigger_type: "label_removed", trigger_label_id: "label-b" }),
      ];
      expect(evaluateWorkflowRules(ctx, rules)).toEqual([]);
    });

    it("multiple rules match the same label change — all returned", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: [],
        newLabelIds: ["label-a"],
        addedLabelIds: ["label-a"],
        removedLabelIds: [],
      };
      const rules = [
        makeRule({ id: "rule-1", trigger_type: "label_added", trigger_label_id: "label-a", action_config: { stateId: "s1" } }),
        makeRule({ id: "rule-2", trigger_type: "label_added", trigger_label_id: "label-a", action_config: { stateId: "s2" } }),
      ];
      const actions = evaluateWorkflowRules(ctx, rules);
      expect(actions).toHaveLength(2);
      expect(actions[0].ruleId).toBe("rule-1");
      expect(actions[1].ruleId).toBe("rule-2");
    });

    it("rules with different trigger types on the same label", () => {
      // label-a was added (not removed), so only label_added rule fires
      const ctx: LabelChangeContext = {
        previousLabelIds: [],
        newLabelIds: ["label-a"],
        addedLabelIds: ["label-a"],
        removedLabelIds: [],
      };
      const rules = [
        makeRule({ id: "rule-add", trigger_type: "label_added", trigger_label_id: "label-a" }),
        makeRule({ id: "rule-remove", trigger_type: "label_removed", trigger_label_id: "label-a" }),
      ];
      const actions = evaluateWorkflowRules(ctx, rules);
      expect(actions).toHaveLength(1);
      expect(actions[0].ruleId).toBe("rule-add");
    });

    it("rule with null trigger_from_label_id for non-label_changed type works fine", () => {
      const ctx: LabelChangeContext = {
        previousLabelIds: [],
        newLabelIds: ["label-a"],
        addedLabelIds: ["label-a"],
        removedLabelIds: [],
      };
      const rules = [
        makeRule({
          trigger_type: "label_added",
          trigger_label_id: "label-a",
          trigger_from_label_id: null,
        }),
      ];
      const actions = evaluateWorkflowRules(ctx, rules);
      expect(actions).toHaveLength(1);
    });
  });
});

// -- executeWorkflowActions ---------------------------------------------------

// Mock the workspace module so we don't hit real Supabase
vi.mock("../workspace", () => ({
  getWorkspaceToken: vi.fn().mockResolvedValue("lin_api_test_token"),
}));

// Mock supabase so the import doesn't blow up
vi.mock("../supabase", () => ({
  supabaseAdmin: {},
}));

describe("executeWorkflowActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockFetch(response: {
    ok?: boolean;
    status?: number;
    json?: unknown;
    text?: string;
  }) {
    const fn = vi.fn().mockResolvedValue({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: () => Promise.resolve(response.json ?? {}),
      text: () => Promise.resolve(response.text ?? ""),
    });
    globalThis.fetch = fn;
    return fn;
  }

  it("successfully calls Linear API for set_status action", async () => {
    const fetchMock = mockFetch({
      json: {
        data: {
          issueUpdate: {
            success: true,
            issue: { id: "issue-1", state: { id: "state-done", name: "Done" } },
          },
        },
      },
    });

    const actions: WorkflowAction[] = [
      { ruleId: "rule-1", actionType: "set_status", actionConfig: { stateId: "state-done" } },
    ];

    await executeWorkflowActions(actions, "issue-1");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.linear.app/graphql",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "lin_api_test_token",
        }),
      })
    );

    // Verify the body contains the right variables
    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(callBody.variables).toEqual({ issueId: "issue-1", stateId: "state-done" });
  });

  it("returns success result", async () => {
    mockFetch({
      json: {
        data: {
          issueUpdate: {
            success: true,
            issue: { id: "issue-1", state: { id: "state-done", name: "Done" } },
          },
        },
      },
    });

    const actions: WorkflowAction[] = [
      { ruleId: "rule-1", actionType: "set_status", actionConfig: { stateId: "state-done" } },
    ];

    const results = await executeWorkflowActions(actions, "issue-1");
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      ruleId: "rule-1",
      action: "set_status",
      success: true,
      details: { stateId: "state-done", stateName: "Done" },
    });
  });

  it("returns failure result with error message on HTTP error", async () => {
    mockFetch({ ok: false, status: 401, text: "Unauthorized" });

    const actions: WorkflowAction[] = [
      { ruleId: "rule-1", actionType: "set_status", actionConfig: { stateId: "state-done" } },
    ];

    const results = await executeWorkflowActions(actions, "issue-1");
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain("401");
    expect(results[0].error).toContain("Unauthorized");
  });

  it("returns failure result on GraphQL errors", async () => {
    mockFetch({
      json: {
        errors: [{ message: "Issue not found" }],
      },
    });

    const actions: WorkflowAction[] = [
      { ruleId: "rule-1", actionType: "set_status", actionConfig: { stateId: "state-done" } },
    ];

    const results = await executeWorkflowActions(actions, "issue-1");
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain("Issue not found");
  });

  it("returns failure when issueUpdate returns unsuccessful", async () => {
    mockFetch({
      json: {
        data: { issueUpdate: { success: false } },
      },
    });

    const actions: WorkflowAction[] = [
      { ruleId: "rule-1", actionType: "set_status", actionConfig: { stateId: "state-done" } },
    ];

    const results = await executeWorkflowActions(actions, "issue-1");
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain("unsuccessful");
  });

  it("returns failure when stateId is missing from action_config", async () => {
    const fetchMock = mockFetch({ json: {} });

    const actions: WorkflowAction[] = [
      { ruleId: "rule-1", actionType: "set_status", actionConfig: {} },
    ];

    const results = await executeWorkflowActions(actions, "issue-1");
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain("Missing stateId");
    // Should not have called fetch at all
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles multiple actions independently (one failing doesn't block others)", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call fails
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Internal Server Error"),
        });
      }
      // Second call succeeds
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: {
              issueUpdate: {
                success: true,
                issue: { id: "issue-1", state: { id: "state-2", name: "In Progress" } },
              },
            },
          }),
      });
    });

    const actions: WorkflowAction[] = [
      { ruleId: "rule-1", actionType: "set_status", actionConfig: { stateId: "state-1" } },
      { ruleId: "rule-2", actionType: "set_status", actionConfig: { stateId: "state-2" } },
    ];

    const results = await executeWorkflowActions(actions, "issue-1");
    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(false);
    expect(results[1].success).toBe(true);
    expect(results[1].ruleId).toBe("rule-2");
  });

  it("handles unknown action type gracefully", async () => {
    const actions: WorkflowAction[] = [
      { ruleId: "rule-1", actionType: "send_email" as never, actionConfig: {} },
    ];

    const results = await executeWorkflowActions(actions, "issue-1");
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain("Unknown action type");
  });

  it("catches and logs errors without throwing", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const actions: WorkflowAction[] = [
      { ruleId: "rule-1", actionType: "set_status", actionConfig: { stateId: "state-done" } },
    ];

    // Should not throw
    const results = await executeWorkflowActions(actions, "issue-1");
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe("Network failure");
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
