type PromptState = {
  sections: string[];
  mutations: number;
  dismissed: boolean;
};

export const feedbackMutationEvent = "brew-dashboard:feedback-mutation";

const storageKey = (networkId: string) => `brew-dashboard:feedback-prompt:${networkId}`;

const fallbackState: PromptState = { sections: [], mutations: 0, dismissed: false };

export const readFeedbackPromptState = (networkId: string): PromptState => {
  try {
    const value = window.sessionStorage.getItem(storageKey(networkId));
    if (!value) return fallbackState;
    const parsed = JSON.parse(value) as Partial<PromptState>;
    return {
      sections: Array.isArray(parsed.sections)
        ? parsed.sections.filter((section): section is string => typeof section === "string")
        : [],
      mutations: typeof parsed.mutations === "number" ? Math.max(0, parsed.mutations) : 0,
      dismissed: Boolean(parsed.dismissed),
    };
  } catch {
    return fallbackState;
  }
};

export const writeFeedbackPromptState = (networkId: string, state: PromptState) => {
  try {
    window.sessionStorage.setItem(storageKey(networkId), JSON.stringify(state));
  } catch {
    // Storage access is optional; the current render still remains correct.
  }
};

export const recordFeedbackSection = (networkId: string, section: string) => {
  const current = readFeedbackPromptState(networkId);
  const next = current.sections.includes(section)
    ? current
    : { ...current, sections: [...current.sections, section] };
  writeFeedbackPromptState(networkId, next);
  return next;
};

export const recordFeedbackMutation = (networkId: string) => {
  const current = readFeedbackPromptState(networkId);
  const next = { ...current, mutations: current.mutations + 1 };
  writeFeedbackPromptState(networkId, next);
  window.dispatchEvent(new CustomEvent(feedbackMutationEvent, { detail: { networkId } }));
  return next;
};

export const dismissFeedbackPrompt = (networkId: string) => {
  const next = { ...readFeedbackPromptState(networkId), dismissed: true };
  writeFeedbackPromptState(networkId, next);
  return next;
};
