const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'docs', 'HR_ONBOARDING_PLAYBOOK.md');
const outputPath = path.join(root, 'docs', 'HR_Onboarding_Playbook.pdf');
const logoPath = path.join(root, 'src', 'assets', 'letterhead-logo.png');

const C = {
  navy: '#071426',
  blue: '#2463EB',
  paleBlue: '#EDF4FF',
  teal: '#0F9F78',
  paleTeal: '#EAF8F3',
  amber: '#D97706',
  paleAmber: '#FFF6E7',
  red: '#C2413B',
  ink: '#13213A',
  muted: '#63708A',
  line: '#D9E1EC',
  paper: '#FFFFFF',
  panel: '#F6F8FB',
};

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 58, right: 52, bottom: 58, left: 52 },
  info: {
    Title: 'HR Playbook — Requisition to Onboarding Complete',
    Author: 'Phaze Dynamics',
    Subject: 'ERP operating playbook for the HR hiring and onboarding workflow',
  },
  bufferPages: true,
});
doc.pipe(fs.createWriteStream(outputPath));

const pageWidth = 595.28;
const contentWidth = pageWidth - 104;

function roundedPanel(x, y, w, h, fill, stroke = C.line, radius = 8) {
  doc.roundedRect(x, y, w, h, radius).fillAndStroke(fill, stroke);
}

function footer(pageNumber) {
  // Keep the footer inside PDFKit's bottom margin; drawing below it causes the
  // text wrapper to append a new page for every footer.
  const bottom = 775;
  doc.save();
  doc.moveTo(52, bottom - 25).lineTo(pageWidth - 52, bottom - 25).strokeColor(C.line).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(C.muted)
    .text('PHAZE ERP · HR OPERATING PLAYBOOK', 52, bottom - 15, { width: 300, lineBreak: false });
  doc.text(String(pageNumber), pageWidth - 82, bottom - 15, { width: 30, align: 'right', lineBreak: false });
  doc.restore();
}

function ensure(height) {
  if (doc.y + height > 755) doc.addPage();
}

function title(text, level = 1) {
  if (process.env.DEBUG_PDF) {
    console.error(`page=${doc._pageBuffer.length} y=${Math.round(doc.y)} heading=${text}`);
  }
  const styles = {
    1: { size: 20, color: C.navy, before: 12, after: 8 },
    2: { size: 15, color: C.navy, before: 14, after: 6 },
    3: { size: 11, color: C.blue, before: 10, after: 4 },
  };
  const s = styles[level] || styles[3];
  ensure(s.size + s.before + 16);
  doc.moveDown(s.before / 12);
  if (level === 2) {
    doc.rect(52, doc.y + 2, 4, 16).fill(C.blue);
    doc.x = 64;
  }
  doc.font('Helvetica-Bold').fontSize(s.size).fillColor(s.color)
    .text(text, { width: level === 2 ? contentWidth - 12 : contentWidth });
  doc.x = 52;
  doc.moveDown(s.after / 12);
}

function paragraph(text, options = {}) {
  ensure(30);
  const labelMatch = text.match(/^\*\*(.+?):\*\*\s*(.*)$/);
  if (labelMatch) {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.ink).text(`${labelMatch[1]}: `, {
      continued: true,
    });
    doc.font('Helvetica').text(labelMatch[2], { width: contentWidth });
  } else {
    const clean = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
    doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(options.size || 9.5).fillColor(options.color || C.ink)
      .text(clean, { width: contentWidth, lineGap: 2.5 });
  }
  doc.moveDown(0.45);
}

function bullet(text, numbered = false, index = 1, checked = null) {
  const clean = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
  const h = doc.heightOfString(clean, { width: contentWidth - 30, lineGap: 2 });
  ensure(h + 8);
  const y = doc.y;
  if (checked !== null) {
    doc.rect(56, y + 1, 9, 9).strokeColor(C.blue).stroke();
  } else if (numbered) {
    doc.circle(61, y + 5, 7).fill(C.blue);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.paper)
      .text(String(index), 56, y + 1.5, { width: 10, align: 'center' });
  } else {
    doc.circle(61, y + 5, 2.2).fill(C.teal);
  }
  doc.font('Helvetica').fontSize(9.2).fillColor(C.ink)
    .text(clean, 75, y, { width: contentWidth - 23, lineGap: 2 });
  doc.x = 52;
  doc.moveDown(0.35);
}

