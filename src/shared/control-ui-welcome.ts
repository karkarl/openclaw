export const CONTROL_UI_WELCOME_HINT_KEY = "newSession.hint";
export const CONTROL_UI_WELCOME_RECENT_CHATS_KEY = "chat.welcome.recentSessions";

const suggestionIds = [
  "whatCanYouDo",
  "summarizeRecentSessions",
  "configureChannel",
  "checkSystemHealth",
] as const;

export const CONTROL_UI_WELCOME_SUGGESTIONS = suggestionIds.map((id) => ({
  id,
  translationKey: `chat.welcome.suggestions.${id}`,
}));

export function resolveControlUiWelcomeContent(translate: (key: string) => string) {
  return {
    hint: translate(CONTROL_UI_WELCOME_HINT_KEY),
    recentChatsLabel: translate(CONTROL_UI_WELCOME_RECENT_CHATS_KEY),
    suggestions: CONTROL_UI_WELCOME_SUGGESTIONS.map(({ id, translationKey }) => {
      const text = translate(translationKey);
      return { id, displayText: text, sendText: text };
    }),
  };
}
