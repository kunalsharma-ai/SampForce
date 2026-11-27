import { randomBytes } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { nextSequenceValue, type TenantTx } from '@dealflow/database';
import type { CertificateRow, CertificateVerification } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertManager, inScope, learningCaller } from './access';
import { renderCertificatePdf } from './certificate-pdf';
import { settingsView } from './modules.service';
import { type AssignmentRec, certificateRow, type ModuleRec } from './views';

/** Letters and digits that cannot be mistaken for one another when typed from paper. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function certificateCode(): string {
  const bytes = randomBytes(12);
  let s = '';
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Certificate not found.' });

/**
 * Certificates (ADR 0097). One per assignment, issued automatically the moment a certificate-eligible module is passed;
 * the unique assignment key means a retry, a refresh or a second marker never issues another. The public verification
 * page confirms a certificate by its code and shows nothing else about the organisation.
 */
@Injectable()
export class LearningCertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  verifyUrl(code: string): string {
    return `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/verify/certificate/${encodeURIComponent(code)}`;
  }

  /** Issues the certificate for a passed assignment, once. Returns the existing one when it was issued already. */
  async issue(tx: TenantTx, a: AssignmentRec, m: ModuleRec, attemptId: string, score: number): Promise<CertificateRow> {
    const existing = await tx.learningCertificate.findUnique({ where: { assignmentId: a.id } });
    if (existing) return certificateRow(existing);
    const settings = await settingsView(tx, a.tenantId);
    const [user, category] = await Promise.all([
      tx.user.findUnique({ where: { id: a.userId }, select: { name: true } }),
      m.categoryId ? tx.learningCategory.findUnique({ where: { id: m.categoryId }, select: { name: true } }) : null,
    ]);
    const n = await nextSequenceValue(tx, `learning-certificate:${a.tenantId}`);
    const now = new Date();
    const cert = await tx.learningCertificate.create({
      data: {
        tenantId: a.tenantId,
        number: `CERT-${now.getUTCFullYear()}-${String(n).padStart(5, '0')}`,
        code: certificateCode(),
        userId: a.userId,
        moduleId: m.id,
        assignmentId: a.id,
        attemptId,
        recipientName: user?.name ?? 'Learner',
        moduleTitle: m.title,
        category: category?.name ?? null,
        score,
        completedAt: a.completedAt ?? now,
        issuerName: settings.issuerName,
        signatoryName: settings.signatoryName,
        signatoryTitle: settings.signatoryTitle,
        template: settings.template,
        accentColor: settings.accentColor,
      },
    });
    await tx.learningAssignment.update({ where: { id: a.id }, data: { certificateId: cert.id } });
    await this.notifications.send(tx, a.tenantId, [a.userId], {
      type: 'learning.certificate_issued',
      title: 'Your certificate is ready',
      body: m.title,
      link: `/app/learning/certificates?open=${cert.id}`,
      eventId: `learning.certificate:${cert.id}`,
      priority: 'HIGH',
    });
    await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: null, actorType: 'SYSTEM', action: 'learning.certificate_issued', entityType: 'learning_certificate', entityId: cert.id, metadata: { number: cert.number, userId: a.userId, moduleId: m.id } });
    return certificateRow(cert);
  }

  /** A certificate the caller may see: their own, or one of the people they manage. */
  private async visible(tx: TenantTx, auth: AuthContext, id: string) {
    const cert = await tx.learningCertificate.findFirst({ where: { id, tenantId: auth.tenantId } });
    if (!cert) throw notFound();
    if (cert.userId === auth.userId) return cert;
    const c = await learningCaller(tx, auth);
    if (!c.manager) throw notFound();
    const a = await tx.learningAssignment.findUnique({ where: { id: cert.assignmentId }, select: { workspaceNodeId: true } });
    if (!a || !inScope(c, a.workspaceNodeId)) throw notFound();
    return cert;
  }

  get(auth: AuthContext, id: string): Promise<CertificateRow & { verifyUrl: string }> {
    return this.prisma.run(auth, async (tx) => {
      const cert = await this.visible(tx, auth, id);
      return { ...certificateRow(cert), verifyUrl: this.verifyUrl(cert.code) };
    });
  }

  async pdf(auth: AuthContext, id: string): Promise<{ name: string; data: Buffer }> {
    const { cert, logo } = await this.prisma.run(auth, async (tx) => {
      const cert = await this.visible(tx, auth, id);
      const commercial = await tx.commercialSettings.findUnique({ where: { tenantId: auth.tenantId }, select: { logoDataUrl: true } });
      return { cert, logo: commercial?.logoDataUrl ?? null };
    });
    const data = await renderCertificatePdf({
      number: cert.number,
      code: cert.code,
      recipientName: cert.recipientName,
      moduleTitle: cert.moduleTitle,
      category: cert.category ?? null,
      score: cert.score,
      completedAt: cert.completedAt,
      issuedAt: cert.issuedAt,
      issuerName: cert.issuerName,
      signatoryName: cert.signatoryName ?? null,
      signatoryTitle: cert.signatoryTitle ?? null,
      template: cert.template as 'CLASSIC',
      accentColor: cert.accentColor,
      logoDataUrl: logo,
      verifyUrl: this.verifyUrl(cert.code),
      revoked: !!cert.revokedAt,
    });
    return { name: `${cert.number} ${cert.moduleTitle}.pdf`.replace(/[\\/:*?"<>|]+/g, ' '), data };
  }

  /** Certificates of the people the caller manages (the Super Workspace: everyone). */
  team(auth: AuthContext): Promise<CertificateRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      assertManager(c);
      const certs = await tx.learningCertificate.findMany({ where: { tenantId: auth.tenantId }, orderBy: { issuedAt: 'desc' }, take: 2000 });
      if (c.scope === null) return certs.map(certificateRow);
      const assignments = await tx.learningAssignment.findMany({ where: { tenantId: auth.tenantId, id: { in: certs.map((x) => x.assignmentId) } }, select: { id: true, workspaceNodeId: true } });
      const nodeOf = new Map(assignments.map((a) => [a.id, a.workspaceNodeId ?? null]));
      return certs.filter((x) => inScope(c, nodeOf.get(x.assignmentId))).map(certificateRow);
    });
  }

  revoke(auth: AuthContext, id: string, revoked: boolean, meta: RequestMeta): Promise<CertificateRow> {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      if (!c.configure) throw notFound();
      const cert = await tx.learningCertificate.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!cert) throw notFound();
      const updated = await tx.learningCertificate.update({ where: { id }, data: { revokedAt: revoked ? new Date() : null } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: revoked ? 'learning.certificate_revoked' : 'learning.certificate_restored', entityType: 'learning_certificate', entityId: id, metadata: { number: cert.number }, meta });
      return certificateRow(updated);
    });
  }

  /** The public check of a certificate code: valid or not, and the few facts printed on it. */
  async verify(code: string): Promise<CertificateVerification> {
    const clean = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(clean)) return { valid: false };
    const cert = await this.prisma.run({ lookup: { LearningCertificate: { code: clean } } }, (tx) => tx.learningCertificate.findUnique({ where: { code: clean } }));
    if (!cert) return { valid: false };
    return {
      valid: !cert.revokedAt,
      number: cert.number,
      recipientName: cert.recipientName,
      moduleTitle: cert.moduleTitle,
      score: cert.score,
      completedAt: cert.completedAt.toISOString(),
      issuerName: cert.issuerName,
      revoked: !!cert.revokedAt,
    };
  }
}