function callout(titleText, body, tone = 'blue') {
  const palette = tone === 'amber'
    ? [C.paleAmber, C.amber]
    : tone === 'teal'
      ? [C.paleTeal, C.teal]
      : [C.paleBlue, C.blue];
  const bodyHeight = doc.heightOfString(body, { width: contentWidth - 40, lineGap: 2 });
  const h = Math.max(56, bodyHeight + 34);
  ensure(h + 8);
  const y = doc.y;
  roundedPanel(52, y, contentWidth, h, palette[0], palette[1]);
  doc.circle(70, y + 21, 8).fill(palette[1]);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(palette[1])
    .text(titleText, 86, y + 13, { width: contentWidth - 48 });
  doc.font('Helvetica').fontSize(8.8).fillColor(C.ink)
    .text(body, 70, y + 31, { width: contentWidth - 36, lineGap: 2 });
  doc.y = y + h + 10;
  doc.x = 52;
}

function table(rows) {
  if (!rows.length) return;
  const cols = rows[0].length;
  const widths = cols === 2 ? [150, contentWidth - 150] : Array(cols).fill(contentWidth / cols);
  const cleanRows = rows.filter((r, i) => !(i === 1 && r.every((v) => /^:?-+:?$/.test(v))));
  for (let ri = 0; ri < cleanRows.length; ri += 1) {
    const row = cleanRows[ri];
    const heights = row.map((cell, ci) => doc.heightOfString(cell, { width: widths[ci] - 14, lineGap: 1.5 }));
    const h = Math.max(25, Math.max(...heights) + 14);
    ensure(h + 2);
    const y = doc.y;
    let x = 52;
    for (let ci = 0; ci < cols; ci += 1) {
      doc.rect(x, y, widths[ci], h)
        .fillAndStroke(ri === 0 ? C.navy : ri % 2 ? C.paper : C.panel, C.line);
      doc.font(ri === 0 ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(ri === 0 ? 8.4 : 8.1)
        .fillColor(ri === 0 ? C.paper : C.ink)
        .text(row[ci].replace(/\*\*/g, ''), x + 7, y + 7, { width: widths[ci] - 14, lineGap: 1.5 });
      x += widths[ci];
    }
    doc.y = y + h;
  }
  doc.moveDown(0.7);
}

function flowDiagram() {
  ensure(180);
  const y = doc.y;
  roundedPanel(52, y, contentWidth, 172, C.panel);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.navy)
    .text('CONTROLLED HIRING LIFECYCLE', 68, y + 15);
  const steps = [
    ['1', 'Authorise', 'Requisition\nVertical → CEO'],
    ['2', 'Recruit', 'Post · Interview\nSelect applicant'],
    ['3', 'Offer', 'Draft · Approve\nSend · Accept'],
    ['4', 'Onboard', 'Employee · Payroll\nVault record'],
    ['5', 'Activate', 'Access · Role\nProvisioning'],
  ];
  const boxW = 82;
  const gap = 13;
  steps.forEach((s, i) => {
    const x = 68 + i * (boxW + gap);
    if (i) {
      doc.moveTo(x - gap + 2, y + 91).lineTo(x - 3, y + 91).strokeColor(C.blue).lineWidth(1.5).stroke();
      doc.polygon([x - 3, y + 91], [x - 8, y + 87], [x - 8, y + 95]).fill(C.blue);
    }
    roundedPanel(x, y + 48, boxW, 88, i === 4 ? C.paleTeal : C.paper, i === 4 ? C.teal : C.line, 7);
    doc.circle(x + 18, y + 66, 10).fill(i === 4 ? C.teal : C.blue);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.paper)
      .text(s[0], x + 13, y + 62, { width: 10, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(8.7).fillColor(C.navy)
      .text(s[1], x + 8, y + 83, { width: boxW - 16, align: 'center' });
    doc.font('Helvetica').fontSize(7.2).fillColor(C.muted)
      .text(s[2], x + 6, y + 100, { width: boxW - 12, align: 'center', lineGap: 1.5 });
  });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.red)
    .text('GATES:', 68, y + 146, { continued: true });
  doc.font('Helvetica').fillColor(C.ink)
    .text(' approved requisition + approved offer + recorded acceptance', { width: 390 });
  doc.y = y + 185;
}

