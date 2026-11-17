import type { INestApplication } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

/**
 * Imports that match columns by heading, add custom fields for the rest, and take a company and one of its employees
 * from each row (ADR 0066). The sheet below has the shape of a real customer file: shouted headings with typos.
 */
const SHEET = [
  'DATE,NO OF BRANCHES & ADDRESS,COUNTRY & WORKING HOURS,COMPANY NAME,WESBSITE,COMPANY LINKEDIN ID,EMPLOYEE NAME,EMPLOYEE DESGNATION,EMPLOYEE EMAIL ID',
  '26-05-2026 (TUESDAY),"New Hope, Pennsylvania",United States of America (USA) 9-5,Sommer Consulting,http://www.sommerconsulting.com/,https://www.linkedin.com/company/sommer-consulting,Brooks Anderson,Associate Director,brooks@sommerconsulting.com',
  '26-05-2026 (TUESDAY),"New Hope, Pennsylvania",United States of America (USA) 9-5,Sommer Consulting,http://www.sommerconsulting.com/,https://www.linkedin.com/company/sommer-consulting,Farah Samawi,Insights & Research,farah@sommerconsulting.com',
  '27-05-2026 (WEDNESDAY),"Pune, India",India 10-7,Kestrel Analytics Pvt Ltd,kestrel.example,,Janine Karo,Senior Project Manager,janine@kestrel.example',
  ',,,,,,,,',
  '28-05-2026,,,Orbit Labs,orbit.example,,,,',
  '28-05-2026,,,Bad Mail Co,,,Ann Lee,CEO,not-an-email',
].join('\n');

