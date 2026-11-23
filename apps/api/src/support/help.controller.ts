import { Controller, Get, Query } from '@nestjs/common';
import {
  categoriesFor,
  faqsFor,
  guidesFor,
  type HelpGuide,
  type HelpReader,
  type HelpTopic,
  helpText,
  searchHelp,
} from '@dealflow/help';
import type { LanguageCode } from '@dealflow/types';
import { z } from 'zod';
import { Auth, type AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { requestLanguage } from '../common/request-language';
import { ZodPipe } from '../common/zod.pipe';
import { resolveWorkspaceAccess } from '../workspaces/access';

const helpQuerySchema = z.object({ q: z.string().trim().max(120).optional() });

/**
 * The Help Center for the signed-in person (ADR 0073): categories, questions and feature guides in their language,
 * already narrowed to what their plan, workspace level and role let them use. The mobile app reads this; the web app
 * applies the same rules from @dealflow/help with the session it already has.
 */
@Controller('help')
export class HelpController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async help(@Auth() auth: AuthContext, @Query(new ZodPipe(helpQuerySchema)) query: z.output<typeof helpQuerySchema>) {
    const access = await this.prisma.run(auth, (tx) => resolveWorkspaceAccess(tx, auth.tenantId, auth.workspaceNodeId ?? null));
    const reader: HelpReader = { audience: 'workspace', features: access.features, level: access.level, permissions: auth.permissions };
    const language = requestLanguage();
    const faqs = faqsFor(reader);
    const guides = guidesFor(reader);
    const text = (t: HelpTopic) => ({ title: t.title, what: helpText(t.what, language), how: helpText(t.how, language), where: helpText(t.where, language) });
    return {
      language,
      level: access.level,
      categories: categoriesFor(reader, faqs, guides).map((c) => ({ id: c.id, icon: c.icon, tone: c.tone, title: helpText(c.title, language), description: helpText(c.description, language) })),
      faqs: faqs.map((q) => ({ id: q.id, category: q.category, question: helpText(q.q, language), answer: helpText(q.a, language), guide: q.guide ?? null })),
      guides: guides.map((g: HelpGuide) => ({ id: g.id, category: g.category, href: g.href ?? null, ...text(g.topic), sections: g.sections.map((s) => ({ id: s.id, ...text(s.topic) })) })),
      results: query.q ? searchHelp(query.q, language as LanguageCode, { faqs, guides }).map((h) => ({ kind: h.kind, id: h.kind === 'faq' ? h.faq.id : h.guide.id })) : null,
    };
  }
}
