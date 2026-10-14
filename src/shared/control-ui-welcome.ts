export const CONTROL_UI_WELCOME_HINT_KEY = "newSession.hint";
export const CONTROL_UI_WELCOME_RECENT_CHATS_KEY = "chat.welcome.recentSessions";

const suggestionIds = [
  "whatCanYouDo",
  "summarizeRecentSessions",
  "configureChannel",
  "checkSystemHealth",
] as const;

export function resolveControlUiWelcomeSuggestions(translate: (key: string) => string) {
  return suggestionIds.map((id) => {
    const text = translate(`chat.welcome.suggestions.${id}`);
    return { id, displayText: text, sendText: text };
  });
}

export function resolveControlUiWelcomeContent(translate: (key: string) => string) {
  return {
    hint: translate(CONTROL_UI_WELCOME_HINT_KEY),
    recentChatsLabel: translate(CONTROL_UI_WELCOME_RECENT_CHATS_KEY),
    suggestions: resolveControlUiWelcomeSuggestions(translate),
  };
}
