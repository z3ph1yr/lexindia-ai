/** Markdown rendering of the structured answer (for the text field / compat). */

function toMarkdown(structured) {
  const parts = [structured.directAnswer, '', '**Applicable law**', ''];
  for (const card of structured.applicableLaw || []) {
    const marker = /^(IPC|BNS)/.test(card.provision) ? ` [${card.provision}]` : '';
    parts.push(`**${card.provision} — ${card.title}** _(${card.status})_${marker}`);
    for (const q of card.quote || []) parts.push(`> ${q}`);
    if (card.penalty) parts.push(`Penalty: ${card.penalty}`);
  }
  parts.push('', '**Explanation**', '', structured.explanation || '');
  if (structured.caveats && structured.caveats.length) {
    parts.push('', '**Caveats**', '', ...structured.caveats.map((c) => `- ${c}`));
  }
  return parts.join('\n\n');
}

module.exports = { toMarkdown };
