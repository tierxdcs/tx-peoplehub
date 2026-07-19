import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ApInvoiceStatus,
  ComplianceReturnStatus,
  GstItcStatus,
  GstReturnType,
  Gstr2bMatchStatus,
  Prisma,
  SalesInvoiceStatus,
  TdsReturnQuarter,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import { FinanceAccessService } from '../finance/finance-access.service';
import { VaultStorageService } from '../vault/vault-storage.service';
import { AllocateChallanDto, CreateTdsChallanDto, DueDateDto, EvidenceUploadDto, FilingEvidenceDto, ImportGstr2bDto, SetInvoiceTdsDto, TaxPartyProfileDto, TdsPrepareDto } from './dto/filings.dto';

@Injectable()
export class FilingsService {
  constructor(private readonly prisma: PrismaService, private readonly access: FinanceAccessService, private readonly storage: VaultStorageService) {}

  async dashboard(taxPeriod: string | undefined, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const period = taxPeriod && /^\d{4}-(0[1-9]|1[0-2])$/.test(taxPeriod) ? taxPeriod : this.currentPeriod();
    const [gstReturns, tdsReturns, matches, failedSubmissions, dueDates, challans, taxProfiles] = await this.prisma.$transaction([
      this.prisma.gstReturn.findMany({ where: { taxPeriod: period }, include: { evidence: true }, orderBy: { returnType: 'asc' } }),
      this.prisma.tdsReturn.findMany({ include: { evidence: true, challanAllocations: { include: { challan: true } } }, orderBy: [{ financialYear: 'desc' }, { quarter: 'desc' }], take: 8 }),
      this.prisma.gstr2bLine.groupBy({ by: ['matchStatus'], where: { taxPeriod: period }, orderBy: { matchStatus: 'asc' }, _count: true }),
      this.prisma.gstSubmission.findMany({ where: { status: 'FAILED' }, include: { invoice: { select: { invoiceNumber: true } } }, orderBy: { updatedAt: 'desc' }, take: 25 }),
      this.prisma.complianceDueDate.findMany({ where: { completedAt: null }, orderBy: { dueDate: 'asc' }, take: 20 }),
      this.prisma.tdsChallan.findMany({ include: { allocations: true }, orderBy: { depositDate: 'desc' }, take: 20 }),
      this.prisma.taxPartyProfile.findMany({ where: { isActive: true }, orderBy: { legalName: 'asc' } }),
    ]);
    return { taxPeriod: period, gstReturns, tdsReturns, gstr2b: matches.map((x) => ({ status: x.matchStatus, count: x._count })), failedSubmissions, dueDates: dueDates.map((x) => ({ ...x, daysRemaining: Math.ceil((x.dueDate.getTime() - Date.now()) / 86400000) })), challans, taxProfiles };
  }

  async saveTaxProfile(dto: TaxPartyProfileDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const party = dto.partyType === 'SUPPLIER' ? await this.prisma.supplier.findUnique({ where: { id: dto.partyId } }) : await this.prisma.vendor.findUnique({ where: { id: dto.partyId } });
    if (!party) throw new NotFoundException(`${dto.partyType.toLowerCase()} not found`);
    return this.prisma.taxPartyProfile.upsert({ where: { partyType_partyId: { partyType: dto.partyType, partyId: dto.partyId } }, create: { ...dto, pan: dto.pan.toUpperCase(), tan: dto.tan?.toUpperCase(), certificateValidUntil: dto.certificateValidUntil ? new Date(dto.certificateValidUntil) : undefined, createdById: user.id }, update: { legalName: dto.legalName, pan: dto.pan.toUpperCase(), tan: dto.tan?.toUpperCase(), lowerDeductionCertificateNo: dto.lowerDeductionCertificateNo, lowerDeductionRate: dto.lowerDeductionRate, certificateValidUntil: dto.certificateValidUntil ? new Date(dto.certificateValidUntil) : null, isActive: true } });
  }

