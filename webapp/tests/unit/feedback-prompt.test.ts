import { afterEach, describe, expect, it } from "bun:test";

import {
  dismissFeedbackPrompt,
  readFeedbackPromptState,
  recordFeedbackMutation,
  recordFeedbackSection,
} from "../../src/lib/feedback-prompt";

const networkId = "123e4567-e89b-12d3-a456-426614174001";

afterEach(() => window.sessionStorage.clear());

describe("feedback prompt state", () => {
  it("counts unique sections and successful mutations in the current session", () => {
    recordFeedbackSection(networkId, "overview");
    recordFeedbackSection(networkId, "overview");
    recordFeedbackSection(networkId, "products");
    recordFeedbackMutation(networkId);
    recordFeedbackMutation(networkId);

    expect(readFeedbackPromptState(networkId)).toEqual({
      sections: ["overview", "products"],
      mutations: 2,
      dismissed: false,
    });
  });

  it("keeps dismissal scoped to one tenant session", () => {
    dismissFeedbackPrompt(networkId);
    expect(readFeedbackPromptState(networkId).dismissed).toBe(true);
    expect(readFeedbackPromptState("123e4567-e89b-12d3-a456-426614174002").dismissed).toBe(false);
  });
});
