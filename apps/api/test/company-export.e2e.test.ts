import type { INestApplication } from '@nestjs/common';
import { Workbook, type Worksheet } from 'exceljs';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/** Company export to Excel and CSV (ADR 0079): every stored field, employees, branches, interactions, filters and rights. */
describe('company export', () => {
  let app: INestApplication;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let acmeId: string;
  let otherId: string;

  const binary = (req: ReturnType<ReturnType<typeof api>['get']>) =>
    req.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  const workbook = async (res: Response) => {
    const wb = new Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    return wb;
  };
  /** Rows of a sheet as objects keyed by header text. */
  const records = (ws: Worksheet) => {
    const headers = (ws.getRow(1).values as unknown[]).slice(1).map(String);
    const out: Record<string, unknown>[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const values = (row.values as unknown[]).slice(1);
      out.push(Object.fromEntries(headers.map((h, i) => {
        const v = values[i];
        return [h, v && typeof v === 'object' && 'text' in v ? (v as { text: string }).text : (v ?? null)];
      })));
    });
    return { headers, rows: out };
  };
  const csvRows = (text: string) => {
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split(/\r\n/);
    return { header: lines[0]!, lines: lines.slice(1) };
  };

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Export Research');
    http = api(owner);
    await http.post('/custom-fields', { entity: 'COMPANY', key: 'panel_size', label: 'Panel size', type: 'TEXT' }).expect(201);
    await http.post('/custom-fields', { entity: 'CONTACT', key: 'met_at', label: 'Met at', type: 'TEXT' }).expect(201);
    const acme = (
      await http
        .post('/companies', {
          name: 'Acme Panels',
          legalName: 'Acme Panels Private Limited',
          industry: 'Market research',
          businessCategory: 'Fieldwork',
          overview: 'Online panels across India.',
          specialties: 'B2B panels',
          services: ['Online surveys', 'CATI'],
          products: ['Acme Pulse'],
          industriesServed: ['Healthcare', 'Automotive'],
          foundedYear: 2009,
          employeeCount: 240,
          companySize: '201-500',
          companyType: 'Private',
          branchCount: 3,
          parentCompanyName: 'Acme Holdings',
          ownership: 'Privately held',
          founders: ['Ravi Mehta', 'Anita Rao'],
          ceo: 'Ravi Mehta',
          leadership: [{ name: 'Anita Rao', title: 'COO' }],
          certifications: ['ISO 20252'],
          operatingStatus: 'Active',
          country: 'IN',
          headquarters: 'Mumbai',
          state: 'Maharashtra',
          city: 'Mumbai',
          address: '12 Marine Drive',
          postalCode: '400002',
          timezone: 'Asia/Kolkata',
          addresses: [{ label: 'Delhi office', country: 'IN', city: 'New Delhi', address: '5 Janpath' }],
          primaryEmail: 'sales@acmepanels.example',
          emails: [{ value: 'sales@acmepanels.example', primary: true }, { value: 'info@acmepanels.example', label: 'General' }],
          primaryPhone: '+91 22 5550 1000',
          phones: [{ value: '+91 22 5550 1000', primary: true }, { value: '+91 11 5550 2000', label: 'Delhi' }],
          website: 'https://acmepanels.example',
          websites: [{ value: 'https://acmepanels.example', primary: true }, { value: 'https://careers.acmepanels.example' }],
          contactPageUrl: 'https://acmepanels.example/contact',
          linkedinUrl: 'https://www.linkedin.com/company/acme-panels',
          socialLinks: [
            { platform: 'facebook', url: 'https://facebook.com/acmepanels' },
            { platform: 'github', url: 'https://github.com/acmepanels' },
          ],
          moreDetails: [{ label: 'Slogan', value: 'Real answers' }, { label: 'VAT number', value: 'IN-VAT-123' }, { label: 'LEI', value: '5493001KJTIIGC8Y1R12' }],
          notes: '=HYPERLINK("http://evil.example") call on Monday',
          customFields: { panel_size: '1.2M' },
        })
        .expect(201)
    ).body;
    acmeId = acme.id;
    await http.post('/contacts', { firstName: 'Priya', lastName: 'Nair', jobTitle: 'Head of Research', email: 'priya@acmepanels.example', linkedinUrl: 'https://www.linkedin.com/in/priya-nair', companyId: acmeId, remarks: 'Prefers email', customFields: { met_at: 'ESOMAR 2026' } }).expect(201);
    await http.post('/contacts', { firstName: 'Ravi', lastName: 'Mehta', jobTitle: 'CEO', companyId: acmeId }).expect(201);
    await http.post(`/companies/${acmeId}/branches`, { name: 'Pune', country: 'IN', city: 'Pune', phone: '+91 20 5550 3000' }).expect(201);
    await http.post('/interactions', { companyId: acmeId, kind: 'CALL_OUTGOING', subject: 'Intro call', outcome: 'Asked for rates' }).expect(201);
    otherId = (await http.post('/companies', { name: 'Zeta Fieldwork', country: 'GB', primaryEmail: 'hello@zeta.example' }).expect(201)).body.id;
    await http.post('/contacts', { firstName: 'Zoe', jobTitle: 'Director', companyId: otherId }).expect(201);
  });
  afterAll(async () => {
    await app.close();
  });

  it('exports every company field, employees, branches and interactions into one Excel workbook', async () => {
    const res = await binary(http.get('/exports/companies?format=xlsx')).expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toMatch(/sampforce-companies-\d{4}-\d{2}-\d{2}\.xlsx/);
    const wb = await workbook(res);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Companies', 'Employees', 'Branches', 'Interactions']);

    const companies = records(wb.getWorksheet('Companies')!);
    const acme = companies.rows.find((r) => r['Company name'] === 'Acme Panels')!;
    expect(acme).toMatchObject({
      'Legal name': 'Acme Panels Private Limited',
      'Lead status': 'New Lead',
      'Operating status': 'Active',
      Description: 'Online panels across India.',
      Industry: 'Market research',
      'Business category': 'Fieldwork',
      Specialties: 'B2B panels',
      Services: 'Online surveys; CATI',
      Products: 'Acme Pulse',
      'Industries served': 'Healthcare; Automotive',
      Founded: 2009,
      Employees: 240,
      'Company size': '201-500',
      'Company type': 'Private',
      'Number of branches': 1,
      'Parent company': 'Acme Holdings',
      Ownership: 'Privately held',
      Founders: 'Ravi Mehta; Anita Rao',
      CEO: 'Ravi Mehta',
      Leadership: 'Anita Rao (COO)',
      Certifications: 'ISO 20252',
      'Country code': 'IN',
      Country: 'India',
      Headquarters: 'Mumbai',
      'State or region': 'Maharashtra',
      City: 'Mumbai',
      'Street address': '12 Marine Drive',
      'Postal code': '400002',
      'Time zone': 'Asia/Kolkata',
      'Other offices': 'Delhi office: 5 Janpath New Delhi India',
      'Primary email': 'sales@acmepanels.example',
      'All emails': 'sales@acmepanels.example; info@acmepanels.example (General)',
      'Primary phone': '+91 22 5550 1000',
      'Contact page': 'https://acmepanels.example/contact',
      Website: 'https://acmepanels.example',
      'All websites': 'https://acmepanels.example; https://careers.acmepanels.example',
      LinkedIn: 'https://www.linkedin.com/company/acme-panels',
      Facebook: 'https://facebook.com/acmepanels',
      GitHub: 'https://github.com/acmepanels',
      Slogan: 'Real answers',
      'VAT number': 'IN-VAT-123',
      LEI: '5493001KJTIIGC8Y1R12',
      'Panel size': '1.2M',
      'Employees in CRM': 2,
      'SampForce company ID': acmeId,
    });
    expect(String(acme['All phones'])).toContain('+91 11 5550 2000 (Delhi)');
    expect(String(acme['All social profiles'])).toContain('Facebook: https://facebook.com/acmepanels');
    // A formula in a remark is a text cell, never run (and the CSV neutralises it, below).
    expect(acme.Remarks).toBe('=HYPERLINK("http://evil.example") call on Monday');
    const remarks = wb.getWorksheet('Companies')!.getRow(companies.rows.indexOf(acme) + 2).getCell(companies.headers.indexOf('Remarks') + 1);
    expect(remarks.type).toBe(3); // ValueType.String
    expect(acme['Lead number']).toMatch(/^[A-Z]+\d+$/);
    // The main profile columns are always there; others only when a company has one.
    expect(companies.headers).toEqual(expect.arrayContaining(['LinkedIn', 'X (Twitter)', 'Facebook', 'Instagram', 'YouTube', 'GitHub']));
    expect(companies.headers).not.toContain('TikTok');

    const employees = records(wb.getWorksheet('Employees')!);
    expect(employees.rows.find((r) => r['Full name'] === 'Priya Nair')).toMatchObject({
      'Company name': 'Acme Panels',
      'Lead number': acme['Lead number'],
      Designation: 'Head of Research',
      Email: 'priya@acmepanels.example',
      LinkedIn: 'https://www.linkedin.com/in/priya-nair',
      Remarks: 'Prefers email',
      'Met at': 'ESOMAR 2026',
    });
    expect(employees.rows.map((r) => r['Full name'])).toEqual(expect.arrayContaining(['Priya Nair', 'Ravi Mehta', 'Zoe']));
    expect(records(wb.getWorksheet('Branches')!).rows).toContainEqual(expect.objectContaining({ 'Company name': 'Acme Panels', 'Branch name': 'Pune', Phone: '+91 20 5550 3000' }));
    expect(records(wb.getWorksheet('Interactions')!).rows).toContainEqual(expect.objectContaining({ 'Company name': 'Acme Panels', Kind: 'Call outgoing', Subject: 'Intro call', Outcome: 'Asked for rates' }));
  });

  it('exports companies and employees as separate CSV files that follow the list filters', async () => {
    const all = csvRows((await http.get('/exports/companies?format=csv&part=companies').expect(200)).text);
    expect(all.header.startsWith('Lead number,Company name,Legal name')).toBe(true);
    expect(all.lines.some((l) => l.includes('Acme Panels') && l.includes('Real answers'))).toBe(true);
    expect(all.lines.some((l) => l.includes('Zeta Fieldwork'))).toBe(true);
    expect(all.lines.find((l) => l.includes('Acme Panels'))).toContain(`"'=HYPERLINK(""http://evil.example"") call on Monday"`);

    // The same search as the list: only matching companies, and only their employees.
    const filtered = csvRows((await http.get('/exports/companies?format=csv&q=acme').expect(200)).text);
    expect(filtered.lines).toHaveLength(1);
    const res = await http.get('/exports/companies?format=csv&part=employees&q=acme').expect(200);
    expect(res.headers['content-disposition']).toContain('sampforce-companies-employees-');
    const emp = csvRows(res.text);
    expect(emp.header).toContain('Designation');
    expect(emp.lines).toHaveLength(2);
    expect(emp.lines.join('\n')).toContain('https://www.linkedin.com/in/priya-nair');
    expect(emp.lines.join('\n')).not.toContain('Zoe');
    const country = csvRows((await http.get('/exports/companies?format=csv&country=GB').expect(200)).text);
    expect(country.lines).toHaveLength(1);
    expect(country.lines[0]).toContain('Zeta Fieldwork');
    await http.get('/exports/companies?format=csv&part=nothing').expect(400);
  });

  it('exports one company with its employees from the company page', async () => {
    const res = await binary(http.get(`/companies/${acmeId}/export?format=xlsx`)).expect(200);
    expect(res.headers['content-disposition']).toMatch(/sampforce-[A-Z]+\d+-acme-panels-\d{4}-\d{2}-\d{2}\.xlsx/);
    const wb = await workbook(res);
    expect(records(wb.getWorksheet('Companies')!).rows.map((r) => r['Company name'])).toEqual(['Acme Panels']);
    expect(records(wb.getWorksheet('Employees')!).rows.map((r) => r['Full name']).sort()).toEqual(['Priya Nair', 'Ravi Mehta']);
    const csv = csvRows((await http.get(`/companies/${otherId}/export?format=csv&part=employees`).expect(200)).text);
    expect(csv.lines).toHaveLength(1);
    expect(csv.lines[0]).toContain('Zoe');
    // Another workspace's company is not found; nothing leaks.
    const stranger = await registerUser(app, 'Stranger Co');
    await api(stranger).get(`/companies/${acmeId}/export?format=csv`).expect(404);
    expect((await api(stranger).get('/exports/companies?format=csv').expect(200)).text).not.toContain('Acme Panels');
  });

  it('follows the plan, export permissions and record visibility', async () => {
    // Excel needs the plan feature; CSV does not.
    const free = await registerUser(app, 'Free Export Co', { plan: 'free' });
    const f = api(free);
    await f.post('/companies', { name: 'Free Co' }).expect(201);
    expect((await f.get('/exports/companies?format=xlsx').expect(403)).body.error.details[0].message).toBe('excel_export');
    expect((await f.get('/exports/companies?format=csv').expect(200)).text).toContain('Free Co');

    // A role without data:export cannot export at all.
    const viewer = await inviteMember(app, owner, 'member');
    await api(viewer).get('/exports/companies?format=csv').expect(403);
    await api(viewer).get(`/companies/${acmeId}/export?format=csv`).expect(403);

    // A role allowed companies only, without contact details: no employees, blank emails and profile links.
    const roles = (await http.get('/tenants/current/roles').expect(200)).body as Array<{ id: string; key: string; permissions: string[] }>;
    const admin = roles.find((r) => r.key === 'admin')!;
    const limited = (await http.post('/tenants/current/roles', { name: 'Limited exporter', permissions: admin.permissions }).expect(201)).body as { id: string; key: string };
    const person = await inviteMember(app, owner, limited.key);
    await http.put('/crm-config/export-policy', { roles: [{ roleId: limited.id, entities: ['companies'], formats: ['csv', 'xlsx'], withoutContactDetails: true }] }).expect(200);
    const p = api(person);
    await p.get('/exports/companies?format=csv&part=employees').expect(403);
    const wb = await workbook(await binary(p.get('/exports/companies?format=xlsx')).expect(200));
    expect(wb.worksheets.map((w) => w.name)).not.toContain('Employees');
    const acme = records(wb.getWorksheet('Companies')!).rows.find((r) => r['Company name'] === 'Acme Panels')!;
    expect(acme).toMatchObject({ 'Primary email': null, 'All emails': null, LinkedIn: null, Facebook: null, Industry: 'Market research', Website: 'https://acmepanels.example' });
    expect(records(wb.getWorksheet('Branches')!).rows[0]).toMatchObject({ Phone: null });

    // Record visibility: a person who sees only their own records exports only those, and not others' companies.
    await http.put(`/tenants/current/roles/${limited.id}/visibility`, { recordScope: 'OWN', viewOthersDetails: true }).expect(200);
    const mine = csvRows((await p.get('/exports/companies?format=csv').expect(200)).text);
    expect(mine.lines.join('\n')).not.toContain('Acme Panels');
    await p.get(`/companies/${acmeId}/export?format=csv`).expect(404);

    // The export is audited.
    const audited = await asTenant(owner.tenantId, (tx) => tx.auditLog.count({ where: { tenantId: owner.tenantId, action: 'data.exported', entityType: 'companies' } }));
    expect(audited).toBeGreaterThanOrEqual(5);
  });
});
