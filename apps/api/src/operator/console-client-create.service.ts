import { Injectable } from '@nestjs/common';
import type { ConsoleClientExtract, ConsoleClientExtractInput } from '@dealflow/types';
import { PrismaService } from '../common/prisma.service';
import { CompanyEnrichmentService } from '../crm/company-enrichment.service';
import { logoDomain } from '../crm/company-logo-finder';
import { CompanyLogosService } from '../crm/company-logos.service';
import type { OperatorContext } from './operator-auth';
import { writePlatformAudit } from './platform-audit';

/** The image types a client logo may be (console-clients-profile.service.ts); other icons are left for an upload. */
const CLIENT_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Create Client's "Find company details" (control-center K2). It calls the company auto-fill engine exactly as Create
 * Company does (the company's own website, then Wikidata when switched on; rules, no AI) and the website logo finder,
 * and stores nothing: the operator reviews, corrects and approves what was found, and only then is the client created.
 */
@Injectable()
export class ConsoleClientCreateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrichment: CompanyEnrichmentService,
    private readonly logos: CompanyLogosService,
  ) {}

  async extract(op: OperatorContext, input: ConsoleClientExtractInput, ip: string | null): Promise<ConsoleClientExtract> {
    const domain = logoDomain(input.website);
    const [preview, logo] = await Promise.all([
      this.enrichment.previewForConsole(op.id, { name: input.name, website: input.website }),
      domain ? this.logos.lookUpDomain(domain) : Promise.resolve(null),
    ]);
    const found = logo?.status === 'FOUND' && CLIENT_LOGO_TYPES.has(logo.logo.contentType) ? logo.logo : null;
    await writePlatformAudit(this.prisma, {
      operatorId: op.id,
      action: 'client.details_looked_up',
      target: { type: 'company', id: domain ?? input.name, label: input.name },
      metadata: { reason: 'Create client: find company details', domain, found: preview.found.length, people: preview.people.length, logo: !!found },
      ip,
    });
    return {
      ...preview,
      domain,
      logo: found ? { contentType: found.contentType, dataUrl: `data:${found.contentType};base64,${found.data.toString('base64')}`, sourceUrl: found.sourceUrl, width: found.width } : null,
    };
  }
}