describe('smart import: companies with their employees', () => {
  let app: INestApplication;
  let owner: TestUser;
  let http: ReturnType<typeof api>;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Smart Import');
    http = api(owner);
  });
  afterAll(async () => {
    await app.close();
  });

  it('matches headings with typos, plans new fields, and writes nothing on a dry run', async () => {
    const dry = (await http.post('/imports', { entity: 'companies_contacts', csv: SHEET, autoMap: true, dryRun: true }).expect(200)).body;
    expect(dry.mapping).toMatchObject({
      'COMPANY NAME': 'company.name',
      WESBSITE: 'company.website',
      'COMPANY LINKEDIN ID': 'company.linkedinUrl',
      'EMPLOYEE NAME': 'contact.fullName',
      'EMPLOYEE DESGNATION': 'contact.jobTitle',
      'EMPLOYEE EMAIL ID': 'contact.email',
      DATE: 'new:company',
      'NO OF BRANCHES & ADDRESS': 'new:company',
      'COUNTRY & WORKING HOURS': 'new:company',
    });
    expect(dry.newFields.map((f: { label: string; entity: string; key: string }) => [f.label, f.entity, f.key])).toEqual([
      ['Date', 'COMPANY', 'date'],
      ['No Of Branches & Address', 'COMPANY', 'no_of_branches_and_address'],
      ['Country & Working Hours', 'COMPANY', 'country_and_working_hours'],
    ]);
    // The blank row is not a row; the bad email is an error; the rest import.
    expect(dry).toMatchObject({ dryRun: true, totalRows: 5, created: 4, companiesCreated: 3, companiesMatched: 0, contactsCreated: 3 });
    expect(dry.errors).toEqual([{ row: 7, message: expect.stringContaining('Employee email') }]);
    expect((await http.get('/companies').expect(200)).body.total).toBe(0);
    expect((await http.get('/custom-fields?entity=COMPANY').expect(200)).body).toHaveLength(0);
  });

  it('creates the companies, attaches each employee, and adds the new fields', async () => {
    const res = (await http.post('/imports', { entity: 'companies_contacts', csv: SHEET, autoMap: true }).expect(200)).body;
    expect(res).toMatchObject({ dryRun: false, created: 4, companiesCreated: 3, contactsCreated: 3 });

    const fields = (await http.get('/custom-fields?entity=COMPANY').expect(200)).body as { key: string; label: string; type: string }[];
    expect(fields.map((f) => [f.key, f.type])).toEqual([['date', 'TEXT'], ['no_of_branches_and_address', 'TEXT'], ['country_and_working_hours', 'TEXT']]);

    const sommer = (await http.get('/companies?q=sommer').expect(200)).body.items;
    expect(sommer).toHaveLength(1);
    expect(sommer[0]).toMatchObject({
      name: 'Sommer Consulting',
      website: 'http://www.sommerconsulting.com/',
      domain: 'sommerconsulting.com',
      linkedinUrl: 'https://www.linkedin.com/company/sommer-consulting',
      contactCount: 2,
      leadNumber: expect.any(String),
      customFields: { date: '26-05-2026 (TUESDAY)', no_of_branches_and_address: 'New Hope, Pennsylvania', country_and_working_hours: 'United States of America (USA) 9-5' },
    });
    const employees = (await http.get(`/contacts?companyId=${sommer[0].id}`).expect(200)).body.items as { firstName: string; lastName: string; jobTitle: string; email: string; company: { id: string } }[];
    expect(employees.map((e) => [e.firstName, e.lastName, e.jobTitle, e.email]).sort()).toEqual([
      ['Brooks', 'Anderson', 'Associate Director', 'brooks@sommerconsulting.com'],
      ['Farah', 'Samawi', 'Insights & Research', 'farah@sommerconsulting.com'],
    ]);
    // Imported companies are found by the duplicate check like ones typed in.
    const dupes = (await http.post('/companies/check-duplicates', { name: 'SOMMER CONSULTING LLC' }).expect(200)).body;
    expect(dupes).toEqual([expect.objectContaining({ id: sommer[0].id, reasons: ['name'] })]);
    const orbit = (await http.get('/companies?q=orbit').expect(200)).body.items;
    expect(orbit[0].contactCount).toBe(0);
  });

  it('reuses existing companies on the next file, fills their blanks and skips known employees', async () => {
    const next = [
      'Company,Website,Industry,Employee name,Email,Employee Phone,Date',
      'Kestrel Analytics,https://kestrel.example,Market research,Janine Karo,JANINE@kestrel.example,,01-06-2026',
      'Sommer Consulting Inc.,,Consulting,Lena Ortiz,lena@sommerconsulting.com,+1 215 555 0101,',
      'Orbit,https://www.orbit.example/about,,Max Field,max@orbit.example,,',
    ].join('\n');
    const res = (await http.post('/imports', { entity: 'companies_contacts', csv: next, autoMap: true }).expect(200)).body;
    // "Date" now matches the field the first import added; nothing new is created.
    expect(res.mapping).toMatchObject({ Company: 'company.name', Website: 'company.website', Industry: 'company.industry', 'Employee name': 'contact.fullName', Email: 'contact.email', 'Employee Phone': 'contact.phone', Date: 'company.customFields.date' });
    expect(res.newFields).toEqual([]);
    expect(res).toMatchObject({ companiesCreated: 0, companiesMatched: 3, contactsCreated: 2, skippedDuplicates: 1 });

    const kestrel = (await http.get('/companies?q=kestrel').expect(200)).body.items[0];
    // Blank industry filled in; the date the company already had is kept.
    expect(kestrel).toMatchObject({ industry: 'Market research', customFields: expect.objectContaining({ date: '27-05-2026 (WEDNESDAY)' }) });
    const sommer = (await http.get('/companies?q=sommer').expect(200)).body.items[0];
    expect(sommer).toMatchObject({ contactCount: 3, industry: 'Consulting' });
    const orbit = (await http.get('/companies?q=orbit').expect(200)).body.items[0];
    expect(orbit).toMatchObject({ name: 'Orbit Labs', contactCount: 1 });
  });

  it('lets someone without CRM configuration import into existing fields only', async () => {
    const member = api(await inviteMember(app, owner, 'member'));
    const csv = 'Company name,Employee name,Favourite colour\nNova Ltd,Iris West,Blue\n';
    const auto = (await member.post('/imports', { entity: 'companies_contacts', csv, autoMap: true, dryRun: true }).expect(200)).body;
    expect(auto.mapping['Favourite colour']).toBeUndefined();
    expect(auto.newFields).toEqual([]);
    await member.post('/imports', { entity: 'companies_contacts', csv, mapping: { 'Company name': 'company.name', 'Favourite colour': 'new:contact' }, dryRun: true }).expect(403);
  });

  it('rejects bad mappings', async () => {
    const csv = 'Company,Name\nAcme,Al\n';
    await http.post('/imports', { entity: 'companies_contacts', csv, mapping: { Name: 'contact.fullName' } }).expect(400);
    await http.post('/imports', { entity: 'companies_contacts', csv, mapping: { Company: 'company.name', Name: 'company.name' } }).expect(400);
    await http.post('/imports', { entity: 'companies_contacts', csv, mapping: { Company: 'company.name', Name: 'new' } }).expect(400);
    await http.post('/imports', { entity: 'companies_contacts', csv, mapping: { Company: 'company.name', Name: 'customFields.nope' } }).expect(400);
    await http.post('/imports', { entity: 'leads', csv, mapping: { Company: 'companyName', Name: 'new:contact' } }).expect(400);
  });
});

