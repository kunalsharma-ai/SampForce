import { Controller, ForbiddenException, HttpCode, Param, ParseUUIDPipe, Post, UnprocessableEntityException } from '@nestjs/common';
import { z } from '@dealflow/types';
import { Auth, type AuthContext, RequirePermissions } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { CompaniesService } from '../crm/companies.service';
import { AgentOutputError, AgentsService } from './agents.service';
import { untrusted } from './redact';

const summarySchema = z.object({ summary: z.string().trim().min(1).max(1500) });

/**
 * The AI summary on the company page (ADR 0076): a few sentences written from the company's Business Information only,
 * saved on the company and always shown labelled as AI. Nothing else on the company changes.
 */
@Controller('companies/:id')
export class CompanySummaryController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly agents: AgentsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('ai-summary')
  @HttpCode(200)
  @RequirePermissions('companies:write', 'ai:use')
  async write(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string): Promise<{ aiSummary: string; aiSummaryAt: string }> {
    const c = await this.companies.get(auth, id);
    if (c.restricted) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to do that.' });
    return this.agents.withRun(auth, 'company_summary', 'company', id, { op: 'company_summary' }, undefined, async (run) => {
      let out: z.infer<typeof summarySchema>;
      try {
        out = await this.agents.structured(auth, run, 'company_summary', 'companySummary', summarySchema, {
          company: {
            name: c.name,
            legalName: c.legalName,
            industry: c.industry,
            businessCategory: c.businessCategory,
            description: c.overview ? untrusted('website_text', c.overview) : null,
            specialties: c.specialties ? untrusted('website_text', c.specialties) : null,
            services: c.services,
            products: c.products,
            industriesServed: c.industriesServed,
            foundedYear: c.foundedYear,
            employees: c.employeeCount,
            companySize: c.companySize,
            city: c.city,
            country: c.country,
            otherOffices: c.addresses.map((a) => [a.city, a.country].filter(Boolean).join(', ')).filter(Boolean),
            ceo: c.ceo,
            parentCompany: c.parentCompanyName ?? c.parentCompany?.name ?? null,
            ownership: c.ownership,
            certifications: c.certifications,
            status: c.operatingStatus,
          },
        });
      } catch (err) {
        if (err instanceof AgentOutputError) throw new UnprocessableEntityException({ code: 'AI_OUTPUT_UNUSABLE', message: err.message });
        throw err;
      }
      const at = new Date();
      await this.prisma.run(auth, (tx) => tx.company.update({ where: { id }, data: { aiSummary: out.summary, aiSummaryAt: at } }));
      return { output: out, rec: { aiSummary: out.summary, aiSummaryAt: at.toISOString() } };
    });
  }
}
