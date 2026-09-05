/**
 * Stage: VALIDATE — quality controls over the assembled knowledge base.
 *
 * Detects: missing provision numbers, duplicate provisions, empty text,
 * malformed metadata, missing provenance, invalid relationships.
 * Critical defects fail the pipeline (exit code 1); minor issues surface
 * as warnings. A full report is written to data/validation-report.json
 * and summarized into ingest_runs.
 */
const fs = require('fs');
const path = require('path');
const { isValidProvisionNumber, isRepealNote } = require('./normalize');

const DEFAULT_REPORT = path.resolve(__dirname, '../../../data/validation-report.json');

function validate(db, reportPath = DEFAULT_REPORT) {
  const errors = [];
  const warnings = [];
  const checks = [];

  const check = (name, fn) => {
    const r = fn() || { errors: [], warnings: [] };
    const errs = r.errors || [];
    const warns = r.warnings || [];
    checks.push({ name, errors: errs.length, warnings: warns.length });
    errors.push(...errs.map((e) => `[${name}] ${e}`));
    warnings.push(...warns.map((w) => `[${name}] ${w}`));
  };

  const provisions = db.prepare('SELECT * FROM provisions').all();
  const acts = db.prepare('SELECT * FROM acts').all();
  const sources = db.prepare('SELECT source_id FROM sources').all().map((s) => s.source_id);
  const chunks = db.prepare('SELECT * FROM chunks').all();
  const relations = db.prepare('SELECT * FROM provision_relations').all();

  // 1. provision numbers present + well-formed
  check('provision-numbers', () => {
    const errs = [];
    for (const p of provisions) {
      if (!p.provision_no || !String(p.provision_no).trim()) errs.push(`provision_id=${p.provision_id}: missing provision_no`);
      else if (!isValidProvisionNumber(p.provision_no)) errs.push(`provision_id=${p.provision_id}: malformed provision_no "${p.provision_no}"`);
    }
    return { errors: errs };
  });

  // 2. duplicate provisions
  check('duplicates', () => {
    const seen = new Map();
    const errs = [];
    for (const p of provisions) {
      const key = `${p.act_code}:${String(p.provision_no).toUpperCase()}`;
      if (seen.has(key)) errs.push(`duplicate provision ${key} (ids ${seen.get(key)}, ${p.provision_id})`);
      seen.set(key, p.provision_id);
    }
    return { errors: errs };
  });

  // 3. empty text
  check('empty-text', () => {
    const errs = [];
    const warns = [];
    for (const p of provisions) {
      const hasText = String(p.normalized_text || '').trim().length > 0;
      if (!hasText && p.text_status === 'title_only') {
        warns.push(`${p.act_code} Section ${p.provision_no}: no statutory text in source (title-only; recorded known gap)`);
      } else if (!hasText) {
        errs.push(`provision_id=${p.provision_id} (${p.act_code} Section ${p.provision_no}): empty text`);
      }
      if (p.repeal_note === 1 && String(p.normalized_text).length > 400) {
        warns.push(`provision_id=${p.provision_id} (${p.act_code} Section ${p.provision_no}): flagged repeal_note but text is long`);
      }
    }
    return { errors: errs, warnings: warns };
  });

  // 4. malformed metadata
  check('metadata', () => {
    const errs = [];
    const warns = [];
    const STATUS = new Set(['in_force', 'repealed']);
    const COLLECTIONS = new Set(['core', 'extended']);
    const TEXT_STATUS = new Set(['full', 'title_only']);
    const VERIFICATION = new Set(['official', 'verified', 'unverified']);
    for (const p of provisions) {
      if (!STATUS.has(p.status)) errs.push(`provision_id=${p.provision_id}: invalid status "${p.status}"`);
      if (!COLLECTIONS.has(p.collection)) errs.push(`provision_id=${p.provision_id}: invalid collection "${p.collection}"`);
      if (!TEXT_STATUS.has(p.text_status)) errs.push(`provision_id=${p.provision_id}: invalid text_status "${p.text_status}"`);
      if (!VERIFICATION.has(p.verification)) errs.push(`provision_id=${p.provision_id}: invalid verification "${p.verification}"`);
      if (p.effective_date && Number.isNaN(Date.parse(p.effective_date))) errs.push(`provision_id=${p.provision_id}: unparseable effective_date`);
      if (p.verification_score != null && (p.verification_score < 0 || p.verification_score > 1)) {
        errs.push(`provision_id=${p.provision_id}: verification_score out of range`);
      }
      if (!String(p.title || '').trim()) warns.push(`provision_id=${p.provision_id} (${p.act_code} Section ${p.provision_no}): missing title`);
      if (p.normalized_text && /\s{3,}/.test(p.normalized_text)) warns.push(`provision_id=${p.provision_id}: suspicious whitespace runs`);
    }
    for (const a of acts) {
      if (!a.act_code || !a.name) errs.push(`act ${a.act_id}: missing act_code or name`);
      if (!['in_force', 'repealed'].includes(a.status)) errs.push(`act ${a.act_code}: invalid status`);
      if (!a.jurisdiction) warns.push(`act ${a.act_code}: missing jurisdiction`);
    }
    return { errors: errs, warnings: warns };
  });

  // 5. provenance
  check('provenance', () => {
    const errs = [];
    const warns = [];
    for (const p of provisions) {
      if (!p.source_id || !sources.includes(p.source_id)) errs.push(`provision_id=${p.provision_id} (${p.act_code} Section ${p.provision_no}): missing/unknown source_id`);
      if (p.collection === 'core' && !p.source_url && !p.verified_against_url) {
        errs.push(`provision_id=${p.provision_id} (${p.act_code} Section ${p.provision_no}): core provision without any provenance URL`);
      }
      if (p.verification === 'verified' && !p.verified_against_url) {
        errs.push(`provision_id=${p.provision_id}: claimed 'verified' without evidence URL`);
      }
    }
    for (const a of acts) {
      if (!a.source_id || !sources.includes(a.source_id)) warns.push(`act ${a.act_code}: missing source_id`);
    }
    // orphaned sources check is implicit (FK)
    return { errors: errs, warnings: warns };
  });

  // 6. relationships valid
  check('relations', () => {
    const errs = [];
    const warns = [];
    const TYPES = new Set(['successor', 'predecessor', 'related', 'defines', 'cites']);
    const key = (act, no) => `${act}:${String(no).toUpperCase()}`;
    const have = new Set(provisions.map((p) => key(p.act_code, p.provision_no)));
    const seen = new Set();
    for (const r of relations) {
      if (!TYPES.has(r.relation_type)) errs.push(`relation_id=${r.relation_id}: invalid relation_type`);
      if (!have.has(key(r.from_act, r.from_no))) errs.push(`relation_id=${r.relation_id}: dangling from ${key(r.from_act, r.from_no)}`);
      if (!have.has(key(r.to_act, r.to_no))) errs.push(`relation_id=${r.relation_id}: dangling to ${key(r.to_act, r.to_no)}`);
      if (key(r.from_act, r.from_no) === key(r.to_act, r.to_no)) errs.push(`relation_id=${r.relation_id}: self-relation`);
      if (r.score != null && (r.score < 0 || r.score > 1)) errs.push(`relation_id=${r.relation_id}: score out of range`);
      if (r.relation_type === 'successor' && !['verified', 'indicative'].includes(r.confidence)) {
        errs.push(`relation_id=${r.relation_id}: successor confidence must be verified|indicative`);
      }
      const dk = `${key(r.from_act, r.from_no)}>${key(r.to_act, r.to_no)}:${r.relation_type}`;
      if (seen.has(dk)) warns.push(`relation_id=${r.relation_id}: duplicate relation ${dk}`);
      seen.add(dk);
    }
    return { errors: errs, warnings: warns };
  });

  // 7. chunk integrity
  check('chunks', () => {
    const errs = [];
    const warns = [];
    const provIds = new Set(provisions.map((p) => p.provision_id));
    const perProv = new Map();
    for (const c of chunks) {
      if (!provIds.has(c.provision_id)) errs.push(`chunk_id=${c.chunk_id}: orphaned (no provision)`);
      perProv.set(c.provision_id, (perProv.get(c.provision_id) || 0) + 1);
      if (!String(c.text || '').trim()) errs.push(`chunk_id=${c.chunk_id}: empty chunk text`);
      if (c.embedding_status === 'embedded' && !c.embedding) errs.push(`chunk_id=${c.chunk_id}: embedded but no vector stored`);
      if (c.embedding_status === 'embedded' && c.embedding) {
        try {
          const v = JSON.parse(c.embedding);
          if (!Array.isArray(v) || typeof v[0] !== 'number') throw new Error();
        } catch {
          errs.push(`chunk_id=${c.chunk_id}: malformed embedding vector`);
        }
      }
    }
    const noChunks = provisions.filter((p) => !perProv.has(p.provision_id));
    for (const p of noChunks) warns.push(`${p.act_code} Section ${p.provision_no}: no chunk indexed (unsearchable)`);
    return { errors: errs, warnings: warns };
  });

  // 8. internal consistency: provisions whose text flags a repeal but status says in force
  check('repeal-consistency', () => {
    const warns = [];
    for (const p of provisions) {
      if (p.status === 'in_force' && isRepealNote(p.normalized_text)) {
        warns.push(`${p.act_code} Section ${p.provision_no}: status 'in_force' but body starts with a repeal/omission note`);
      }
    }
    return { warnings: warns };
  });

  const report = {
    runAt: new Date().toISOString(),
    corpus: {
      acts: acts.length,
      provisions: provisions.length,
      core: provisions.filter((p) => p.collection === 'core').length,
      extended: provisions.filter((p) => p.collection === 'extended').length,
      chunks: chunks.length,
      relations: relations.length,
      verification: {
        official: provisions.filter((p) => p.verification === 'official').length,
        verified: provisions.filter((p) => p.verification === 'verified').length,
        unverified: provisions.filter((p) => p.verification === 'unverified').length,
      },
      embeddings: {
        embedded: chunks.filter((c) => c.embedding_status === 'embedded').length,
        pending: chunks.filter((c) => c.embedding_status === 'pending').length,
      },
    },
    checks,
    errors,
    warnings,
    status: errors.length === 0 ? 'ok' : 'failed',
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return report;
}

module.exports = { validate, DEFAULT_REPORT };