describe('smart import: single record types', () => {
  let app: INestApplication;
  let http: ReturnType<typeof api>;
  let owner: TestUser;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Single Import');
    http = api(owner);
  });
  afterAll(async () => {
    await app.close();
  });

  it('imports the same sheet as leads: the employee name is the lead name, the rest become lead fields', async () => {
    const res = (await http.post('/imports', { entity: 'leads', csv: SHEET, autoMap: true }).expect(200)).body;
    expect(res.mapping).toMatchObject({ 'EMPLOYEE NAME': 'fullName', 'COMPANY NAME': 'companyName', WESBSITE: 'website', 'EMPLOYEE DESGNATION': 'jobTitle', 'EMPLOYEE EMAIL ID': 'email', 'COMPANY LINKEDIN ID': 'new' });
    expect(res.newFields.every((f: { entity: string }) => f.entity === 'LEAD')).toBe(true);
    // Orbit Labs has no employee name: a lead needs one.
    expect(res.errors.map((e: { row: number }) => e.row)).toEqual([6, 7]);
    const lead = (await http.get('/leads?q=farah').expect(200)).body.items[0];
    expect(lead).toMatchObject({ fullName: 'Farah Samawi', companyName: 'Sommer Consulting', customFields: expect.objectContaining({ company_linkedin_id: 'https://www.linkedin.com/company/sommer-consulting' }) });
  });

  it('imports contacts from a full-name column and country names', async () => {
    const csv = 'Full Name,E-mail,Country,Organisation\nPriya Nair,priya@acme.example,india,Acme\nTom Hu,tom@acme.example,Atlantis,Acme\n';
    const res = (await http.post('/imports', { entity: 'contacts', csv, autoMap: true }).expect(200)).body;
    expect(res).toMatchObject({ created: 1, errors: [{ row: 3, message: expect.stringContaining('Atlantis') }] });
    const c = (await http.get('/contacts?q=priya').expect(200)).body.items[0];
    expect(c).toMatchObject({ firstName: 'Priya', lastName: 'Nair', country: 'IN', company: { name: 'Acme' } });
  });

  it('imports companies with their website and LinkedIn, skipping ones already there', async () => {
    const csv = 'Organization,Web site,LinkedIn\nZeta Corp,zeta.example,linkedin.com/company/zeta\nAcme,,\n';
    const res = (await http.post('/imports', { entity: 'companies', csv, autoMap: true }).expect(200)).body;
    expect(res).toMatchObject({ created: 1, skippedDuplicates: 1 });
    const zeta = (await http.get('/companies?q=zeta').expect(200)).body.items[0];
    expect(zeta).toMatchObject({ website: 'https://zeta.example', domain: 'zeta.example', linkedinUrl: 'https://linkedin.com/company/zeta', leadNumber: expect.any(String) });
  });

  it('reads an Excel workbook into CSV for the import', async () => {
    const wb = new Workbook();
    const ws = wb.addWorksheet('Leads list');
    ws.addRow([]);
    ws.addRow(['COMPANY NAME', 'EMPLOYEE NAME', 'DATE', 'PHONE', 'NOTE']);
    ws.addRow(['Helios GmbH', 'Karl Weber', new Date(Date.UTC(2026, 4, 26)), '+49 30 1234567', { richText: [{ text: 'Met at ' }, { text: 'IIEX', font: { bold: true } }] }]);
    ws.addRow(['Quote, "Inc"', { formula: 'CONCAT("Ana"," ","Lima")', result: 'Ana Lima' }, null, 4930123, '=1+1']);
    const data = Buffer.from(await wb.xlsx.writeBuffer());
    const parsed = (
      await owner.agent.post('/api/v1/imports/file').set('origin', ORIGIN).set('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(data).expect(200)
    ).body;
    expect(parsed).toMatchObject({ sheet: 'Leads list', rows: 2 });
    expect(parsed.csv.split('\r\n')).toEqual([
      'COMPANY NAME,EMPLOYEE NAME,DATE,PHONE,NOTE',
      'Helios GmbH,Karl Weber,2026-05-26,+49 30 1234567,Met at IIEX',
      '"Quote, ""Inc""",Ana Lima,,4930123,=1+1',
      '',
    ]);
    const res = (await http.post('/imports', { entity: 'companies_contacts', csv: parsed.csv, autoMap: true }).expect(200)).body;
    expect(res).toMatchObject({ companiesCreated: 2, contactsCreated: 2 });
  });

  it('refuses files that are not workbooks', async () => {
    await owner.agent.post('/api/v1/imports/file').set('origin', ORIGIN).set('content-type', 'application/octet-stream').send(Buffer.from('name,email\n')).expect(400);
  });
});
