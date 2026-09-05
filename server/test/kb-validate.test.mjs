import { test } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validate } from '../src/ingest/validate.js';
import { extractProvisionTexts } from '../src/ingest/verify-pdf.js';

const SCHEMA = fs.readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8');

function tempDb() {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-')), 't.db');
  const db = new DatabaseSync(f);
  db.exec(SCHEMA);
  db.prepare('INSERT INTO sources (source_id, name, authority) VALUES (?,?,?)').run('SRC-T', 'Test source', 'community');
  db.prepare("INSERT INTO acts (act_code, name, status, jurisdiction, source_id) VALUES ('IPC','Indian Penal Code, 1860','repealed','IN','SRC-T')").run();
  return { db, f };
}

/** Validate into a temp report path so the shared report is never touched. */
function v(db, f) {
  return validate(db, path.join(path.dirname(f), 'validation-report.json'));
}

function addProvision(db, { no = '302', text = 'Whoever commits murder shall be punished with death.', title = 'Punishment for murder', verification = 'unverified', source = 'SRC-T', url = null, evidenceUrl = null, collection = 'extended', status = 'repealed', textStatus = null } = {}) {
  return db
    .prepare(
      `INSERT INTO provisions (act_code, provision_no, title, full_text, normalized_text, collection, text_status,
        status, source_id, source_url, verified_against_url, verification) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run('IPC', no, title, text, text, collection, textStatus || (text ? 'full' : 'title_only'), status, source, url, evidenceUrl, verification);
}

function addChunk(db, provisionId, text) {
  db.prepare('INSERT INTO chunks (provision_id, act_code, provision_no, chunk_index, text) VALUES (?,?,?,?,?)')
    .run(provisionId, 'IPC', '302', 0, text);
}

test('validator passes a well-formed corpus', () => {
  const { db, f } = tempDb();
  db.prepare("INSERT INTO acts (act_code, name, status, jurisdiction, source_id) VALUES ('BNS','Bharatiya Nyaya Sanhita, 2023','in_force','IN','SRC-T')").run();
  const id = addProvision(db, { verification: 'verified', url: 'https://example.org/source', evidenceUrl: 'https://example.org/evidence' });
  addChunk(db, id.lastInsertRowid, 'text');
  db.prepare("INSERT INTO provisions (act_code, provision_no, title, full_text, normalized_text, collection, text_status, status, source_id, source_url, verification) VALUES ('BNS','103','Punishment for murder','text','text','core','full','in_force','SRC-T','https://indiacode.gov.in/items/x','official')").run();
  const bnsId = db.prepare("SELECT provision_id FROM provisions WHERE act_code='BNS' AND provision_no='103'").get().provision_id;
  db.prepare('INSERT INTO chunks (provision_id, act_code, provision_no, chunk_index, text) VALUES (?,?,?,?,?)').run(bnsId, 'BNS', '103', 0, 'text');
  db.prepare("INSERT INTO provision_relations (from_act, from_no, to_act, to_no, relation_type, confidence) VALUES ('IPC','302','BNS','103','successor','verified')").run();
  const report = v(db, f);
  if (report.status !== 'ok') console.error(report.errors);
  assert.strictEqual(report.status, 'ok');
  assert.strictEqual(report.errors.length, 0);
  db.close();
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

test('the database rejects duplicate provisions (pipeline guard + unique index)', () => {
  const { db, f } = tempDb();
  addProvision(db, { no: '302' });
  assert.throws(() => addProvision(db, { no: '302' }), /UNIQUE constraint failed/);
  const report = v(db, f);
  assert.ok(report.status === 'ok' || !report.errors.some((e) => e.includes('duplicate')));
  db.close();
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

test('validator detects empty text (not title-only), malformed metadata, missing provenance', () => {
  const { db, f } = tempDb();
  addProvision(db, { no: '303', text: '', title: '', textStatus: 'full' });
  addProvision(db, { no: 'ABC*(', text: 'junk' });
  // core provision without any provenance URL
  addProvision(db, { no: '305', collection: 'core', url: null });
  const report = v(db, f);
  assert.ok(report.errors.some((e) => e.includes('empty text')));
  assert.ok(report.errors.some((e) => e.includes('malformed provision_no')));
  assert.ok(report.errors.some((e) => e.includes('core provision without any provenance URL')));
  assert.ok(report.warnings.some((w) => w.includes('missing title')));
  db.close();
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

test('validator flags claimed verification without evidence URL', () => {
  const { db, f } = tempDb();
  addProvision(db, { no: '306', verification: 'verified', url: 'https://example.org/source', evidenceUrl: null });
  const report = v(db, f);
  assert.ok(report.errors.some((e) => e.includes("claimed 'verified' without evidence URL")));
  db.close();
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

test('validator detects invalid relationships (dangling + self + bad type)', () => {
  const { db, f } = tempDb();
  const id = addProvision(db, { no: '306' });
  addChunk(db, id.lastInsertRowid, 'text');
  db.prepare("INSERT INTO provision_relations (from_act, from_no, to_act, to_no, relation_type) VALUES ('IPC','306','BNS','999','successor')").run();
  db.prepare("INSERT INTO provision_relations (from_act, from_no, to_act, to_no, relation_type) VALUES ('IPC','306','IPC','306','related')").run();
  db.prepare("INSERT INTO provision_relations (from_act, from_no, to_act, to_no, relation_type) VALUES ('IPC','306','IPC','306','marriage')").run();
  const report = v(db, f);
  assert.ok(report.errors.some((e) => e.includes('dangling to')));
  assert.ok(report.errors.some((e) => e.includes('self-relation')));
  assert.ok(report.errors.some((e) => e.includes('invalid relation_type')));
  db.close();
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

test('validator: title-only provisions with no text are a warning, not an error', () => {
  const { db, f } = tempDb();
  db.prepare(
    "INSERT INTO provisions (act_code, provision_no, title, full_text, normalized_text, collection, text_status, status, source_id, source_url, verification) VALUES ('IPC','304B','Dowry death','','','core','title_only','repealed','SRC-T','https://example.org/src','unverified')"
  ).run();
  const report = v(db, f);
  assert.strictEqual(report.status, 'ok');
  assert.ok(report.warnings.some((w) => w.includes('title-only')));
  db.close();
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

test('PDF region extraction keeps monotonic order and rejects spurious pseudo-headings', () => {
  const pdfText = [
    '\n302.\nPunishment for murder.\n302. Punishment for murder.--Whoever commits murder shall be punished with death.\n',
    '\n303.\nPunishment for murder by life-convict.\n303. Punishment for murder by life-convict.--Whoever, being under sentence, commits murder.\n',
    // spurious out-of-order pseudo-heading from a cross-reference inside body text
    '\nback-reference to 302.\n302. Punishment for murder.-- Whoever commits murder again.\n',
    '\n304.\nCulpable homicide.\n304. Culpable homicide.--Whoever causes death.\n',
  ].join('');
  const regions = extractProvisionTexts(pdfText);
  assert.ok(regions.has('302'));
  assert.ok(regions.has('303'));
  assert.ok(regions.has('304'));
  assert.match(regions.get('303'), /being under sentence/);
  // the out-of-order repeat must not have replaced the true 302 region
  assert.match(regions.get('302'), /^Whoever commits murder shall be punished with death\.$/);
});