  async setInvoiceTds(id: string, dto: SetInvoiceTdsDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user); const invoice = await this.prisma.accountsPayableInvoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('AP invoice not found');
    if (![ApInvoiceStatus.DRAFT, ApInvoiceStatus.PENDING_MATCH, ApInvoiceStatus.MATCH_EXCEPTION, ApInvoiceStatus.REJECTED].includes(invoice.status as any)) throw new BadRequestException('TDS classification can only change before invoice approval');
    const amount = new Prisma.Decimal(dto.taxableBase).mul(dto.ratePercent).div(100).toDecimalPlaces(2);
    return this.prisma.accountsPayableInvoice.update({ where: { id }, data: { tdsSectionCode: dto.sectionCode.toUpperCase(), tdsRatePercent: dto.ratePercent, tdsTaxableBase: dto.taxableBase, tdsAmount: amount } });
  }

  async createChallan(dto: CreateTdsChallanDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user); const interest = new Prisma.Decimal(dto.interestAmount ?? 0), fee = new Prisma.Decimal(dto.feeAmount ?? 0), tax = new Prisma.Decimal(dto.taxAmount);
    const date = new Date(dto.depositDate); const challanNumber = `${dto.bsrCode}-${date.toISOString().slice(0, 10).replaceAll('-', '')}-${dto.challanSerialNo}`;
    return this.prisma.tdsChallan.create({ data: { challanNumber, bsrCode: dto.bsrCode, challanSerialNo: dto.challanSerialNo, depositDate: date, financialYear: dto.financialYear, sectionCode: dto.sectionCode.toUpperCase(), taxAmount: tax, interestAmount: interest, feeAmount: fee, totalAmount: tax.plus(interest).plus(fee), createdById: user.id } });
  }

  async allocateChallan(id: string, dto: AllocateChallanDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user); const challan = await this.prisma.tdsChallan.findUnique({ where: { id }, include: { allocations: true } });
    if (!challan) throw new NotFoundException('TDS challan not found'); const ret = await this.requireTds(dto.tdsReturnId);
    if (ret.status === 'FILED') throw new BadRequestException('A filed TDS return cannot be reallocated');
    if (dto.amount <= 0) throw new BadRequestException('Allocation amount must be positive');
    const already = challan.allocations.filter((x) => x.tdsReturnId !== dto.tdsReturnId).reduce((s, x) => s.plus(x.amount), new Prisma.Decimal(0));
    if (already.plus(dto.amount).gt(challan.totalAmount)) throw new BadRequestException('Allocation exceeds unallocated challan balance');
    return this.prisma.tdsChallanAllocation.upsert({ where: { challanId_tdsReturnId: { challanId: id, tdsReturnId: dto.tdsReturnId } }, create: { challanId: id, tdsReturnId: dto.tdsReturnId, amount: dto.amount, createdById: user.id }, update: { amount: dto.amount } });
  }

  async saveDueDate(dto: DueDateDto, user: AuthenticatedUser) { await this.access.assertAccountsHead(user); return this.prisma.complianceDueDate.upsert({ where: { obligation_taxPeriod: { obligation: dto.obligation.toUpperCase(), taxPeriod: dto.taxPeriod } }, create: { obligation: dto.obligation.toUpperCase(), taxPeriod: dto.taxPeriod, dueDate: new Date(dto.dueDate), reminderDays: dto.reminderDays ?? 5, createdById: user.id }, update: { dueDate: new Date(dto.dueDate), reminderDays: dto.reminderDays ?? 5 } }); }
  async completeDueDate(id: string, reference: string, user: AuthenticatedUser) { await this.access.assertAccountsHead(user); return this.prisma.complianceDueDate.update({ where: { id }, data: { completedAt: new Date(), completedReference: reference } }); }

  async evidenceUpload(dto: EvidenceUploadDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user); dto.returnKind === 'GST' ? await this.requireGst(dto.returnId) : await this.requireTds(dto.returnId);
    const id = randomUUID(), storageKey = `finance/compliance/${dto.returnKind.toLowerCase()}/${dto.returnId}/${id}`;
    const signed = await this.storage.createUploadUrl(storageKey, dto.contentType);
    const evidence = await this.prisma.complianceEvidence.create({ data: { id, gstReturnId: dto.returnKind === 'GST' ? dto.returnId : undefined, tdsReturnId: dto.returnKind === 'TDS' ? dto.returnId : undefined, evidenceType: dto.evidenceType.toUpperCase(), fileName: dto.fileName, contentType: dto.contentType, storageKey, uploadedById: user.id } });
    return { evidence, uploadUrl: signed.url, expiresInSeconds: signed.expiresInSeconds };
  }
  async confirmEvidence(id: string, user: AuthenticatedUser) { await this.access.assertCanUseFinance(user); const row = await this.prisma.complianceEvidence.findUnique({ where: { id } }); if (!row) throw new NotFoundException('Compliance evidence not found'); const head = await this.storage.headObject(row.storageKey); if (!head) throw new BadRequestException('Evidence upload was not found in storage'); return this.prisma.complianceEvidence.update({ where: { id }, data: { sizeBytes: head.sizeBytes, confirmedAt: new Date() } }); }
  async downloadEvidence(id: string, user: AuthenticatedUser) { await this.access.assertCanUseFinance(user); const row = await this.prisma.complianceEvidence.findUnique({ where: { id } }); if (!row?.confirmedAt) throw new NotFoundException('Confirmed compliance evidence not found'); return this.storage.createDownloadUrl(row.storageKey); }

  async prepareGst(type: GstReturnType, taxPeriod: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    this.assertPeriod(taxPeriod);
    const [year, month] = taxPeriod.split('-').map(Number);
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));
    const financialYear = month >= 4 ? `${year}-${String(year + 1).slice(-2)}` : `${year - 1}-${String(year).slice(-2)}`;
    const payload = type === GstReturnType.GSTR1
      ? await this.gstr1Payload(from, to)
      : await this.gstr3bPayload(from, to, taxPeriod);
    const summary = this.summarize(payload);
    return this.prisma.gstReturn.upsert({
      where: { returnType_taxPeriod: { returnType: type, taxPeriod } },
      create: { returnType: type, taxPeriod, financialYear, status: 'PREPARED', payload, summary, preparedById: user.id, preparedAt: new Date(), createdById: user.id },
      update: { status: 'PREPARED', payload, summary, preparedById: user.id, preparedAt: new Date(), errorMessage: null },
    });
  }

  async importGstr2b(dto: ImportGstr2bDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    if (!dto.lines.length) throw new BadRequestException('At least one GSTR-2B line is required');
    const rows = dto.lines.map((line) => ({
      taxPeriod: dto.taxPeriod, sourceChecksum: this.checksum(line), supplierGstin: line.supplierGstin.toUpperCase(),
      supplierName: line.supplierName?.trim(), invoiceNumber: line.invoiceNumber.trim(), invoiceDate: new Date(line.invoiceDate),
      taxableAmount: line.taxableAmount, cgstAmount: line.cgstAmount ?? 0, sgstAmount: line.sgstAmount ?? 0,
      igstAmount: line.igstAmount ?? 0, cessAmount: line.cessAmount ?? 0, itcAvailable: line.itcAvailable ?? true, importedById: user.id,
    }));
    const result = await this.prisma.gstr2bLine.createMany({ data: rows, skipDuplicates: true });
    return { imported: result.count, duplicates: rows.length - result.count };
  }

  async reconcileGstr2b(taxPeriod: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    this.assertPeriod(taxPeriod);
    const lines = await this.prisma.gstr2bLine.findMany({ where: { taxPeriod, matchStatus: { in: ['UNMATCHED', 'MISMATCHED'] } } });
    let matched = 0, mismatched = 0;
    for (const line of lines) {
      const invoices = await this.prisma.accountsPayableInvoice.findMany({ where: { externalInvoiceNumber: { equals: line.invoiceNumber, mode: 'insensitive' }, supplierGstinSnapshot: line.supplierGstin } });
      const invoice = invoices.length === 1 ? invoices[0] : undefined;
      const portalTax = line.cgstAmount.plus(line.sgstAmount).plus(line.igstAmount);
      const bookTax = invoice ? invoice.inputCgstAmount.plus(invoice.inputSgstAmount).plus(invoice.inputIgstAmount) : null;
      const exact = invoice && new Prisma.Decimal(invoice.taxableAmount).equals(line.taxableAmount) && bookTax?.equals(portalTax);
      const status = exact ? Gstr2bMatchStatus.MATCHED : Gstr2bMatchStatus.MISMATCHED;
      const reason = !invoice ? 'No unique AP invoice matched GSTIN and invoice number' : exact ? null : 'Taxable value or GST amount differs from purchase register';
      await this.prisma.$transaction([
        this.prisma.gstr2bLine.update({ where: { id: line.id }, data: { matchStatus: status, matchedApInvoiceId: invoice?.id, mismatchReason: reason, reconciledById: user.id, reconciledAt: new Date() } }),
        ...(invoice ? [this.prisma.accountsPayableInvoice.update({ where: { id: invoice.id }, data: { itcStatus: exact && line.itcAvailable ? GstItcStatus.MATCHED_GSTR2B : GstItcStatus.MISMATCHED, itcReconciliationNote: reason, itcReconciledById: user.id, itcReconciledAt: new Date() } })] : []),
      ]);
      exact ? matched++ : mismatched++;
    }
    return { reviewed: lines.length, matched, mismatched };
  }

  async submitGst(id: string, user: AuthenticatedUser) { return this.moveGst(id, 'PREPARED', 'PENDING_APPROVAL', { submittedById: user.id, submittedAt: new Date() }, user, false); }
  async approveGst(id: string, user: AuthenticatedUser) { await this.access.assertAccountsHead(user); const row = await this.requireGst(id); if (row.status !== 'PENDING_APPROVAL') throw new BadRequestException('GST return must be PENDING_APPROVAL'); if (row.preparedById === user.id) throw new BadRequestException('Finance Head cannot approve a GST return they prepared'); return this.prisma.gstReturn.update({ where: { id }, data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() } }); }
  async fileGst(id: string, dto: FilingEvidenceDto, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user); const row = await this.requireGst(id);
    if (row.status !== 'APPROVED' && row.status !== 'SUBMITTED') throw new BadRequestException('Only an approved/submitted GST return can be marked filed');
    return this.prisma.gstReturn.update({ where: { id }, data: { status: 'FILED', filedAt: dto.filedAt ? new Date(dto.filedAt) : new Date(), arn: dto.acknowledgementNumber, providerReference: dto.providerReference, acknowledgementData: (dto.evidence ?? {}) as Prisma.InputJsonObject, attemptCount: { increment: 1 }, lastAttemptAt: new Date() } });
  }

  async prepareTds(financialYear: string, quarter: TdsReturnQuarter, dto: TdsPrepareDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user); const range = this.quarterRange(financialYear, quarter);
    const invoices = await this.prisma.accountsPayableInvoice.findMany({ where: { invoiceDate: { gte: range.from, lt: range.to }, status: { in: [ApInvoiceStatus.APPROVED, ApInvoiceStatus.PARTIALLY_PAID, ApInvoiceStatus.PAID] }, tdsAmount: { gt: 0 } }, include: { supplier: { select: { companyName: true } }, vendor: { select: { companyName: true } } } });
    const profiles = await this.prisma.taxPartyProfile.findMany({ where: { OR: invoices.map((x) => ({ partyType: x.partyType, partyId: x.partyId })), isActive: true } }); const profileMap = new Map(profiles.map((x) => [`${x.partyType}:${x.partyId}`, x]));
    const payload = invoices.map((x) => { const profile = profileMap.get(`${x.partyType}:${x.partyId}`); return { billNumber: x.internalBillNumber, deductee: profile?.legalName ?? x.supplier?.companyName ?? x.vendor?.companyName ?? x.partyId, pan: profile?.pan, date: x.invoiceDate.toISOString().slice(0, 10), amount: (x.tdsTaxableBase ?? x.taxableAmount).toString(), sectionCode: x.tdsSectionCode, rate: x.tdsRatePercent?.toString(), tds: x.tdsAmount.toString(), dataStatus: profile?.pan && x.tdsSectionCode ? 'COMPLETE' : 'INCOMPLETE' }; });
    const total = invoices.reduce((sum, x) => sum.plus(x.tdsAmount), new Prisma.Decimal(0));
    const incomplete = payload.filter((x) => x.dataStatus === 'INCOMPLETE').length; const summary = { recordCount: payload.length, totalTds: total.toFixed(2), incompleteRecords: incomplete, warnings: incomplete ? [`${incomplete} record(s) require PAN or TDS section enrichment`] : [] };
    return this.prisma.tdsReturn.upsert({ where: { financialYear_quarter_formType: { financialYear, quarter, formType: '26Q' } }, create: { financialYear, quarter, status: 'PREPARED', summary, payload, challanDetails: (dto.challanDetails ?? {}) as Prisma.InputJsonObject, preparedById: user.id, preparedAt: new Date(), createdById: user.id }, update: { status: 'PREPARED', summary, payload, challanDetails: (dto.challanDetails ?? {}) as Prisma.InputJsonObject, preparedById: user.id, preparedAt: new Date(), errorMessage: null } });
  }

  async submitTds(id: string, user: AuthenticatedUser) { return this.moveTds(id, 'PREPARED', 'PENDING_APPROVAL', { submittedById: user.id, submittedAt: new Date() }, user, false); }
  async approveTds(id: string, user: AuthenticatedUser) { await this.access.assertAccountsHead(user); const row = await this.requireTds(id); if (row.status !== 'PENDING_APPROVAL') throw new BadRequestException('TDS return must be PENDING_APPROVAL'); if (row.preparedById === user.id) throw new BadRequestException('Finance Head cannot approve a TDS return they prepared'); return this.prisma.tdsReturn.update({ where: { id }, data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() } }); }
  async fileTds(id: string, dto: FilingEvidenceDto, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user); const row = await this.requireTds(id);
    if (row.status !== 'APPROVED') throw new BadRequestException('Only an approved TDS return can be marked filed');
    return this.prisma.tdsReturn.update({ where: { id }, data: { status: 'FILED', filedAt: dto.filedAt ? new Date(dto.filedAt) : new Date(), acknowledgementNo: dto.acknowledgementNumber, form16aEvidence: (dto.evidence ?? {}) as Prisma.InputJsonObject } });
  }

  private async moveGst(id: string, from: ComplianceReturnStatus, to: ComplianceReturnStatus, data: object, user: AuthenticatedUser, head: boolean) { head ? await this.access.assertAccountsHead(user) : await this.access.assertCanUseFinance(user); const row = await this.requireGst(id); if (row.status !== from) throw new BadRequestException(`GST return must be ${from}`); return this.prisma.gstReturn.update({ where: { id }, data: { ...data, status: to } }); }
  private async moveTds(id: string, from: ComplianceReturnStatus, to: ComplianceReturnStatus, data: object, user: AuthenticatedUser, head: boolean) { head ? await this.access.assertAccountsHead(user) : await this.access.assertCanUseFinance(user); const row = await this.requireTds(id); if (row.status !== from) throw new BadRequestException(`TDS return must be ${from}`); return this.prisma.tdsReturn.update({ where: { id }, data: { ...data, status: to } }); }
  private async requireGst(id: string) { const x = await this.prisma.gstReturn.findUnique({ where: { id } }); if (!x) throw new NotFoundException('GST return not found'); return x; }
  private async requireTds(id: string) { const x = await this.prisma.tdsReturn.findUnique({ where: { id } }); if (!x) throw new NotFoundException('TDS return not found'); return x; }
  private async gstr1Payload(from: Date, to: Date) { const invoices = await this.prisma.salesInvoice.findMany({ where: { invoiceDate: { gte: from, lt: to }, status: { in: [SalesInvoiceStatus.ISSUED, SalesInvoiceStatus.PARTIALLY_PAID, SalesInvoiceStatus.PAID, SalesInvoiceStatus.OVERDUE] } }, include: { customer: { select: { name: true } }, lines: true } }); return invoices.map((x) => ({ invoiceNumber: x.invoiceNumber, invoiceDate: x.invoiceDate.toISOString().slice(0, 10), recipient: x.customer.name, gstin: x.customerGstinSnapshot, placeOfSupply: x.placeOfSupplyStateCode, taxable: x.taxableAmount.toString(), cgst: x.cgstAmount.toString(), sgst: x.sgstAmount.toString(), igst: x.igstAmount.toString(), total: x.totalAmount.toString(), hsn: x.lines.map((l) => l.hsnSacCode) })); }
  private async gstr3bPayload(from: Date, to: Date, taxPeriod: string) { const [sales, purchases] = await Promise.all([this.prisma.salesInvoice.aggregate({ where: { invoiceDate: { gte: from, lt: to }, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'] } }, _sum: { taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true } }), this.prisma.gstr2bLine.aggregate({ where: { taxPeriod, matchStatus: 'MATCHED', itcAvailable: true }, _sum: { cgstAmount: true, sgstAmount: true, igstAmount: true } })]); return { outwardTaxableSupplies: sales._sum, eligibleItcFromMatchedGstr2b: purchases._sum, reviewRequired: true }; }
  private summarize(payload: unknown) { return Array.isArray(payload) ? { recordCount: payload.length } : payload as Prisma.InputJsonObject; }
  private checksum(x: object) { return createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
  private assertPeriod(x: string) { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(x)) throw new BadRequestException('Tax period must be YYYY-MM'); }
  private currentPeriod() { return new Date().toISOString().slice(0, 7); }
  private quarterRange(fy: string, q: TdsReturnQuarter) { if (!/^\d{4}-\d{2}$/.test(fy)) throw new BadRequestException('Financial year must be YYYY-YY'); const y = Number(fy.slice(0, 4)); const starts = { Q1: [y, 3], Q2: [y, 6], Q3: [y, 9], Q4: [y + 1, 0] } as const; const [year, month] = starts[q]; return { from: new Date(Date.UTC(year, month, 1)), to: new Date(Date.UTC(year, month + 3, 1)) }; }
}
