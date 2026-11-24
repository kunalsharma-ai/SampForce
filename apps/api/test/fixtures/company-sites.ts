/**
 * Stand-in company websites and a stand-in Wikidata for company auto-fill (ADR 0076). Served by the logo fixture
 * (LOGO_FIXTURE_URL) as /site/<host>/<path>. Every company, person, address and number here is made up.
 */

const page = (title: string, head: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;

const NORTHWIND_NAV = `
<header><nav>
  <a href="/">Home</a>
  <a href="/about-us">About us</a>
  <div class="menu"><span>Services</span>
    <a href="/services/online-surveys">Online Surveys</a>
    <a href="/services/b2b-research">B2B Research</a>
    <a href="/services/healthcare-research">Healthcare Research</a>
    <a href="/services/data-processing">Data Processing</a>
    <a href="/services/">Services</a>
  </div>
  <div class="menu"><span>Industries</span>
    <a href="/industries/healthcare">Healthcare</a>
    <a href="/industries/technology">Technology</a>
    <a href="/industries/financial-services">Financial Services</a>
  </div>
  <a href="/contact">Contact</a>
</nav></header>`;

const NORTHWIND_FOOTER = `
<footer>
  <h3>Our Offices</h3>
  <div class="office"><h4>Head Office</h4><p>4th Floor, Meridian Tower, 12 Harbour Road<br>Pune, Maharashtra 411001<br>India</p></div>
  <div class="office"><h4>UK Office</h4><p>Unit 7, 221 Fleet Lane, London EC4A 2AB, United Kingdom</p></div>
  <div class="office"><h4>US Office</h4><p>500 Market Street, Suite 300, San Francisco, CA 94105, USA</p></div>
  <div class="office"><h4>Singapore Office</h4><p>80 Robinson Road, #10-01, Singapore 068898, Singapore</p></div>
  <div class="office"><h4>UAE Office</h4><p>Office 1204, Bay Square, Business Bay, Dubai, United Arab Emirates</p></div>
  <p>Business development: <a href="mailto:bd@northwind-insights.example">bd@northwind-insights.example</a></p>
  <p>Careers: <a href="mailto:hr@northwind-insights.example?subject=CV">hr@northwind-insights.example</a></p>
  <p>Our founder Priya Nair writes at priya.nair@northwind-insights.example</p>
  <p>We are ISO 20252:2019 and ISO 27001 certified, and a proud ESOMAR member.</p>
  <a href="https://www.linkedin.com/company/northwind-insights/">LinkedIn</a>
  <a href="https://twitter.com/NorthwindIns">Twitter</a>
  <a href="https://www.facebook.com/northwindinsights">Facebook</a>
  <a href="https://www.instagram.com/northwind.insights/">Instagram</a>
  <a href="https://www.youtube.com/@northwindinsights">YouTube</a>
  <a href="https://www.facebook.com/sharer/sharer.php?u=https://northwind-insights.example">Share</a>
  <a href="https://www.linkedin.com/in/priya-nair-12345/">Priya on LinkedIn</a>
  <p>© 2009–2026 Northwind Insights</p>
</footer>`;

export const ENRICH_SITES: Record<string, Record<string, { type: string; body: string } | { redirect: string }>> = {
  // A market research firm without structured data: everything comes from links and page text.
  'northwind-insights.example': {
    '/': { redirect: 'https://www.northwind-insights.example/' },
  },
  'www.northwind-insights.example': {
    '/': {
      type: 'text/html; charset=utf-8',
      body: page(
        'Northwind Insights | Global Market Research and Data Collection',
        '<meta name="description" content="Northwind Insights is a global market research company offering online surveys, B2B and healthcare research, and data processing to research agencies and brands in over 60 countries.">',
        `${NORTHWIND_NAV}<main><h1>Insights that move markets</h1>
        <h2>Our Services</h2>
        <div class="cards"><div><h3>Online Surveys</h3><p>Fast fieldwork.</p></div><div><h3>B2B Research</h3><p>Decision makers.</p></div><div><h3>Panel Management</h3><p>Our own panels.</p></div></div>
        <h2>Why us</h2><p>Read more</p></main>${NORTHWIND_FOOTER}`,
      ),
    },
    '/about-us': {
      type: 'text/html',
      body: page(
        'About us | Northwind Insights',
        '',
        `${NORTHWIND_NAV}<main><h1>About us</h1>
        <p>Northwind Insights was founded in 2009 to help research agencies reach hard-to-find audiences. Today our team of 450+ professionals runs projects for clients across healthcare, technology and financial services from five offices.</p>
        </main>${NORTHWIND_FOOTER}`,
      ),
    },
    '/contact': {
      type: 'text/html',
      body: page(
        'Contact | Northwind Insights',
        '',
        `${NORTHWIND_NAV}<main><h1>Contact us</h1><p>Phone: +91 20 4000 1234</p><p><a href="tel:+442079460958">+44 20 7946 0958</a></p><p>General enquiries: info@northwind-insights.example</p></main>${NORTHWIND_FOOTER}`,
      ),
    },
  },

  // A larger company with schema.org data on its home page, and a Wikidata item (Q990001) that disagrees on the year.
  'globex-analytics.example': {
    '/': {
      type: 'text/html',
      body: page(
        'Globex Analytics',
        `<meta property="og:description" content="Globex Analytics measures what people think, buy and watch.">
        <script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [
            { '@type': 'WebSite', name: 'Globex Analytics', url: 'https://globex-analytics.example/' },
            {
              '@type': 'Corporation',
              name: 'Globex Analytics',
              legalName: 'Globex Analytics plc',
              url: 'https://globex-analytics.example/',
              description: 'Globex Analytics is a market research and data company that measures audiences, brands and shoppers in 40 countries.',
              foundingDate: '1999-03-01',
              founder: [{ '@type': 'Person', name: 'Hana Okafor' }],
              numberOfEmployees: { '@type': 'QuantitativeValue', value: 11800 },
              email: 'contact@globex-analytics.example',
              telephone: '+44 20 7000 1000',
              slogan: 'Know your audience',
              address: { '@type': 'PostalAddress', streetAddress: '1 Riverside Walk', addressLocality: 'London', postalCode: 'SE1 9PG', addressCountry: 'GB' },
              contactPoint: [{ '@type': 'ContactPoint', contactType: 'sales', email: 'sales@globex-analytics.example', telephone: '+44 20 7000 1001' }],
              sameAs: ['https://www.linkedin.com/company/globex-analytics', 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'],
            },
          ],
        })}</script>`,
        '<main><h1>Globex Analytics</h1><a href="/contact-us">Contact us</a></main>',
      ),
    },
    '/contact-us': { type: 'text/html', body: page('Contact', '', '<main><h1>Contact</h1><p>Write to press@globex-analytics.example</p></main>') },
  },

  // Found by name on Wikidata (Q990002); its website then gives the rest.
  'umbrella-dynamics.example': {
    '/': {
      type: 'text/html',
      body: page(
        'Umbrella Dynamics – Industrial sensors',
        '<meta name="description" content="Umbrella Dynamics designs and manufactures industrial sensors for factories, ports and power plants.">',
        '<main><h1>Umbrella Dynamics</h1><p>Since 1984.</p><a href="mailto:sales@umbrella-dynamics.example">Sales</a><a href="https://www.linkedin.com/company/umbrella-dynamics">LinkedIn</a></main>',
      ),
    },
  },

  // Made-up companies for the browser suite and screen previews.
  'lumenharbor.example': {
    '/': {
      type: 'text/html',
      body: page(
        'Lumen Harbor | Healthcare market research',
        '<link rel="icon" type="image/svg+xml" href="/brand.svg"><meta name="description" content="Lumen Harbor is a healthcare market research agency connecting pharmaceutical brands with physicians, patients and payers across Europe and Asia.">',
        `<header><a href="/about">About</a><a href="/services/physician-surveys">Physician Surveys</a><a href="/services/patient-insights">Patient Insights</a><a href="/services/payer-research">Payer Research</a><a href="/industries/pharmaceuticals">Pharmaceuticals</a><a href="/industries/medical-devices">Medical Devices</a><a href="/contact">Contact</a></header>
        <main><h1>Healthcare insight, done right</h1></main>
        <footer>
          <h3>Offices</h3>
          <div><h4>Headquarters</h4><p>Lumen House, 18 Canal Street, Manchester M1 3HE, United Kingdom</p></div>
          <div><h4>Germany Office</h4><p>Friedrichstraße 120, 10117 Berlin, Germany</p></div>
          <div><h4>India Office</h4><p>Tower B, 9th Floor, Cyber City, Gurugram, Haryana 122002, India</p></div>
          <p><a href="mailto:hello@lumenharbor.example">hello@lumenharbor.example</a> · <a href="mailto:projects@lumenharbor.example">projects@lumenharbor.example</a></p>
          <p>ISO 20252 certified · ISO 27001:2022 · MRS Company Partner</p>
          <a href="https://www.linkedin.com/company/lumen-harbor">LinkedIn</a>
          <a href="https://x.com/lumenharbor">X</a>
          <a href="https://www.facebook.com/lumenharbor">Facebook</a>
          <a href="https://www.instagram.com/lumenharbor">Instagram</a>
          <a href="https://www.youtube.com/@lumenharbor">YouTube</a>
        </footer>`,
      ),
    },
    '/about': { type: 'text/html', body: page('About', '', '<main><h1>About Lumen Harbor</h1><p>Established in 2012, Lumen Harbor has grown to 180 employees who speak 14 languages and run research with doctors, nurses and patients in more than 30 countries every year.</p></main>') },
    '/contact': { type: 'text/html', body: page('Contact', '', '<main><h1>Contact</h1><p>Tel: +44 161 496 0000</p></main>') },
  },
};

// ───────────── Wikidata ─────────────

const item = (id: string) => ({ 'entity-type': 'item', id });
const snak = (value: unknown) => ({ snaktype: 'value', datavalue: { value } });
const claim = (value: unknown, extra: Record<string, unknown> = {}) => ({ mainsnak: snak(value), rank: 'normal', ...extra });
const label = (en: string) => ({ en: { language: 'en', value: en } });

const ENTITIES: Record<string, Record<string, unknown>> = {
  Q990001: {
    id: 'Q990001',
    labels: label('Globex Analytics'),
    descriptions: label('British market research company'),
    claims: {
      P31: [claim(item('Q4830453'))],
      P856: [claim('https://www.globex-analytics.example/')],
      P571: [claim({ time: '+1998-00-00T00:00:00Z', precision: 9 })],
      P1128: [
        claim({ amount: '+9000', unit: '1' }, { qualifiers: { P585: [snak({ time: '+2020-01-01T00:00:00Z', precision: 9 })] } }),
        claim({ amount: '+12000', unit: '1' }, { qualifiers: { P585: [snak({ time: '+2024-01-01T00:00:00Z', precision: 9 })] } }),
      ],
      P452: [claim(item('Q990101'))],
      P159: [claim(item('Q84'))],
      P17: [claim(item('Q145'))],
      P112: [claim(item('Q990201'))],
      P169: [claim(item('Q990202'), { qualifiers: { P582: [snak({ time: '+2019-01-01T00:00:00Z', precision: 11 })] } }), claim(item('Q990203'))],
      P749: [claim(item('Q990301'))],
      P414: [claim(item('Q171240'), { qualifiers: { P249: [snak('GBXA')] } })],
      P2002: [claim('globexanalytics')],
      P4264: [claim('globex-analytics')],
    },
  },
  Q990002: {
    id: 'Q990002',
    labels: label('Umbrella Dynamics'),
    descriptions: label('industrial sensor manufacturer'),
    claims: {
      P31: [claim(item('Q4830453'))],
      P856: [claim('https://umbrella-dynamics.example')],
      P571: [claim({ time: '+1984-06-01T00:00:00Z', precision: 11 })],
      P17: [claim(item('Q183'))],
      P452: [claim(item('Q990102'))],
    },
  },
  // Another "Umbrella" item that a name search returns: a person, never used.
  Q990003: { id: 'Q990003', labels: label('Umbrella Dynamics (band)'), claims: { P31: [claim(item('Q215380'))] } },
  Q990101: { id: 'Q990101', labels: label('market research') },
  Q990102: { id: 'Q990102', labels: label('manufacturing') },
  Q84: { id: 'Q84', labels: label('London'), claims: { P17: [claim(item('Q145'))] } },
  Q145: { id: 'Q145', labels: label('United Kingdom'), claims: { P297: [claim('GB')] } },
  Q183: { id: 'Q183', labels: label('Germany'), claims: { P297: [claim('DE')] } },
  Q990201: { id: 'Q990201', labels: label('Hana Okafor') },
  Q990202: { id: 'Q990202', labels: label('Former Chief') },
  Q990203: { id: 'Q990203', labels: label('Mateo Lindqvist') },
  Q990301: { id: 'Q990301', labels: label('Globex Holdings') },
  Q171240: { id: 'Q171240', labels: label('London Stock Exchange') },
  Q4830453: { id: 'Q4830453', labels: label('business') },
  Q215380: { id: 'Q215380', labels: label('musical group') },
};

const websiteOf = (e: Record<string, unknown>) => {
  const c = (e.claims as Record<string, { mainsnak: { datavalue: { value: string } } }[]> | undefined)?.P856?.[0];
  return c?.mainsnak.datavalue.value ?? null;
};

/** Answers the three Wikidata API calls auto-fill makes. */
export function wikidataAnswer(query: URLSearchParams): unknown {
  const action = query.get('action');
  if (action === 'wbsearchentities') {
    const q = (query.get('search') ?? '').toLowerCase();
    const hits = Object.values(ENTITIES).filter((e) => /^Q99000\d$/.test(String(e.id)) && (e.labels as Record<string, { value: string }>).en!.value.toLowerCase().startsWith(q));
    return { search: hits.map((e) => ({ id: e.id, label: (e.labels as Record<string, { value: string }>).en!.value })) };
  }
  if (action === 'query') {
    const wanted = [...(query.get('srsearch') ?? '').matchAll(/P856=([^|]+)/g)].map((m) => m[1]);
    const found = Object.values(ENTITIES).filter((e) => wanted.includes(websiteOf(e) ?? '-'));
    return { query: { search: found.map((e) => ({ title: e.id })) } };
  }
  if (action === 'wbgetentities') {
    const ids = (query.get('ids') ?? '').split('|');
    return { entities: Object.fromEntries(ids.map((id) => [id, ENTITIES[id] ?? { id, missing: '' }])) };
  }
  return { error: { code: 'unknown-action' } };
}
