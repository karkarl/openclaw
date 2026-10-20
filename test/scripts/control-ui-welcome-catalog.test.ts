import fs from "node:fs";
import path from "node:path";
import { Value } from "typebox/value";
import { afterEach, expect, it, vi } from "vitest";
import {
  ControlUiWelcomeGetResultSchema,
  type ControlUiWelcomeGetResult,
} from "../../packages/gateway-protocol/src/schema/control-ui-welcome.js";
import { hashControlUiTranslationText } from "../../scripts/lib/control-ui-i18n-catalog-values.ts";
import { writeControlUiWelcomeCatalog } from "../../scripts/write-control-ui-welcome-catalog.mts";
import { createControlUiRequestOptions } from "../../src/gateway/server-methods/control-ui-request.test-support.js";
import { coreGatewayHandlers } from "../../src/gateway/server-methods/core-handlers.js";
import type { RespondFn } from "../../src/gateway/server-methods/types.js";
import { i18n, t } from "../../ui/src/i18n/lib/translate.ts";
import { registerCommandPaletteEnglish } from "../../ui/src/i18n/locales/en-command-palette.ts";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";

const installedRoot = vi.hoisted(() => ({ path: "" }));
vi.mock("../../src/infra/openclaw-root.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/infra/openclaw-root.js")>()),
  resolveOpenClawPackageRoot: async () => installedRoot.path,
}));

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const requestOptions = createControlUiRequestOptions(() => ({}));

async function request(params: Record<string, unknown>) {
  const respond = vi.fn<RespondFn>();
  const options = requestOptions(params, respond);
  options.req.method = "controlUi.welcome.get";
  await coreGatewayHandlers["controlUi.welcome.get"]!(options);
  expect(respond).toHaveBeenCalledTimes(1);
  return respond.mock.calls[0]!;
}

async function welcome(locale?: string): Promise<ControlUiWelcomeGetResult> {
  const [ok, payload, error] = await request(locale === undefined ? {} : { locale });
  expect({ ok, error }).toEqual({ ok: true, error: undefined });
  expect(Value.Check(ControlUiWelcomeGetResultSchema, payload)).toBe(true);
  if (!Value.Check(ControlUiWelcomeGetResultSchema, payload)) {
    throw new Error("Invalid welcome response");
  }
  return payload;
}

it("delivers current web copy and translation fallbacks through the installed catalog RPC", async () => {
  installedRoot.path = tempDirs.make("openclaw-welcome-");
  const outputPath = path.join(installedRoot.path, "dist/control-ui-welcome.json");

  for (const params of [
    { locale: 42 },
    { locale: "" },
    { locale: "a".repeat(129) },
    { extra: true },
  ]) {
    const [ok, , error] = await request(params);
    expect(ok).toBe(false);
    expect(error?.code).toBe("INVALID_REQUEST");
  }
  const missing = await request({});
  expect(missing[0]).toBe(false);
  expect(missing[2]?.code).toBe("UNAVAILABLE");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, '{"version":1,"locales":{}}');
  const corrupt = await request({});
  expect(corrupt[0]).toBe(false);
  expect(corrupt[2]?.code).toBe("UNAVAILABLE");

  const suggestions = registerCommandPaletteEnglish.catalog.chat.welcome.suggestions;
  const originalHealth = suggestions.checkSystemHealth;
  const localeDir = path.join(installedRoot.path, "ui/src/i18n/.i18n");
  fs.mkdirSync(localeDir, { recursive: true });
  fs.writeFileSync(
    path.join(localeDir, "de.tm.jsonl"),
    [
      {
        cache_key: "current",
        segment_id: "chat.welcome.suggestions.whatCanYouDo",
        text_hash: hashControlUiTranslationText(suggestions.whatCanYouDo),
        translated: "Translated capability prompt",
      },
      {
        cache_key: "outdated",
        segment_id: "chat.welcome.suggestions.checkSystemHealth",
        text_hash: hashControlUiTranslationText(originalHealth),
        translated: "Outdated health prompt",
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n"),
  );
  try {
    suggestions.checkSystemHealth = "Inspect the current Gateway health";
    registerCommandPaletteEnglish();
    await i18n.setLocale("en");
    writeControlUiWelcomeCatalog({ rootDir: installedRoot.path });
    expect(() =>
      writeControlUiWelcomeCatalog({ rootDir: installedRoot.path, check: true }),
    ).not.toThrow();

    // One English-source change reaches the web translator and the installed RPC;
    // the old translation hash must not resurrect the previous prompt.
    expect(t("chat.welcome.suggestions.checkSystemHealth")).toBe(
      "Inspect the current Gateway health",
    );
    const english = await welcome();
    expect(english.requestedLocale).toBe("en");
    expect(english.resolvedLocale).toBe("en");
    expect(english.hint).toBe("Pick where this session works, then say what to do.");
    expect(english.recentChatsLabel).toBe("Recent chats");
    expect(english.suggestions.map(({ id }) => id)).toEqual([
      "whatCanYouDo",
      "summarizeRecentSessions",
      "configureChannel",
      "checkSystemHealth",
    ]);
    expect(english.suggestions.at(-1)).toEqual({
      id: "checkSystemHealth",
      displayText: "Inspect the current Gateway health",
      sendText: "Inspect the current Gateway health",
    });
    const german = await welcome("DE-at");
    expect(german.requestedLocale).toBe("DE-at");
    expect(german.resolvedLocale).toBe("de");
    expect(german.suggestions[0]?.displayText).toBe("Translated capability prompt");
    expect(german.suggestions.at(-1)?.sendText).toBe("Inspect the current Gateway health");
    expect((await welcome("zh-Hant-CN")).resolvedLocale).toBe("zh-TW");
    expect((await welcome("sv-SE")).resolvedLocale).toBe("sv");
    expect((await welcome("zz-ZZ")).resolvedLocale).toBe("en");
    suggestions.checkSystemHealth = originalHealth;
    expect(() =>
      writeControlUiWelcomeCatalog({ rootDir: installedRoot.path, check: true }),
    ).toThrow("stale");
  } finally {
    suggestions.checkSystemHealth = originalHealth;
    registerCommandPaletteEnglish();
  }
});
