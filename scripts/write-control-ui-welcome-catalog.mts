import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveControlUiWelcomeContent } from "../src/shared/control-ui-welcome.ts";
import { loadControlUiLocaleCatalog } from "./lib/control-ui-i18n-catalog-values.ts";
import { loadControlUiSourceCatalog } from "./lib/control-ui-i18n-catalog.ts";
import { CONTROL_UI_LOCALE_ENTRIES } from "./lib/control-ui-i18n-config.ts";
import { flattenTranslations } from "./lib/control-ui-i18n-sync-plan.ts";
import { isDirectRunUrl } from "./lib/direct-run.mjs";
import { writeTextFileIfChanged } from "./runtime-postbuild-shared.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function writeControlUiWelcomeCatalog(params: { rootDir?: string; check?: boolean } = {}) {
  const rootDir = params.rootDir ?? repoRoot;
  const sourceCatalog = loadControlUiSourceCatalog();
  const source = flattenTranslations(sourceCatalog);
  const content = (translations: ReadonlyMap<string, string>) =>
    resolveControlUiWelcomeContent((key) => {
      const text = translations.get(key) ?? source.get(key);
      if (!text?.trim()) {
        throw new Error(`Missing Control UI welcome source: ${key}`);
      }
      return text;
    });
  const locales = Object.fromEntries([
    ["en", content(source)],
    ...CONTROL_UI_LOCALE_ENTRIES.map(({ locale }) => {
      const memoryPath = path.join(rootDir, "ui/src/i18n/.i18n", `${locale}.tm.jsonl`);
      return [
        locale,
        content(flattenTranslations(loadControlUiLocaleCatalog(locale, sourceCatalog, memoryPath))),
      ];
    }),
  ]);
  const outputPath = path.join(rootDir, "dist/control-ui-welcome.json");
  const output = `${JSON.stringify({ version: 1, locales })}\n`;
  if (params.check) {
    if (fs.readFileSync(outputPath, "utf8") !== output) {
      throw new Error("Control UI welcome catalog is stale. Run pnpm build.");
    }
  } else {
    writeTextFileIfChanged(outputPath, output);
  }
}

if (isDirectRunUrl(process.argv[1], import.meta.url)) {
  writeControlUiWelcomeCatalog({ check: process.argv.includes("--check") });
}
