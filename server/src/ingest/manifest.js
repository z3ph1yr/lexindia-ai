/**
 * Corpus manifest — the curated "core" collection.
 *
 * The core set is a deliberately small, high-value selection of provisions
 * that every penal-law query surface must answer well. IPC core provisions
 * are cross-verified against Indian Kanoon at ingest; BNS core provisions
 * come from the official India Code API and are therefore 'official' by
 * construction. The extended collection covers the remainder of each act
 * with its own (weaker) provenance, clearly flagged.
 */

/** Curated IPC 1860 core provisions (cross-verified at ingest). */
const IPC_CORE = [
  // General clauses & defences
  '34', '52', '76', '79', '80', '84', '90', '96', '100', '102',
  // Offences against the State / public order
  '120A', '120B', '124A', '141', '147', '153A', '295A',
  // Homicide cluster
  '299', '300', '301', '302', '303', '304', '304A', '304B', '306', '307', '308',
  // Hurt, wrongful restraint, assault, kidnapping
  '319', '320', '323', '325', '326', '341', '342', '350', '351', '354',
  '359', '361', '363', '364A',
  // Sexual offences
  '375', '376', '377',
  // Property offences
  '378', '379', '383', '384', '390', '392', '395', '405', '406', '415', '420',
  '441', '447', '463', '464', '465', '468', '471',
  // Marriage, reputation, intimidation
  '494', '498A', '499', '500', '503', '506', '509', '511',
];

/**
 * Curated BNS 2023 core provisions (targets of the successor map plus the
 * definitional backbone). All fetched from the official India Code API.
 */
const BNS_CORE = [
  '2', '3', '61', '74', '79', '80', '85', '86', '100', '101', '103', '104',
  '105', '106', '108', '109', '114', '115', '116', '117', '137', '152', '189',
  '191', '196', '302', '303', '304', '308', '309', '316', '318', '329', '351',
  '356', '358',
];

module.exports = { IPC_CORE, BNS_CORE };
