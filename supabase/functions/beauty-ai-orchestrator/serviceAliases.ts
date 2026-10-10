export type ServiceCatalogEntry = { id: string; name: string };

export type ServiceTextResolution = {
  service: ServiceCatalogEntry | null;
  ambiguous: boolean;
};

function normalizeServiceText(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function hasPhrase(text: string, phrase: string) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?=$|[\\s,?.!])`, 'u').test(text);
}

// Alias rules describe a service family, never an id. The final selection is
// always made from the active catalog received in the current business turn.
// Add future families here instead of spreading natural-language exceptions
// through the booking flow.
const SERVICE_ALIAS_FAMILIES = [
  {
    catalogName: /\bcorte\b/u,
    aliases: [
      'pelarme',
      'cortarme el pelo',
      'corte de pelo',
      'recortarme el pelo',
      'arreglarme el pelo',
    ],
  },
] as const;

function singleService(matches: ServiceCatalogEntry[]): ServiceTextResolution {
  const unique = [...new Map(matches.map((service) => [service.id, service])).values()];
  return unique.length === 1
    ? { service: unique[0], ambiguous: false }
    : { service: null, ambiguous: unique.length > 1 };
}

/**
 * Resolves a customer phrase only against the active catalog. Canonical names
 * always win. Alias phrases are exact normalized phrases, never fuzzy matches;
 * if an alias maps to more than one real service, no service is selected.
 */
export function resolveServiceText(
  rawText: string | null | undefined,
  services: ServiceCatalogEntry[],
): ServiceTextResolution {
  const text = normalizeServiceText(rawText ?? '');
  if (!text) return { service: null, ambiguous: false };

  const exact = services.filter((service) => normalizeServiceText(service.name) === text);
  if (exact.length) return singleService(exact);

  const literalMatches = services.filter((service) => {
    const name = normalizeServiceText(service.name);
    return name.length > 1 && hasPhrase(text, name);
  });
  if (literalMatches.length) {
    const longestLength = Math.max(...literalMatches.map((service) => normalizeServiceText(service.name).length));
    return singleService(literalMatches.filter((service) => normalizeServiceText(service.name).length === longestLength));
  }

  const matchingFamilies = SERVICE_ALIAS_FAMILIES.filter((family) => family.aliases.some((alias) => hasPhrase(text, alias)));
  if (!matchingFamilies.length) return { service: null, ambiguous: false };

  const candidates = services.filter((service) => {
    const name = normalizeServiceText(service.name);
    return matchingFamilies.some((family) => family.catalogName.test(name));
  });
  return singleService(candidates);
}
