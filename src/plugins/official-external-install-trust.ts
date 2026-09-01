// Resolves trusted official external plugin installs from the OpenClaw-owned catalog.
import { parseRegistryNpmSpec } from "../infra/npm-registry-spec.js";
import {
  getOfficialExternalPluginCatalogEntry,
  getOfficialExternalPluginCatalogEntryForPackage,
  resolveOfficialExternalPluginId,
  resolveOfficialExternalPluginInstall,
} from "./official-external-plugin-catalog.js";

export function resolveCatalogOfficialExternalInstallPlan(rawSpec: string) {
  if (!/^[a-z0-9][a-z0-9-._~]*$/.test(rawSpec.trim())) {
    return null;
  }
  const entry = getOfficialExternalPluginCatalogEntry(rawSpec);
  const pluginId = entry && resolveOfficialExternalPluginId(entry);
  if (!entry || !pluginId) {
    return null;
  }
  const install = resolveOfficialExternalPluginInstall(entry);
  const npmSpec = install?.npmSpec?.trim();
  if (!npmSpec) {
    return null;
  }
  return {
    pluginId,
    npmSpec,
    ...(install?.expectedIntegrity ? { expectedIntegrity: install.expectedIntegrity } : {}),
  };
}

export function resolveCatalogOfficialExternalNpmPackageTrust(npmSpec: string) {
  const parsed = parseRegistryNpmSpec(npmSpec);
  if (!parsed) {
    return null;
  }
  const entry = getOfficialExternalPluginCatalogEntryForPackage(parsed.name);
  const pluginId = entry && resolveOfficialExternalPluginId(entry);
  if (!entry || !pluginId) {
    return null;
  }
  const install = resolveOfficialExternalPluginInstall(entry);
  const catalogSpec = install?.npmSpec?.trim();
  const catalogPackageName = catalogSpec ? parseRegistryNpmSpec(catalogSpec)?.name : undefined;
  if (catalogPackageName && catalogPackageName !== parsed.name) {
    return null;
  }
  return {
    pluginId,
    ...(install?.expectedIntegrity && catalogSpec === npmSpec.trim()
      ? { expectedIntegrity: install.expectedIntegrity }
      : {}),
    trustedSourceLinkedOfficialInstall: true as const,
  };
}
