import type { HelpText } from './types';

/** Who a part of the Help Center is written for: people in a client's workspaces, or SampForce operators in the Console. */
export type HelpAudience = 'workspace' | 'console';

/**
 * A Help Center category: the tiles on the Help home page. `icon` names a lucide icon; each app maps it to its own
 * icon component, so this package stays free of React.
 */
export interface HelpCategory {
  id: string;
  audience: HelpAudience;
  icon: string;
  /** A colour family for the tile, from the theme's chart palette (1-6), so every theme keeps its look. */
  tone: 1 | 2 | 3 | 4 | 5 | 6;
  title: HelpText;
  description: HelpText;
}

export const HELP_CATEGORIES = [
  {
    id: 'start',
    audience: 'workspace',
    icon: 'rocket',
    tone: 1,
    title: ['Getting started', 'Primeros pasos', 'Bien démarrer', 'Erste Schritte', 'البدء'],
    description: [
      'Find your way around, search, shortcuts and your home screen.',
      'Oriéntate, busca, usa atajos y conoce tu pantalla de inicio.',
      'Repérez-vous, recherchez, utilisez les raccourcis et votre écran d’accueil.',
      'Zurechtfinden, Suche, Tastenkürzel und Ihr Startbildschirm.',
      'تعرّف على التنقل والبحث والاختصارات وشاشتك الرئيسية.',
    ],
  },
  {
    id: 'account',
    audience: 'workspace',
    icon: 'user-round-cog',
    tone: 2,
    title: ['Your account', 'Tu cuenta', 'Votre compte', 'Ihr Konto', 'حسابك'],
    description: [
      'Sign-in, passwords, two-step verification, language and appearance.',
      'Inicio de sesión, contraseñas, verificación en dos pasos, idioma y apariencia.',
      'Connexion, mots de passe, validation en deux étapes, langue et apparence.',
      'Anmeldung, Passwörter, Bestätigung in zwei Schritten, Sprache und Darstellung.',
      'تسجيل الدخول وكلمات المرور والتحقق بخطوتين واللغة والمظهر.',
    ],
  },
  {
    id: 'workspaces',
    audience: 'workspace',
    icon: 'network',
    tone: 3,
    title: ['Workspaces & permissions', 'Espacios y permisos', 'Espaces et autorisations', 'Arbeitsbereiche & Rechte', 'مساحات العمل والصلاحيات'],
    description: [
      'Super, Manager and Executive Workspaces, team members, roles and what each person may do.',
      'Espacios Super, Manager y Executive, miembros, roles y lo que cada persona puede hacer.',
      'Espaces Super, Manager et Executive, membres, rôles et ce que chacun peut faire.',
      'Super-, Manager- und Executive-Arbeitsbereiche, Mitglieder, Rollen und was jede Person darf.',
      'مساحات المدير الأعلى والمدير والتنفيذي والأعضاء والأدوار وما يحق لكل شخص فعله.',
    ],
  },
  {
    id: 'crm',
    audience: 'workspace',
    icon: 'building-2',
    tone: 4,
    title: ['Companies & contacts', 'Empresas y contactos', 'Entreprises et contacts', 'Unternehmen & Kontakte', 'الشركات وجهات الاتصال'],
    description: [
      'Create, find, qualify and convert the people and companies you sell to.',
      'Crea, busca, califica y convierte a las personas y empresas a las que vendes.',
      'Créez, trouvez, qualifiez et convertissez les personnes et entreprises à qui vous vendez.',
      'Personen und Unternehmen, an die Sie verkaufen, anlegen, finden, qualifizieren und umwandeln.',
      'أنشئ الأشخاص والشركات التي تبيع لها وابحث عنهم وأهّلهم وحوّلهم.',
    ],
  },
  {
    id: 'deals',
    audience: 'workspace',
    icon: 'handshake',
    tone: 5,
    title: ['Deals, pipelines & RFQs', 'Oportunidades, pipelines y RFQ', 'Opportunités, pipelines et RFQ', 'Verkaufschancen, Pipelines & RFQs', 'الصفقات ومسارات المبيعات وطلبات التسعير'],
    description: [
      'Move opportunities through stages, price requests for quotation and keep deals healthy.',
      'Mueve oportunidades por etapas, cotiza solicitudes y mantén sanas las oportunidades.',
      'Faites avancer les opportunités, chiffrez les demandes de prix et gardez vos affaires saines.',
      'Verkaufschancen durch Phasen bewegen, Anfragen bepreisen und Deals gesund halten.',
      'انقل الفرص بين المراحل وسعّر طلبات التسعير وحافظ على صحة الصفقات.',
    ],
  },
  {
    id: 'work',
    audience: 'workspace',
    icon: 'calendar-check',
    tone: 6,
    title: ['Activities & follow-ups', 'Actividades y seguimientos', 'Activités et relances', 'Aktivitäten & Nachfassungen', 'الأنشطة والمتابعات'],
    description: [
      'Tasks, calls, meetings, follow-ups, targets and approvals.',
      'Tareas, llamadas, reuniones, seguimientos, objetivos y aprobaciones.',
      'Tâches, appels, réunions, relances, objectifs et approbations.',
      'Aufgaben, Anrufe, Besprechungen, Nachfassungen, Ziele und Freigaben.',
      'المهام والمكالمات والاجتماعات والمتابعات والأهداف والموافقات.',
    ],
  },
  {
    id: 'communication',
    audience: 'workspace',
    icon: 'messages-square',
    tone: 1,
    title: ['Email & chat', 'Correo y chat', 'E-mail et chat', 'E-Mail & Chat', 'البريد والدردشة'],
    description: [
      'Your synced mailbox, the team inbox and chat with colleagues.',
      'Tu buzón sincronizado, la bandeja del equipo y el chat con colegas.',
      'Votre boîte synchronisée, la boîte d’équipe et le chat entre collègues.',
      'Ihr synchronisiertes Postfach, das Team-Postfach und der Chat mit Kollegen.',
      'بريدك المتزامن وصندوق الفريق والدردشة مع الزملاء.',
    ],
  },
  {
    id: 'outreach',
    audience: 'workspace',
    icon: 'send',
    tone: 2,
    title: ['Prospecting & outreach', 'Prospección y contacto', 'Prospection et démarchage', 'Akquise & Ansprache', 'التنقيب والتواصل'],
    description: [
      'Email sequences, the email finder, prospect lists, the browser extension, website visitors and marketing.',
      'Secuencias de correo, buscador de correos, listas de prospectos, extensión, visitantes web y marketing.',
      'Séquences d’e-mails, recherche d’adresses, listes de prospects, extension, visiteurs du site et marketing.',
      'E-Mail-Sequenzen, E-Mail-Finder, Interessentenlisten, Browsererweiterung, Website-Besucher und Marketing.',
      'سلاسل البريد وباحث البريد وقوائم العملاء المحتملين وإضافة المتصفح وزوار الموقع والتسويق.',
    ],
  },
  {
    id: 'documents',
    audience: 'workspace',
    icon: 'file-signature',
    tone: 3,
    title: ['Quotes, proposals & contracts', 'Cotizaciones, propuestas y contratos', 'Devis, propositions et contrats', 'Angebote, Vorschläge & Verträge', 'عروض الأسعار والمقترحات والعقود'],
    description: [
      'Price your work, send proposals your customer accepts online and track contracts and renewals.',
      'Cotiza tu trabajo, envía propuestas que el cliente acepta en línea y sigue contratos y renovaciones.',
      'Chiffrez votre travail, envoyez des propositions acceptées en ligne et suivez contrats et renouvellements.',
      'Arbeit bepreisen, online annehmbare Vorschläge senden und Verträge samt Verlängerungen verfolgen.',
      'سعّر عملك وأرسل مقترحات يقبلها عميلك عبر الإنترنت وتابع العقود والتجديدات.',
    ],
  },
  {
    id: 'ai',
    audience: 'workspace',
    icon: 'bot',
    tone: 4,
    title: ['AI & automation', 'IA y automatización', 'IA et automatisation', 'KI & Automatisierung', 'الذكاء الاصطناعي والأتمتة'],
    description: [
      'Copilot, AI agents and workflows that do routine work for you.',
      'Copilot, agentes de IA y flujos que hacen el trabajo rutinario por ti.',
      'Copilot, agents IA et workflows qui font le travail répétitif pour vous.',
      'Copilot, KI-Agenten und Workflows, die Routinearbeit für Sie erledigen.',
      'المساعد Copilot ووكلاء الذكاء الاصطناعي وسير العمل التي تنجز العمل الروتيني عنك.',
    ],
  },
  {
    id: 'insights',
    audience: 'workspace',
    icon: 'line-chart',
    tone: 5,
    title: ['Reports & forecasting', 'Informes y previsiones', 'Rapports et prévisions', 'Berichte & Prognosen', 'التقارير والتوقعات'],
    description: [
      'Reports, dashboards, forecasts, revenue intelligence and gamification.',
      'Informes, paneles, previsiones, inteligencia de ingresos y gamificación.',
      'Rapports, tableaux de bord, prévisions, intelligence du chiffre d’affaires et gamification.',
      'Berichte, Dashboards, Prognosen, Umsatzanalyse und Gamification.',
      'التقارير ولوحات المعلومات والتوقعات وذكاء الإيرادات والتحفيز بالألعاب.',
    ],
  },
  {
    id: 'customers',
    audience: 'workspace',
    icon: 'heart-handshake',
    tone: 6,
    title: ['Customers & portal', 'Clientes y portal', 'Clients et portail', 'Kunden & Portal', 'العملاء والبوابة'],
    description: [
      'The client portal and customer success health scores.',
      'El portal de clientes y las puntuaciones de salud de éxito del cliente.',
      'Le portail client et les scores de santé du succès client.',
      'Das Kundenportal und die Gesundheitswerte von Customer Success.',
      'بوابة العملاء ودرجات صحة نجاح العملاء.',
    ],
  },
  {
    id: 'apps',
    audience: 'workspace',
    icon: 'plug',
    tone: 1,
    title: ['Apps & integrations', 'Apps e integraciones', 'Applications et intégrations', 'Apps & Integrationen', 'التطبيقات والتكاملات'],
    description: [
      'Connect your mailbox, calendar, Slack, Zoom, WhatsApp, payments, Zapier, API keys and webhooks.',
      'Conecta tu buzón, calendario, Slack, Zoom, WhatsApp, pagos, Zapier, claves de API y webhooks.',
      'Connectez boîte mail, agenda, Slack, Zoom, WhatsApp, paiements, Zapier, clés d’API et webhooks.',
      'Postfach, Kalender, Slack, Zoom, WhatsApp, Zahlungen, Zapier, API-Schlüssel und Webhooks verbinden.',
      'اربط بريدك وتقويمك وSlack وZoom وWhatsApp والمدفوعات وZapier ومفاتيح API والخطافات.',
    ],
  },
  {
    id: 'data',
    audience: 'workspace',
    icon: 'database',
    tone: 2,
    title: ['Data & settings', 'Datos y ajustes', 'Données et paramètres', 'Daten & Einstellungen', 'البيانات والإعدادات'],
    description: [
      'Import and export, custom fields, CRM configuration, territories and the audit log.',
      'Importar y exportar, campos personalizados, configuración del CRM, territorios y registro de auditoría.',
      'Import et export, champs personnalisés, configuration du CRM, territoires et journal d’audit.',
      'Import und Export, benutzerdefinierte Felder, CRM-Konfiguration, Gebiete und Audit-Protokoll.',
      'الاستيراد والتصدير والحقول المخصصة وإعداد CRM والمناطق وسجل التدقيق.',
    ],
  },
  {
    id: 'billing',
    audience: 'workspace',
    icon: 'credit-card',
    tone: 3,
    title: ['Plan & billing', 'Plan y facturación', 'Offre et facturation', 'Tarif & Abrechnung', 'الخطة والفوترة'],
    description: [
      'What your plan includes, seats, usage, invoices and payments.',
      'Lo que incluye tu plan, puestos, uso, facturas y pagos.',
      'Ce que comprend votre offre, sièges, utilisation, factures et paiements.',
      'Was Ihr Tarif enthält, Plätze, Nutzung, Rechnungen und Zahlungen.',
      'ما تتضمنه خطتك والمقاعد والاستخدام والفواتير والمدفوعات.',
    ],
  },
  {
    id: 'mobile',
    audience: 'workspace',
    icon: 'smartphone',
    tone: 4,
    title: ['Mobile app', 'App móvil', 'Application mobile', 'Mobile App', 'تطبيق الجوال'],
    description: [
      'Using SampForce on your iPhone or Android phone.',
      'Usar SampForce en tu iPhone o teléfono Android.',
      'Utiliser SampForce sur votre iPhone ou téléphone Android.',
      'SampForce auf Ihrem iPhone oder Android-Telefon nutzen.',
      'استخدام SampForce على هاتف iPhone أو Android.',
    ],
  },
  {
    id: 'support',
    audience: 'workspace',
    icon: 'life-buoy',
    tone: 5,
    title: ['Getting help', 'Obtener ayuda', 'Obtenir de l’aide', 'Hilfe bekommen', 'الحصول على المساعدة'],
    description: [
      'Raise a query, follow its answer and reach the SampForce team.',
      'Envía una consulta, sigue su respuesta y contacta con el equipo de SampForce.',
      'Posez une question, suivez sa réponse et joignez l’équipe SampForce.',
      'Eine Anfrage stellen, die Antwort verfolgen und das SampForce-Team erreichen.',
      'أرسل استفسارًا وتابع الرد عليه وتواصل مع فريق SampForce.',
    ],
  },
  // ── Console ──────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'console-clients',
    audience: 'console',
    icon: 'building',
    tone: 1,
    title: ['Clients & workspaces', 'Clientes y espacios', 'Clients et espaces', 'Kunden & Arbeitsbereiche', 'العملاء ومساحات العمل'],
    description: [
      'Client organisations, their subscriptions, limits and workspace structure.',
      'Organizaciones cliente, sus suscripciones, límites y estructura de espacios.',
      'Organisations clientes, abonnements, limites et structure des espaces.',
      'Kundenorganisationen, ihre Abonnements, Grenzen und Arbeitsbereichsstruktur.',
      'المؤسسات العميلة واشتراكاتها وحدودها وبنية مساحات العمل.',
    ],
  },
  {
    id: 'console-plans',
    audience: 'console',
    icon: 'layers',
    tone: 2,
    title: ['Plans & features', 'Planes y funciones', 'Offres et fonctions', 'Tarife & Funktionen', 'الخطط والميزات'],
    description: [
      'Which features and limits each plan sells, and overrides for one client.',
      'Qué funciones y límites vende cada plan y excepciones para un cliente.',
      'Fonctions et limites vendues par chaque offre, et exceptions pour un client.',
      'Welche Funktionen und Grenzen jeder Tarif enthält, und Ausnahmen für einen Kunden.',
      'الميزات والحدود التي تبيعها كل خطة والاستثناءات لعميل واحد.',
    ],
  },
  {
    id: 'console-providers',
    audience: 'console',
    icon: 'key-round',
    tone: 3,
    title: ['Providers & settings', 'Proveedores y ajustes', 'Fournisseurs et paramètres', 'Anbieter & Einstellungen', 'المزوّدون والإعدادات'],
    description: [
      'Keys for email, AI, payments and calendars, and installation settings.',
      'Claves de correo, IA, pagos y calendarios, y ajustes de la instalación.',
      'Clés d’e-mail, d’IA, de paiement et d’agenda, et paramètres de l’installation.',
      'Schlüssel für E-Mail, KI, Zahlungen und Kalender sowie Installationseinstellungen.',
      'مفاتيح البريد والذكاء الاصطناعي والمدفوعات والتقويمات وإعدادات التثبيت.',
    ],
  },
  {
    id: 'console-support',
    audience: 'console',
    icon: 'life-buoy',
    tone: 4,
    title: ['Client support', 'Soporte a clientes', 'Support client', 'Kundensupport', 'دعم العملاء'],
    description: [
      'Answer support tickets and the support chat from every client.',
      'Responde los tickets de soporte y el chat de soporte de cada cliente.',
      'Répondez aux tickets et au chat de support de chaque client.',
      'Support-Tickets und den Support-Chat aller Kunden beantworten.',
      'أجب عن تذاكر الدعم ودردشة الدعم من كل عميل.',
    ],
  },
  {
    id: 'console-security',
    audience: 'console',
    icon: 'shield-check',
    tone: 5,
    title: ['Operators & audit', 'Operadores y auditoría', 'Opérateurs et audit', 'Betreiber & Audit', 'المشغّلون والتدقيق'],
    description: [
      'Who can use the Console, what they did, and how client data stays private.',
      'Quién puede usar la Consola, qué hizo y cómo se protegen los datos del cliente.',
      'Qui peut utiliser la Console, ce qu’il a fait et comment les données client restent privées.',
      'Wer die Konsole nutzen darf, was getan wurde und wie Kundendaten privat bleiben.',
      'من يمكنه استخدام لوحة التحكم وما فعله وكيف تبقى بيانات العملاء خاصة.',
    ],
  },
] as const satisfies readonly HelpCategory[];

export type HelpCategoryId = (typeof HELP_CATEGORIES)[number]['id'];

export const HELP_CATEGORY_BY_ID: Readonly<Record<HelpCategoryId, HelpCategory>> = Object.fromEntries(HELP_CATEGORIES.map((c) => [c.id, c])) as Record<
  HelpCategoryId,
  HelpCategory
>;