function screenGuide(kind) {
  ensure(205);
  const y = doc.y;
  const h = 192;
  roundedPanel(52, y, contentWidth, h, '#17191D', '#333842', 10);
  doc.rect(52, y, contentWidth, 28).fill('#20242B');
  doc.circle(67, y + 14, 3).fill('#F87171');
  doc.circle(78, y + 14, 3).fill('#FBBF24');
  doc.circle(89, y + 14, 3).fill('#34D399');
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#E5E7EB')
    .text('SCREEN GUIDE · based on current ERP layout', 105, y + 9);

  if (kind === 'requisition') {
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#F8FAFC').text('Candidate Requisitions', 68, y + 42);
    doc.roundedRect(401, y + 39, 124, 24, 5).fill(C.blue);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.paper).text('+  Submit requisition', 413, y + 47);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#E5E7EB').text('Requisition Register', 68, y + 76);
    ['Reference', 'Position', 'Requester', 'Approval', 'Hiring status', 'Action'].forEach((v, i) =>
      doc.font('Helvetica').fontSize(6.7).fillColor('#9CA3AF').text(v, 68 + i * 75, y + 98));
    doc.rect(68, y + 111, 456, 45).fill('#23262C');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#F3F4F6').text('REQ-2026-0002', 76, y + 121);
    doc.font('Helvetica').text('Design Engineer', 143, y + 121);
    doc.roundedRect(292, y + 118, 94, 17, 8).fill('#7C4A03');
    doc.fillColor('#FCD34D').text('PENDING APPROVAL', 302, y + 123);
    doc.roundedRect(461, y + 117, 52, 20, 4).fill('#101216');
    doc.fillColor('#E5E7EB').text('View', 478, y + 123);
    doc.fillColor('#93C5FD').font('Helvetica-Bold').text('① Start here', 413, y + 68);
    doc.fillColor('#A7F3D0').text('② Track every request here', 68, y + 169);
  } else if (kind === 'offer') {
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#F8FAFC').text('Offer Letters', 68, y + 42);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#E5E7EB').text('Offer Register', 68, y + 73);
    doc.rect(68, y + 93, 456, 48).fill('#23262C');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#F3F4F6').text('PD/HR/2026/DE', 76, y + 108);
    doc.font('Helvetica').text('Zeeshan', 165, y + 108);
    doc.roundedRect(273, y + 104, 105, 18, 9).fill('#7C4A03');
    doc.fillColor('#FCD34D').text('PENDING VERTICAL', 283, y + 109);
    doc.roundedRect(397, y + 101, 116, 24, 5).fill(C.blue);
    doc.fillColor(C.paper).font('Helvetica-Bold').text('Review & approve', 411, y + 109);
    doc.roundedRect(68, y + 151, 456, 25, 5).fill('#202A37');
    doc.fillColor('#93C5FD').text('Approval is internal  •  Candidate answer is tracked separately', 82, y + 159);
  } else if (kind === 'onboard') {
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#F8FAFC').text('Onboard Employee', 68, y + 42);
    const labels = ['Personal', 'Employment', 'Compensation', 'Statutory', 'Banking'];
    labels.forEach((v, i) => {
      const x = 68 + i * 91;
      doc.circle(x + 8, y + 80, 8).fill(i < 2 ? C.teal : '#374151');
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(i < 2 ? '#A7F3D0' : '#9CA3AF')
        .text(v, x - 9, y + 95, { width: 55, align: 'center' });
    });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#E5E7EB').text('Vertical', 68, y + 124);
    doc.roundedRect(68, y + 139, 220, 28, 5).fill('#111317');
    doc.font('Helvetica').fontSize(8).fillColor('#E5E7EB').text('Production  (locked)', 80, y + 149);
    doc.fillColor('#93C5FD').font('Helvetica-Bold').text('Inherited from the requisition; locked', 305, y + 149);
  } else if (kind === 'attendance') {
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#F8FAFC').text('My Attendance', 68, y + 42);
    doc.roundedRect(68, y + 73, 135, 53, 7).fill('#23262C');
    doc.font('Helvetica').fontSize(7).fillColor('#9CA3AF').text('TODAY', 82, y + 84);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#F8FAFC').text('Not checked in', 82, y + 101);
    doc.roundedRect(385, y + 80, 126, 34, 6).fill(C.blue);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.paper).text('Check In', 424, y + 92);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#E5E7EB').text('Attendance Corrections', 68, y + 146);
    doc.roundedRect(214, y + 139, 132, 28, 5).fill('#111317');
    doc.font('Helvetica').fontSize(8).fillColor('#E5E7EB').text('Employee + date + times', 225, y + 149);
    doc.fillColor('#FCD34D').font('Helvetica-Bold').text('Admin / HR Manager · audited', 365, y + 149);
  } else {
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#F8FAFC').text('Payroll Runs', 68, y + 42);
    doc.roundedRect(397, y + 39, 127, 24, 5).fill(C.blue);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.paper).text('+  New Payroll Run', 412, y + 47);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#E5E7EB').text('September 2026', 68, y + 77);
    doc.roundedRect(174, y + 72, 58, 18, 9).fill('#374151');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#D1D5DB').text('DRAFT', 191, y + 78);
    doc.roundedRect(68, y + 103, 139, 30, 5).fill(C.blue);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.paper).text('Process Payroll', 89, y + 114);
    doc.fillColor('#93C5FD').text('① All active employees', 232, y + 111);
    doc.fillColor('#A7F3D0').text('② Review every payslip', 232, y + 129);
    doc.rect(68, y + 148, 456, 26).fill('#23262C');
    doc.font('Helvetica').fontSize(7.4).fillColor('#E5E7EB')
      .text('DRAFT  →  PROCESSING  →  COMPLETED', 82, y + 157);
    doc.fillColor('#FCD34D').font('Helvetica-Bold').text('LOCK only after reconciliation', 352, y + 157);
  }
  doc.y = y + h + 12;
  doc.x = 52;
}

