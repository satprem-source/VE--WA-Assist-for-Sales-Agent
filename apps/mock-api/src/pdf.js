/**
 * Renders an indicative benefit illustration PDF with a diagonal watermark
 * on every page. Production BIs come from the insurer; this exists so the
 * WhatsApp document flow can be demoed end to end.
 */
import PDFDocument from 'pdfkit';
import { inr, headline } from '@nb/shared';

// Built-in PDF fonts have no ₹ glyph.
const rs = (n, compact = false) => inr(n, { compact }).replace('₹', 'Rs. ');

function watermark(doc, textLine) {
  const { x, y } = doc;
  doc.save();
  doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.fontSize(34).fillColor('#C0392B').opacity(0.12)
    .text(textLine, 0, doc.page.height / 2 - 20, { width: doc.page.width, align: 'center' });
  doc.restore();
  doc.opacity(1).fillColor('#1B2430');
  doc.x = x;
  doc.y = y;
}

function table(doc, headers, rows, widths) {
  const x0 = doc.page.margins.left;
  let y = doc.y;
  const rowH = 16;
  const drawRow = (cells, bold) => {
    if (y + rowH > doc.page.height - doc.page.margins.bottom - 30) { doc.addPage(); y = doc.page.margins.top; drawRow(headers, true); }
    let x = x0;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    cells.forEach((c, i) => { doc.text(String(c), x + 3, y + 4, { width: widths[i] - 6, align: i === 0 ? 'left' : 'right' }); x += widths[i]; });
    doc.moveTo(x0, y + rowH).lineTo(x0 + widths.reduce((a, b) => a + b, 0), y + rowH).strokeColor('#D7DDE3').lineWidth(0.5).stroke();
    y += rowH;
  };
  drawRow(headers, true);
  rows.forEach((r) => drawRow(r, false));
  doc.x = x0;
  doc.y = y + 8;
}

function scenarioTable(doc, sc) {
  if (!sc.rows?.length) return;
  const hasFund = sc.rows[0].fundValue !== undefined;
  const hasIncome = sc.rows[0].survivalBenefit !== undefined;
  const hasAnnuity = sc.rows[0].annuityPayout !== undefined;
  const headers = ['Year', 'Age', 'Premiums paid'];
  if (hasFund) headers.push('Fund value');
  if (hasIncome) headers.push('Income / survival');
  if (hasAnnuity) headers.push('Annuity payout');
  headers.push('Death benefit');
  if (sc.rows[0].surrenderValue !== undefined) headers.push('Surrender value');
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const widths = headers.map((_, i) => (i < 2 ? 38 : (width - 76) / (headers.length - 2)));
  const rows = sc.rows.map((r) => {
    const cells = [r.year, r.age, rs(r.premiumPaid)];
    if (hasFund) cells.push(rs(r.fundValue));
    if (hasIncome) cells.push(rs(r.survivalBenefit));
    if (hasAnnuity) cells.push(rs(r.annuityPayout));
    cells.push(rs(r.deathBenefit));
    if (r.surrenderValue !== undefined) cells.push(rs(r.surrenderValue));
    return cells;
  });
  table(doc, headers, rows, widths);
}

export function renderIllustrationPdf(bi, lead, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `${bi.illustrationId} ${bi.productName}`, Author: 'NB WhatsApp prototype' } });
  doc.pipe(res);
  doc.on('pageAdded', () => watermark(doc, bi.watermark));
  watermark(doc, bi.watermark);

  doc.font('Helvetica-Bold').fontSize(16).text('Benefit illustration (indicative)');
  doc.font('Helvetica').fontSize(9).fillColor('#5E6B7A').text(`${bi.illustrationId}  |  Generated ${new Date(bi.generatedAt).toLocaleString('en-IN')}`);
  doc.moveDown(0.6).fillColor('#1B2430');

  doc.font('Helvetica-Bold').fontSize(12).text(`${bi.insurer} ${bi.productName}`);
  doc.font('Helvetica').fontSize(9).text(`UIN: ${bi.uin}`);
  if (lead) doc.text(`Prepared for: ${lead.name}`);
  doc.moveDown(0.5);

  const h = headline(bi);
  const i = bi.inputs;
  const facts = [
    ['Age at entry', i.age],
    ['Premium', `${rs(bi.premium.modal)} (${bi.premium.frequency}), ${bi.premium.taxNote}`],
    i.sumAssured ? ['Life cover', rs(i.sumAssured)] : null,
    i.policyTerm ? ['Policy term', `${i.policyTerm} years`] : null,
    i.premiumPayingTerm ? ['Premium paying term', `${i.premiumPayingTerm} years`] : null,
    h.maturityGuaranteed ? ['Maturity benefit', `${rs(h.maturityGuaranteed)} (guaranteed, IRR ${h.irrGuaranteed ?? '—'}%)`] : null,
    h.maturityAt8 != null ? ['Maturity value', `${rs(h.maturityAt4)} at 4%  |  ${rs(h.maturityAt8)} at 8%`] : null,
    h.annualAnnuity ? ['Annuity', `${rs(h.annualAnnuity)} a year for life`] : null,
  ].filter(Boolean);
  facts.forEach(([k, v]) => { doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(String(v)); });
  doc.moveDown(0.8);

  const blocks = bi.components ? bi.components.map((c) => ({ title: `${c.productName} (UIN ${c.uin})`, scenarios: c.scenarios, premium: c.annualPremium })) : [{ title: null, scenarios: bi.scenarios }];
  for (const b of blocks) {
    if (b.title) { doc.font('Helvetica-Bold').fontSize(11).text(b.title); doc.font('Helvetica').fontSize(9).text(`Component yearly premium: ${rs(b.premium)}`); doc.moveDown(0.3); }
    for (const sc of b.scenarios) {
      doc.font('Helvetica-Bold').fontSize(10).text(sc.label + (sc.irr != null ? `  (IRR ${sc.irr}%)` : ''));
      if (sc.note) doc.font('Helvetica').fontSize(9).text(sc.note);
      doc.moveDown(0.2);
      scenarioTable(doc, sc);
    }
  }

  doc.moveDown(0.5).font('Helvetica-Bold').fontSize(9).text('Important');
  doc.font('Helvetica').fontSize(8).fillColor('#5E6B7A');
  [bi.disclaimer, ...(bi.notes || []), 'A benefit illustration signed by the proposer is required with the proposal form. This document is not that illustration.']
    .forEach((line) => doc.text(`• ${line}`, { paragraphGap: 3 }));
  doc.end();
}
