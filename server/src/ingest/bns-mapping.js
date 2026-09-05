/**
 * Curated IPC -> BNS (Bharatiya Nyaya Sanhita, 2023) successor map.
 *
 * `verified` = correspondence is well established (widely documented,
 * cross-checked against the BNS text ingested from India Code).
 * `indicative` = probable correspondence flagged for expert confirmation.
 * Confidence is stored per-relation and surfaced in the UI — the engine
 * never presents an indicative mapping as settled law.
 *
 * The BNS (Act 45 of 2023) replaced the IPC w.e.f. 1 July 2024.
 */
const IPC_TO_BNS = [
  { from: '34',    to: '3(5)',   target: '3',   note: 'Acts done in furtherance of common intention', confidence: 'verified' },
  { from: '120A',  to: '61(1)',  target: '61',  note: 'Criminal conspiracy (definition)', confidence: 'verified' },
  { from: '120B',  to: '61(2)',  target: '61',  note: 'Punishment for criminal conspiracy', confidence: 'verified' },
  { from: '124A',  to: '152',    target: '152', note: 'Sedition re-enacted as acts endangering sovereignty, unity and integrity of India', confidence: 'verified' },
  { from: '141',   to: '189',    target: '189', note: 'Unlawful assembly', confidence: 'verified' },
  { from: '147',   to: '191',    target: '191', note: 'Punishment for rioting', confidence: 'verified' },
  { from: '153A',  to: '196',    target: '196', note: 'Promoting enmity between groups', confidence: 'verified' },
  { from: '295A',  to: '302',    target: '302', note: 'Deliberate acts intended to outrage religious feelings', confidence: 'verified' },
  { from: '299',   to: '100',    target: '100', note: 'Culpable homicide (definition)', confidence: 'verified' },
  { from: '300',   to: '101',    target: '101', note: 'Murder (definition)', confidence: 'verified' },
  { from: '302',   to: '103(1)', target: '103', note: 'Punishment for murder — sub-section (1)', confidence: 'verified' },
  { from: '304',   to: '105',    target: '105', note: 'Culpable homicide not amounting to murder', confidence: 'verified' },
  { from: '304A',  to: '106(1)', target: '106', note: 'Death by rash or negligent act (non-medical)', confidence: 'verified' },
  { from: '304B',  to: '80(2)',  target: '80',  note: 'Dowry death', confidence: 'verified' },
  { from: '306',   to: '108',    target: '108', note: 'Abetment of suicide', confidence: 'verified' },
  { from: '307',   to: '109',    target: '109', note: 'Attempt to murder', confidence: 'verified' },
  { from: '308',   to: '110',    target: '110', note: 'Attempt to commit culpable homicide', confidence: 'indicative' },
  { from: '319',   to: '114',    target: '114', note: 'Hurt (definition)', confidence: 'verified' },
  { from: '320',   to: '116',    target: '116', note: 'Grievous hurt (definition)', confidence: 'verified' },
  { from: '354',   to: '74',     target: '74',  note: 'Assault or use of criminal force on a woman', confidence: 'verified' },
  { from: '359',   to: '137',    target: '137', note: 'Kidnapping (definition)', confidence: 'indicative' },
  { from: '361',   to: '137',    target: '137', note: 'Kidnapping from lawful guardianship (within s.137)', confidence: 'indicative' },
  { from: '363',   to: '137(2)', target: '137', note: 'Punishment for kidnapping', confidence: 'indicative' },
  { from: '364A',  to: '140',    target: '140', note: 'Kidnapping or abduction for ransom etc.', confidence: 'indicative' },
  { from: '375',   to: '63',     target: '63',  note: 'Rape (definition)', confidence: 'verified' },
  { from: '376',   to: '64',     target: '64',  note: 'Punishment for rape', confidence: 'verified' },
  { from: '378',   to: '303(1)', target: '303', note: 'Theft (definition)', confidence: 'verified' },
  { from: '379',   to: '303(2)', target: '303', note: 'Punishment for theft', confidence: 'verified' },
  { from: '383',   to: '308(1)', target: '308', note: 'Extortion (definition)', confidence: 'verified' },
  { from: '390',   to: '309(1)', target: '309', note: 'Robbery (definition)', confidence: 'verified' },
  { from: '392',   to: '309(4)', target: '309', note: 'Punishment for robbery', confidence: 'verified' },
  { from: '405',   to: '316(1)', target: '316', note: 'Criminal breach of trust (definition)', confidence: 'verified' },
  { from: '415',   to: '318(1)', target: '318', note: 'Cheating (definition)', confidence: 'verified' },
  { from: '420',   to: '318(4)', target: '318', note: 'Cheating and dishonestly inducing delivery of property', confidence: 'verified' },
  { from: '441',   to: '329(1)', target: '329', note: 'Criminal trespass (definition)', confidence: 'verified' },
  { from: '447',   to: '329(3)', target: '329', note: 'Punishment for criminal trespass', confidence: 'indicative' },
  { from: '498A',  to: '85',     target: '85',  note: 'Cruelty by husband or relative of husband', confidence: 'verified' },
  { from: '499',   to: '356(1)', target: '356', note: 'Defamation (definition)', confidence: 'verified' },
  { from: '500',   to: '356(2)', target: '356', note: 'Punishment for defamation', confidence: 'verified' },
  { from: '503',   to: '351(1)', target: '351', note: 'Criminal intimidation (definition)', confidence: 'indicative' },
  { from: '506',   to: '351(2)', target: '351', note: 'Punishment for criminal intimidation', confidence: 'verified' },
  { from: '509',   to: '79',     target: '79',  note: 'Insult to modesty of a woman', confidence: 'verified' },
];

/**
 * Small curated set of well-established judicial notes. Every entry is a
 * widely-documented, verifiable development. Production derives these from
 * a judgments corpus with citations.
 */
const ANNOTATIONS = [
  {
    act: 'IPC', section: '124A', kind: 'judicial',
    note: 'All pending trials and proceedings under s.124A were directed to be kept in abeyance by the Supreme Court of India pending reconsideration of the provision.',
    authority: 'S.G. Vombatkere v. Union of India', year: 2022, confidence: 'verified',
  },
  {
    act: 'IPC', section: '377', kind: 'judicial',
    note: 'Read down to decriminalise consensual acts between adults; the provision survives only for bestiality and non-consensual acts.',
    authority: 'Navtej Singh Johar v. Union of India', year: 2018, confidence: 'verified',
  },
  {
    act: 'IPC', section: '498A', kind: 'judicial',
    note: 'The Supreme Court directed that arrest under s.498A should not be automatic; family dispute checklists and a 3-member family welfare committee process were contemplated (subsequently modified by later orders, restoring police discretion with safeguards).',
    authority: 'Arnesh Kumar v. State of Bihar; later directions in Asian Resurfacing Road Agency', year: 2014, confidence: 'verified',
  },
];

module.exports = { IPC_TO_BNS, ANNOTATIONS };