// Cover
doc.rect(0, 0, pageWidth, 841.89).fill(C.navy);
if (fs.existsSync(logoPath)) doc.image(logoPath, 52, 50, { fit: [170, 70] });
doc.font('Helvetica-Bold').fontSize(11).fillColor('#93C5FD')
  .text('PHAZE ERP · HR OPERATING PLAYBOOK', 52, 155);
doc.font('Helvetica-Bold').fontSize(32).fillColor(C.paper)
  .text('Requisition to\nOnboarding Complete', 52, 190, { width: 430, lineGap: 4 });
doc.font('Helvetica').fontSize(13).fillColor('#CBD5E1')
  .text('A controlled, step-by-step guide for authorising a hire, recruiting, issuing the offer, creating the employee record, activating access and completing joining provisions.', 52, 295, { width: 440, lineGap: 5 });
doc.roundedRect(52, 410, 448, 124, 12).fill('#0F223D');
doc.font('Helvetica-Bold').fontSize(10).fillColor('#67E8F9').text('THE THREE DEFINING EVENTS', 72, 431);
const coverRules = [
  ['SELECTED', 'HR chose an applicant for an offer — not yet hired.'],
  ['ACCEPTED', 'The candidate accepted a fully approved offer — onboarding unlocks.'],
  ['FULFILLED', 'The Employee record was created — the requisition is complete.'],
];
coverRules.forEach((r, i) => {
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.paper).text(r[0], 72, 457 + i * 23, { width: 72 });
  doc.font('Helvetica').fillColor('#CBD5E1').text(r[1], 148, 457 + i * 23, { width: 330 });
});
doc.font('Helvetica').fontSize(9).fillColor('#94A3B8')
  .text('Version 1.0 · Generated from the implemented ERP workflow', 52, 760);

