import { Type, type Static } from "typebox";
import { closedObject } from "./closed-object.js";
import { NonEmptyString } from "./primitives.js";

export const ControlUiWelcomeGetParamsSchema = closedObject({
  locale: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});

export const ControlUiWelcomeContentSchema = closedObject({
  hint: NonEmptyString,
  recentChatsLabel: NonEmptyString,
  suggestions: Type.Array(
    closedObject({
      id: NonEmptyString,
      displayText: NonEmptyString,
      sendText: NonEmptyString,
    }),
  ),
});

export const ControlUiWelcomeGetResultSchema = closedObject({
  version: Type.Literal(1),
  requestedLocale: NonEmptyString,
  resolvedLocale: NonEmptyString,
  ...ControlUiWelcomeContentSchema.properties,
});

export type ControlUiWelcomeGetParams = Static<typeof ControlUiWelcomeGetParamsSchema>;
export type ControlUiWelcomeContent = Static<typeof ControlUiWelcomeContentSchema>;
export type ControlUiWelcomeGetResult = Static<typeof ControlUiWelcomeGetResultSchema>;
