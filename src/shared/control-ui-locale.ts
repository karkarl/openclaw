/** Shared browser-language negotiation; callers supply their available locale catalog. */
export function resolveControlUiLocale<T extends string>(
  language: string,
  locales: readonly T[],
  defaultLocale: T,
): T {
  const navLang = language.toLowerCase();
  if (navLang.startsWith("zh")) {
    const [, ...subtags] = navLang.split("-");
    const chineseLocale = subtags.includes("hant")
      ? "zh-TW"
      : subtags.includes("hans")
        ? "zh-CN"
        : subtags.some((subtag) => subtag === "tw" || subtag === "hk" || subtag === "mo")
          ? "zh-TW"
          : "zh-CN";
    return locales.find((locale) => locale === chineseLocale) ?? defaultLocale;
  }
  return (
    locales.find((locale) => navLang.startsWith(locale.split("-")[0]!.toLowerCase())) ??
    defaultLocale
  );
}