doc.addPage();
title('How to use this playbook', 1);
paragraph('Follow the numbered procedure in sequence. Blue screen guides show where the action lives. Amber callouts are control gates; green callouts mark completion evidence. Use the checklists before handing work to the next owner.');
flowDiagram();
callout('Non-negotiable control', 'Do not create a genuine new hire through Administration → Create Employee. That shortcut bypasses the requisition, candidate, offer, acceptance and full HR onboarding controls.', 'amber');

const lines = fs.readFileSync(sourcePath, 'utf8').split(/\r?\n/);
let i = 1; // Skip source H1; cover replaces it.
let numbered = 0;
while (i < lines.length) {
  const raw = lines[i];
  const line = raw.trim();
  if (!line || line === '---') { i += 1; continue; }
  if (/^\|/.test(line)) {
    const rows = [];
    while (i < lines.length && /^\|/.test(lines[i].trim())) {
      rows.push(lines[i].trim().slice(1, -1).split('|').map((v) => v.trim()));
      i += 1;
    }
    table(rows);
    continue;
  }
  const h = line.match(/^(#{2,4})\s+(.+)$/);
  if (h) {
    const text = h[2];
    title(text, h[1].length - 1);
    if (text === '1. Raise the requisition') screenGuide('requisition');
    if (text === '5. Draft the offer') screenGuide('offer');
    if (text === '8. Onboard the accepted candidate') screenGuide('onboard');
    if (text === '11. Employee check-in and check-out') screenGuide('attendance');
    if (text === '13. Payroll operations') screenGuide('payroll');
    numbered = 0;
    i += 1;
    continue;
  }
  const check = line.match(/^- \[[ xX]\]\s+(.+)$/);
  if (check) { bullet(check[1], false, 1, false); i += 1; continue; }
  const b = line.match(/^-\s+(.+)$/);
  if (b) { bullet(b[1]); i += 1; continue; }
  const n = line.match(/^\d+\.\s+(.+)$/);
  if (n) { numbered += 1; bullet(n[1], true, numbered); i += 1; continue; }
  if (line.startsWith('`') && line.endsWith('`')) {
    callout('Lifecycle', line.slice(1, -1), 'teal');
    i += 1;
    continue;
  }
  paragraph(line);
  i += 1;
}

doc.addPage();
title('HR hand-off record', 1);
paragraph('Use this one-page record during the final hand-off. Store it according to the company’s HR records policy; do not place bank or statutory values on this page.');
const fields = [
  'Requisition number', 'Position / vertical', 'Selected candidate', 'Offer reference',
  'Vertical approval', 'CEO approval', 'Offer sent date', 'Acceptance date',
  'Employee ID', 'Official email', 'Access granted by / date', 'Provisioning owner',
];
fields.forEach((f) => {
  ensure(35);
  const rowY = doc.y;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.muted).text(f, 52, rowY + 4, { width: 150 });
  doc.moveTo(205, rowY + 14).lineTo(535, rowY + 14).strokeColor(C.line).stroke();
  doc.y = rowY + 30;
});
callout('Completion declaration', 'I have verified that the accepted offer, employee record, vertical assignment, access activation and required joining provisions agree with the approved requisition.', 'teal');
doc.moveDown(1);
paragraph('HR owner: __________________________    Date: __________________    Signature: __________________________');

const range = doc.bufferedPageRange();
if (process.env.DEBUG_PDF) console.error(`pages-before-footer=${range.count}`);
for (let page = range.start; page < range.start + range.count; page += 1) {
  doc.switchToPage(page);
  footer(page + 1);
}
doc.end();
console.log(outputPath);
