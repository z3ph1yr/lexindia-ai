# Data provenance

The knowledge base never contains invented legal text. Every provision row resolves to a
registered source, a verification status, and (where verified) an evidence URL with a recorded
similarity score. This document is the human-readable provenance strategy; the machine-readable
form lives in the `sources` table and per-provision fields (`source_id`, `source_url`,
`verified_against_url`, `verification`, `verification_score`).

## Corpus composition (this MVP)

| Act | Coverage | Source | Verification |
| --- | --- | --- | --- |
| **Bharatiya Nyaya Sanhita, 2023** (current penal code, in force w.e.f. 01-07-2024) | All 358 section items | **Official**: India Code Digital Repository REST API (Legislative Department, Ministry of Law & Justice, Government of India) — `indiacode.gov.in/server/api` | `official` by construction; per-provision source URL `https://indiacode.gov.in/items/<uuid>` |
| **Indian Penal Code, 1860** (historical; replaced w.e.f. 01-07-2024) | All 575 provisions incl. lettered ones | Community consolidation snapshot (`civictech-India/Indian-Law-Penal-Code-Json`) | **Dual-source cross-verification**: 538/570 text-bearing provisions verified against the **official bare-act PDF** (archived India Code PDF, `web.archive.org` snapshot of `indiacode.nic.in/bitstream/123456789/15407/1/ipc1860.pdf`) using a whitespace/pagination-insensitive overlap coefficient (≥ 0.80), score recorded per provision; residual provisions fall back to **Indian Kanoon** (independent secondary archive); anything unverifiable stays `unverified` and is flagged in the UI |

### Verification mechanics

- Verification **never rewrites stored text**. It only records `status` (official / verified /
  unverified), a score in [0,1], and the evidence URL.
- Comparison uses an **overlap coefficient** (|A∩B| / min(|A|,|B|)) on aggressively normalized
  tokens (lowercase, punctuation stripped) so truncated excerpts, official illustrations, and
  PDF artifacts (footnote markers, pagination lines, the PDF's own typos) do not cause false
  mismatches. A Jaccard metric is used for same-length secondary-source comparisons.
- Provisions whose text **disagrees** with the official source (e.g. IPC Sections 370, 376–376D — the
  snapshot reflects amendment states that differ from the archived bare act) are kept but
  explicitly **not** marked verified, and the mismatch is logged at ingest.
- Section 304B is a **known gap**: its body is missing in the snapshot. It is ingested as
  `text_status = 'title_only'`, remains discoverable by title, and the UI discloses the gap.
  Nothing was invented to fill it.

### Curated core set (quality over quantity)

A deliberately small **core collection** (`collection = 'core'`) covers the provisions every
penal-law query surface must answer well: general clauses/defences, State offences, the homicide
cluster, hurt/kidnapping/sexual offences, property offences (theft, extortion, robbery,
breach of trust, cheating, trespass, forgery), marriage/reputation/intimidation — plus their BNS
successors. Core IPC provisions are the cross-verification targets; core BNS provisions are
official text. The remainder of each act is `extended` coverage with its own (weaker, clearly
flagged) provenance.

### IPC → BNS successor mapping

A curated map (42 pairs, `server/src/ingest/bns-mapping.js`) connects IPC provisions to their
BNS re-enactments. Pairs are `verified` (well-established correspondence, cross-checked against
the ingested BNS text) or `indicative` (flagged for expert confirmation) — the UI labels
indicative mappings as such. Reverse `predecessor` edges support lookups from the current act.

## Copyright

Indian statutes are public domain (no copyright subsists in Acts of Parliament; s.52, Indian
Copyright Act, 1957). The India Code text and the bare-act PDF are Government of India
publications. Indian Kanoon is used strictly as a verification reference, not redistributed.

## Known limitations (stated, not hidden)

- The IPC snapshot is a community consolidation: even verified provisions should be re-checked
  against the current Gazette before production reliance. The schema and pipeline are built so
  that swapping the snapshot for the official source is a data task, not a code change.
- The archived bare-act PDF reflects a particular consolidation date; provisions amended after
  that date mismatch and remain unverified (visible in `data/validation-report.json`).
- Embeddings are not computed in this MVP (no provider key configured): the `chunks.embedding`
  column, `embedding_status` and the embed stage exist end-to-end and populate when
  `LLM_API_KEY`/`EMBED_MODEL` are provided. Until then, retrieval is BM25 + legal query
  expansion, honestly labelled everywhere.
- Judicial annotations are a tiny curated, hand-verified set (3 entries), never auto-generated.
