const fs = require('fs');
const { extractProvisionTexts, ensureOfficialPdf } = require('./verify-pdf');
const { PDFParse } = require('pdf-parse');
const { similarity } = require('./normalize');
const snapshot = JSON.parse(fs.readFileSync('data/raw/ipc-1860.json', 'utf8'));

(async () => {
  const f = await ensureOfficialPdf({ log: () => {} });
  const parser = new PDFParse({ data: fs.readFileSync(f) });
  const d = await parser.getText();
  await parser.destroy();
  const regions = extractProvisionTexts(d.text || '');
  for (const no of ['21', '4', '5', '20', '19', '10']) {
    const s = snapshot.find((x) => String(x.Section) === no);
    const region = regions.get(no) || '';
    console.log('=== Section ' + no, 'sim', region ? similarity(region, s.section_desc).toFixed(3) : 'n/a');
    console.log('REGION:', JSON.stringify(region.slice(0, 300)));
    console.log('SNAP:  ', JSON.stringify(s.section_desc.slice(0, 200)));
  }
})().catch((e) => console.log('ERR', e.message));
