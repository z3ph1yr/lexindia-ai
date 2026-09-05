/**
 * Stage: ENRICH — provision relationships.
 *
 * 1. Successor relations (curated IPC -> BNS map, confidence recorded).
 * 2. Derived 'related' relations: lexical neighbours within the same act,
 *    computed by querying the FTS index with the provision's own text.
 *    Confidence 'derived' + score; never presented as curated fact.
 */
const { IPC_TO_BNS, ANNOTATIONS } = require('./bns-mapping');

function buildRelations(db, log = console.log) {
  const insRel = db.prepare(`INSERT INTO provision_relations
    (from_act, from_no, to_act, to_no, relation_type, note, confidence, score)
    VALUES (?,?,?,?,?,?,?,?)`);

  const have = new Map(
    db.prepare('SELECT provision_id, act_code, provision_no FROM provisions').all()
      .map((p) => [`${p.act_code}:${p.provision_no.toUpperCase()}`, p.provision_id])
  );

  let successors = 0;
  let skipped = 0;
  for (const m of IPC_TO_BNS) {
    const fromKey = `IPC:${m.from.toUpperCase()}`;
    const toKey = `BNS:${m.target.toUpperCase()}`;
    if (!have.has(fromKey) || !have.has(toKey)) {
      skipped += 1;
      log(`[enrich] successor map skipped (missing provision): IPC Section ${m.from} -> BNS Section ${m.target}`);
      continue;
    }
    insRel.run('IPC', m.from, 'BNS', m.target, 'successor', `${m.note} — ${m.to}`, m.confidence, null);
    successors += 1;
    // reverse edge (BNS back-reference) for lookups from the current act
    insRel.run('BNS', m.target, 'IPC', m.from, 'predecessor', `Re-enactment of IPC Section ${m.from} — ${m.to}`, m.confidence, null);
  }

  // derived lexical 'related' relations (same act)
  let related = 0;
  const provisions = db.prepare('SELECT provision_id, act_code, provision_no, title, normalized_text FROM provisions').all();
  for (const p of provisions) {
    if (!p.normalized_text || p.normalized_text.length < 80) continue;
    // query with the provision's opening words (deterministic sample)
    const q = p.normalized_text.slice(0, 300).replace(/["]/g, ' ');
    const tokens = [...new Set(q.toLowerCase().match(/[a-z][a-z]+/g) || [])]
      .filter((t) => t.length > 3)
      .slice(0, 24)
      .map((t) => `"${t}"`)
      .join(' OR ');
    if (!tokens) continue;
    let rows = [];
    try {
      rows = db
        .prepare(`SELECT DISTINCT p2.provision_id, p2.act_code, p2.provision_no, p2.normalized_text
                  FROM chunks_fts f
                  JOIN chunks c ON c.chunk_id = f.rowid
                  JOIN provisions p2 ON p2.provision_id = c.provision_id
                  WHERE chunks_fts MATCH ? AND p2.act_code = ? AND p2.provision_id != ?
                  LIMIT 24`)
        .all(tokens, p.act_code, p.provision_id);
    } catch {
      rows = [];
    }
    const myTokens = new Set(
      (p.normalized_text.slice(0, 400).toLowerCase().match(/[a-z][a-z]+/g) || []).filter((t) => t.length > 3)
    );
    const scored = rows
      .map((r) => {
        const t = new Set((r.normalized_text || '').toLowerCase().match(/[a-z][a-z]+/g) || []);
        let inter = 0;
        for (const w of myTokens) if (t.has(w)) inter += 1;
        return { ...r, score: myTokens.size ? inter / Math.min(myTokens.size, t.size || 1) : 0 };
      })
      .filter((r) => r.score > 0.12)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    for (const r of scored) {
      insRel.run(p.act_code, p.provision_no, r.act_code, r.provision_no, 'related', 'Derived lexical neighbour (automated; not a legal source)', 'derived', Math.round(r.score * 1000) / 1000);
      related += 1;
    }
  }

  const insAnno = db.prepare(`INSERT INTO annotations
    (act_code, provision_no, kind, note, authority, year, confidence)
    VALUES (?,?,?,?,?,?,?)`);
  let annotations = 0;
  for (const a of ANNOTATIONS) {
    if (!have.has(`${a.act}:${a.section.toUpperCase()}`)) continue;
    insAnno.run(a.act, a.section, a.kind, a.note, a.authority, a.year, a.confidence);
    annotations += 1;
  }

  log(`[enrich] relations: ${successors} successor pairs (+${successors} reverse), ${related} derived related, ${annotations} annotations, ${skipped} skipped`);
  return { successors, related, annotations };
}

module.exports = { buildRelations };
