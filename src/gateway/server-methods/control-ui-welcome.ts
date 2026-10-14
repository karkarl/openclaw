import {
  ErrorCodes,
  errorShape,
  validateControlUiWelcomeGetParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { getControlUiWelcome } from "../control-ui-welcome.js";
import type { GatewayRequestHandlers } from "./types.js";
import { defineValidatedGatewayMethod } from "./validation.js";

export const controlUiWelcomeHandlers: GatewayRequestHandlers = {
  "controlUi.welcome.get": defineValidatedGatewayMethod(
    "controlUi.welcome.get",
    validateControlUiWelcomeGetParams,
    async ({ params, respond }) => {
      respond(true, await getControlUiWelcome(params.locale));
    },
    () =>
      errorShape(
        ErrorCodes.UNAVAILABLE,
        "The installed welcome catalog is unavailable. Rebuild or reinstall OpenClaw and restart the Gateway.",
      ),
  ),
};
