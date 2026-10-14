import { readFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { lazyCompile } from "../../packages/gateway-protocol/src/protocol-validator.js";
import { closedObject } from "../../packages/gateway-protocol/src/schema/closed-object.js";
import {
  ControlUiWelcomeContentSchema,
  type ControlUiWelcomeGetResult,
} from "../../packages/gateway-protocol/src/schema/control-ui-welcome.js";
import { resolveOpenClawPackageRoot } from "../infra/openclaw-root.js";
import { resolveControlUiLocale } from "../shared/control-ui-locale.js";
import { createLazyPromise } from "../shared/lazy-promise.js";

const validateCatalog = lazyCompile(
  closedObject({
    version: Type.Literal(1),
    locales: Type.Record(Type.String(), ControlUiWelcomeContentSchema),
  }),
);

// The installed build owns these immutable bytes. Restart after an update;
// do not follow another installation or poll source/translation memory at runtime.
const loadCatalog = createLazyPromise(async () => {
  const root = await resolveOpenClawPackageRoot({ moduleUrl: import.meta.url });
  if (!root) {
    throw new Error(
      "Cannot locate the installed OpenClaw welcome catalog. Rebuild or reinstall OpenClaw.",
    );
  }
  const catalog: unknown = JSON.parse(
    await readFile(path.join(root, "dist/control-ui-welcome.json"), "utf8"),
  );
  if (!validateCatalog(catalog) || !Object.hasOwn(catalog.locales, "en")) {
    throw new Error("Invalid OpenClaw welcome catalog. Rebuild or reinstall OpenClaw.");
  }
  return catalog;
});

export async function getControlUiWelcome(
  requestedLocale = "en",
): Promise<ControlUiWelcomeGetResult> {
  const catalog = await loadCatalog();
  const resolvedLocale = resolveControlUiLocale(
    requestedLocale,
    Object.keys(catalog.locales),
    "en",
  );
  return {
    version: 1,
    requestedLocale,
    resolvedLocale,
    ...catalog.locales[resolvedLocale]!,
  };
}
