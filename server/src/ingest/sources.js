/**
 * Source registry — the single place where corpus provenance is declared.
 * Every provision row must reference one of these.
 */
module.exports = [
  {
    source_id: 'SRC-INDIA-CODE-API',
    name: 'India Code Digital Repository (REST API)',
    authority: 'official',
    url: 'https://indiacode.gov.in/server/api',
    license: 'Public domain — Government of India statutory text (no copyright subsists in Acts of Parliament; s.52, Indian Copyright Act, 1957)',
    note: 'Legislative Department, Ministry of Law & Justice. Section items retrieved via the DSpace discover API (Bharatiya Nyaya Sanhita, 2023).',
  },
  {
    source_id: 'SRC-IPC-SNAPSHOT',
    name: 'IPC 1860 consolidated text (community snapshot)',
    authority: 'community',
    url: 'https://github.com/civictech-India/Indian-Law-Penal-Code-Json',
    license: 'Public domain underlying text (Indian statute); snapshot layout community-maintained',
    note: 'Third-party consolidation of the Indian Penal Code, 1860. Extended-corpus provenance only; core provisions are independently cross-verified (SRC-INDIAN-KANOON) and all provisions await Gazette re-verification before production.',
  },
  {
    source_id: 'SRC-INDIAN-KANOON',
    name: 'Indian Kanoon legal archive',
    authority: 'secondary',
    url: 'https://indiankanoon.org/',
    license: 'Public domain underlying statutory text; archive © Indian Kanoon',
    note: 'Independent secondary source used exclusively to cross-verify the curated IPC core set (automated text comparison, scores recorded per provision).',
  },
];
