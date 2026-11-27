import { FEATURE_BY_KEY, type FeatureKey } from '@dealflow/types';
import type { HelpReader } from './access';
import type { HelpCategoryId } from './categories';
import type { HelpId } from './topics';
import type { HelpText } from './types';

/**
 * "Explore SampForce" in the Help Center (ADR 0073): a brief for every part of the product, what it offers and the
 * facilities around it (security, the mobile app, languages, support, hosting, AI providers). Each brief names the
 * plan features it is made of, so a reader sees what their own plan includes; the Console can rewrite or hide any
 * brief and add its own (articles of kind FEATURE, keyed feature:<id>).
 *
 * Only what SampForce really does is described here. A brief that names a feature must match its catalogue entry
 * in @dealflow/types.
 */
export type BriefKind = 'feature' | 'facility';

export interface ProductBrief {
  id: string;
  kind: BriefKind;
  /** The Help Center topic whose answers and guides go deeper. */
  category: HelpCategoryId;
  icon: string;
  tone: number;
  title: HelpText;
  tagline: HelpText;
  summary: HelpText;
  highlights: readonly HelpText[];
  /** Plan features the brief describes. Empty: every plan has it. */
  features: readonly FeatureKey[];
  /** Feature guide pages to read next. */
  guides: readonly HelpId[];
}

const b = (
  id: string,
  kind: BriefKind,
  category: HelpCategoryId,
  look: { icon: string; tone: number },
  features: readonly FeatureKey[],
  guides: readonly HelpId[],
  title: HelpText,
  tagline: HelpText,
  summary: HelpText,
  highlights: readonly HelpText[],
): ProductBrief => ({ id, kind, category, ...look, features, guides, title, tagline, summary, highlights });

export const PRODUCT_BRIEFS: readonly ProductBrief[] = [
  // ── Features ───────────────────────────────────────────────────────────────────────────────────────────────────
  b('crm', 'feature', 'crm', { icon: 'building-2', tone: 1 }, ['account_management', 'contact_management', 'lead_management', 'lead_transfers', 'record_timeline'], ['page.companies', 'page.contacts', 'page.leads'],
    ['Companies, contacts and leads', 'Empresas, contactos y leads', 'Entreprises, contacts et leads', 'Unternehmen, Kontakte und Leads', 'الشركات وجهات الاتصال والعملاء المحتملون'],
    ['One place for every client relationship', 'Un solo lugar para cada relación con clientes', 'Un seul endroit pour chaque relation client', 'Ein Ort für jede Kundenbeziehung', 'مكان واحد لكل علاقة مع العملاء'],
    [
      'Keep each company with its branches, employees, files and owner, capture inbound leads and turn them into companies, contacts and deals without typing anything twice.',
      'Guarda cada empresa con sus sucursales, empleados, archivos y responsable, capta leads entrantes y conviértelos en empresas, contactos y oportunidades sin escribir nada dos veces.',
      'Gardez chaque entreprise avec ses agences, employés, fichiers et responsable, captez les leads entrants et transformez-les en entreprises, contacts et affaires sans rien ressaisir.',
      'Führen Sie jedes Unternehmen mit Niederlassungen, Mitarbeitern, Dateien und Verantwortlichem, erfassen Sie eingehende Leads und machen Sie daraus Unternehmen, Kontakte und Deals, ohne etwas doppelt einzugeben.',
      'احفظ كل شركة مع فروعها وموظفيها وملفاتها ومسؤولها، والتقط العملاء المحتملين الواردين وحوّلهم إلى شركات وجهات اتصال وصفقات دون كتابة أي شيء مرتين.',
    ],
    [
      ['Duplicate warnings while you type, and merging', 'Avisos de duplicados mientras escribes, y fusión', 'Alerte de doublon pendant la saisie, et fusion', 'Dublettenwarnung beim Tippen und Zusammenführen', 'تنبيه بالتكرار أثناء الكتابة، والدمج'],
      ['Owner changes with a reason and full history', 'Cambios de responsable con motivo e historial completo', 'Changement de responsable motivé, avec historique', 'Verantwortlichenwechsel mit Grund und Verlauf', 'تغيير المسؤول مع السبب والسجل الكامل'],
      ['A timeline of every call, email, meeting and note', 'Una cronología de cada llamada, correo, reunión y nota', 'Une chronologie de chaque appel, e-mail, réunion et note', 'Eine Zeitleiste aller Anrufe, E-Mails, Meetings und Notizen', 'خط زمني لكل مكالمة وبريد واجتماع وملاحظة'],
    ]),
  b('deals', 'feature', 'deals', { icon: 'kanban', tone: 2 }, ['opportunity_management', 'sales_pipeline', 'rfqs', 'sales_intelligence', 'territories'], ['page.deals', 'page.pipelines', 'page.rfqs', 'page.dealHealth'],
    ['Deals, pipelines and RFQs', 'Oportunidades, pipelines y RFQ', 'Affaires, pipelines et RFQ', 'Deals, Pipelines und RFQs', 'الصفقات ومسارات البيع وطلبات عروض الأسعار'],
    ['See every opportunity move to won', 'Ve cada oportunidad avanzar hasta ganarse', 'Suivez chaque affaire jusqu’à la signature', 'Jede Chance bis zum Abschluss verfolgen', 'تابع كل فرصة حتى الفوز بها'],
    [
      'Work deals on a board by stage, keep pipelines that match how you sell, and handle requests for quotation with LOI, IR and CPI pricing, deadlines and conversion to deals.',
      'Trabaja las oportunidades en un tablero por etapas, mantén pipelines a tu medida y gestiona solicitudes de cotización con precios LOI, IR y CPI, plazos y conversión en oportunidades.',
      'Travaillez les affaires sur un tableau par étape, gardez des pipelines adaptés à votre vente et gérez les demandes de devis avec tarifs LOI, IR et CPI, échéances et conversion en affaires.',
      'Bearbeiten Sie Deals auf einem Board nach Phasen, nutzen Sie Pipelines, die zu Ihrem Vertrieb passen, und bearbeiten Sie Angebotsanfragen mit LOI-, IR- und CPI-Preisen, Fristen und Umwandlung in Deals.',
      'اعمل على الصفقات في لوحة حسب المرحلة، واحتفظ بمسارات بيع تناسب طريقة بيعك، وأدر طلبات عروض الأسعار بتسعير LOI وIR وCPI والمواعيد النهائية والتحويل إلى صفقات.',
    ],
    [
      ['Drag deals between stages, or update many at once', 'Arrastra oportunidades entre etapas o actualiza muchas a la vez', 'Glissez les affaires d’une étape à l’autre, ou modifiez-en plusieurs', 'Deals zwischen Phasen ziehen oder viele auf einmal ändern', 'اسحب الصفقات بين المراحل أو حدّث كثيرًا منها دفعة واحدة'],
      ['Deal health and the next best action', 'Salud de la oportunidad y la siguiente mejor acción', 'Santé de l’affaire et prochaine meilleure action', 'Deal-Zustand und die nächste beste Aktion', 'صحة الصفقة وأفضل إجراء تالٍ'],
      ['Send RFQs to SampBidx for bidding', 'Envía RFQ a SampBidx para pujas', 'Envoyez les RFQ à SampBidx pour enchères', 'RFQs zur Gebotsabgabe an SampBidx senden', 'أرسل طلبات عروض الأسعار إلى SampBidx للمزايدة'],
    ]),
  b('command-center', 'feature', 'start', { icon: 'gauge', tone: 3 }, ['manager_dashboard', 'senior_dashboard', 'global_search', 'notifications'], ['page.commandCenter', 'page.dashboards'],
    ['Command Center dashboards', 'Paneles del Command Center', 'Tableaux de bord du Command Center', 'Command-Center-Dashboards', 'لوحات Command Center'],
    ['Your numbers the moment you sign in', 'Tus cifras en cuanto inicias sesión', 'Vos chiffres dès la connexion', 'Ihre Zahlen direkt nach der Anmeldung', 'أرقامك فور تسجيل الدخول'],
    [
      'Each person opens on the dashboard for their role: an executive’s day, a manager’s team, or the whole organisation for senior management. Every number opens the records behind it.',
      'Cada persona abre el panel de su rol: el día de un ejecutivo, el equipo de un manager o toda la organización para la dirección. Cada cifra abre los registros que la forman.',
      'Chacun arrive sur le tableau de bord de son rôle : la journée d’un commercial, l’équipe d’un manager ou toute l’organisation pour la direction. Chaque chiffre ouvre les fiches qui le composent.',
      'Jede Person landet auf dem Dashboard ihrer Rolle: dem Tag eines Executives, dem Team eines Managers oder der ganzen Organisation für die Geschäftsleitung. Jede Zahl öffnet die Datensätze dahinter.',
      'يفتح كل شخص على لوحة دوره: يوم الموظف التنفيذي أو فريق المدير أو المؤسسة كلها للإدارة العليا. كل رقم يفتح السجلات التي خلفه.',
    ],
    [
      ['Team KPIs and an employee performance table', 'KPI del equipo y tabla de rendimiento por empleado', 'KPI d’équipe et tableau de performance par personne', 'Team-KPIs und Leistungstabelle pro Person', 'مؤشرات أداء الفريق وجدول أداء الموظفين'],
      ['Department rankings and revenue analytics', 'Ranking por departamento y análisis de ingresos', 'Classement des services et analyse du chiffre d’affaires', 'Abteilungsranking und Umsatzanalysen', 'ترتيب الأقسام وتحليلات الإيرادات'],
      ['Follow-ups due today and overdue, in one view', 'Seguimientos para hoy y atrasados, en una vista', 'Relances du jour et en retard, dans une vue', 'Heute fällige und überfällige Nachfassaktionen in einer Ansicht', 'المتابعات المستحقة اليوم والمتأخرة في عرض واحد'],
    ]),
  b('work', 'feature', 'work', { icon: 'list-checks', tone: 4 }, ['follow_up_management', 'task_management', 'sales_target_management', 'activity_tracking', 'instructions'], ['page.followUps', 'page.calls', 'page.tasks', 'page.targets', 'page.meetings'],
    ['Follow-ups, tasks, targets and meetings', 'Seguimientos, tareas, objetivos y reuniones', 'Relances, tâches, objectifs et réunions', 'Nachfassaktionen, Aufgaben, Ziele und Meetings', 'المتابعات والمهام والأهداف والاجتماعات'],
    ['Never miss the next step', 'No te pierdas nunca el siguiente paso', 'Ne manquez jamais l’étape suivante', 'Nie wieder den nächsten Schritt verpassen', 'لا تفوّت الخطوة التالية أبدًا'],
    [
      'Plan follow-ups with reminders and outcomes, hand tasks to people and workspaces, set sales targets down the hierarchy, and keep meetings and calls logged on the right record.',
      'Planifica seguimientos con recordatorios y resultados, asigna tareas a personas y espacios, fija objetivos de venta por la jerarquía y registra reuniones y llamadas en el registro correcto.',
      'Planifiez des relances avec rappels et résultats, confiez des tâches aux personnes et aux espaces, fixez des objectifs le long de la hiérarchie et consignez réunions et appels sur la bonne fiche.',
      'Planen Sie Nachfassaktionen mit Erinnerungen und Ergebnis, vergeben Sie Aufgaben an Personen und Arbeitsbereiche, setzen Sie Vertriebsziele entlang der Hierarchie und erfassen Sie Meetings und Anrufe am richtigen Datensatz.',
      'خطّط للمتابعات مع التذكيرات والنتائج، وأسند المهام إلى الأشخاص ومساحات العمل، وحدّد أهداف المبيعات عبر الهيكل، وسجّل الاجتماعات والمكالمات على السجل الصحيح.',
    ],
    [
      ['Reschedule a follow-up and keep the count', 'Reprograma un seguimiento y conserva el recuento', 'Reportez une relance en gardant le décompte', 'Nachfassaktion verschieben, Zählung bleibt', 'أعد جدولة متابعة مع الاحتفاظ بالعدد'],
      ['Targets shared from the Super Workspace down to each person', 'Objetivos repartidos desde el espacio Super hasta cada persona', 'Objectifs répartis de l’espace Super jusqu’à chaque personne', 'Ziele vom Super-Arbeitsbereich bis zu jeder Person verteilt', 'أهداف موزعة من مساحة المدير الأعلى حتى كل شخص'],
      ['Approvals and manager instructions with acknowledgement', 'Aprobaciones e instrucciones del manager con confirmación', 'Validations et consignes du manager avec accusé de lecture', 'Freigaben und Manager-Anweisungen mit Bestätigung', 'الموافقات وتعليمات المدير مع تأكيد الاستلام'],
    ]),
  b('learning', 'feature', 'work', { icon: 'graduation-cap', tone: 5 }, ['learning'], ['page.learning', 'page.learningManage', 'page.learningCertificates'],
    ['Learning & Development', 'Aprendizaje y desarrollo', 'Formation et développement', 'Lernen & Entwicklung', 'التعلّم والتطوير'],
    ['Train the team and prove it', 'Forma al equipo y demuéstralo', 'Formez l’équipe et prouvez-le', 'Das Team schulen und es belegen', 'درّب الفريق وأثبت ذلك'],
    [
      'Build modules from video links, documents and written lessons, draft questions from the material without AI, assign them down the hierarchy, and issue verifiable certificates on a pass.',
      'Crea módulos con enlaces de vídeo, documentos y lecciones escritas, redacta preguntas desde el material sin IA, asígnalos por la jerarquía y emite certificados verificables al aprobar.',
      'Créez des modules à partir de liens vidéo, documents et leçons écrites, rédigez des questions depuis le contenu sans IA, assignez-les dans la hiérarchie et délivrez des certificats vérifiables.',
      'Erstellen Sie Module aus Videolinks, Dokumenten und Lektionen, entwerfen Sie Fragen ohne KI aus dem Material, weisen Sie sie entlang der Hierarchie zu und stellen Sie prüfbare Zertifikate aus.',
      'أنشئ وحدات من روابط الفيديو والمستندات والدروس المكتوبة، وصُغ الأسئلة من المادة دون ذكاء اصطناعي، وأسندها عبر الهيكل، وأصدر شهادات قابلة للتحقّق عند النجاح.',
    ],
    [
      ['Questions drafted from captions, transcripts and documents, reviewed by a manager', 'Preguntas redactadas desde subtítulos, transcripciones y documentos, revisadas por un responsable', 'Questions rédigées depuis sous-titres, transcriptions et documents, relues par un manager', 'Fragen aus Untertiteln, Transkripten und Dokumenten, von einem Manager geprüft', 'أسئلة مصاغة من الترجمة النصية والنصوص والمستندات يراجعها مدير'],
      ['Automatic and manual marking, retries and deadline reminders', 'Calificación automática y manual, reintentos y recordatorios de plazo', 'Correction automatique et manuelle, nouvelles tentatives et rappels d’échéance', 'Automatische und manuelle Bewertung, Wiederholungen und Fristerinnerungen', 'تصحيح تلقائي ويدوي وإعادة محاولات وتذكيرات بالمواعيد'],
      ['Certificates with a QR code anyone can verify, and Excel reports', 'Certificados con código QR verificable por cualquiera e informes en Excel', 'Certificats avec QR code vérifiable par tous et rapports Excel', 'Zertifikate mit für jeden prüfbarem QR-Code und Excel-Berichte', 'شهادات برمز QR يمكن لأي شخص التحقّق منه وتقارير Excel'],
    ]),
  b('communication', 'feature', 'communication', { icon: 'messages-square', tone: 5 }, ['email_sync', 'team_inbox', 'team_chat'], ['page.communication', 'page.chat'],
    ['Mailbox, team inbox and chat', 'Buzón, bandeja de equipo y chat', 'Messagerie, boîte d’équipe et chat', 'Postfach, Team-Posteingang und Chat', 'البريد وصندوق الفريق والدردشة'],
    ['Every conversation next to the record', 'Cada conversación junto al registro', 'Chaque conversation à côté de la fiche', 'Jedes Gespräch direkt am Datensatz', 'كل محادثة بجانب السجل'],
    [
      'Connect Gmail or Microsoft 365 to sync email and calendar and send from your own address, share threads in a team inbox, and talk to colleagues in direct messages and channels.',
      'Conecta Gmail o Microsoft 365 para sincronizar correo y calendario y enviar desde tu dirección, comparte hilos en una bandeja de equipo y habla con colegas por mensajes directos y canales.',
      'Connectez Gmail ou Microsoft 365 pour synchroniser e-mails et agenda et envoyer depuis votre adresse, partagez des fils dans une boîte d’équipe et échangez avec vos collègues en messages directs et canaux.',
      'Verbinden Sie Gmail oder Microsoft 365, um E-Mail und Kalender zu synchronisieren und von Ihrer Adresse zu senden, teilen Sie Threads im Team-Posteingang und sprechen Sie mit Kollegen in Direktnachrichten und Kanälen.',
      'اربط Gmail أو Microsoft 365 لمزامنة البريد والتقويم والإرسال من عنوانك، وشارك المحادثات في صندوق الفريق، وتحدّث مع زملائك برسائل مباشرة وقنوات.',
    ],
    [
      ['Owners, status and internal notes on shared threads', 'Responsables, estado y notas internas en hilos compartidos', 'Responsables, statut et notes internes sur les fils partagés', 'Verantwortliche, Status und interne Notizen in geteilten Threads', 'مسؤولون وحالة وملاحظات داخلية على المحادثات المشتركة'],
      ['Chat that also works on an office network without internet', 'Chat que funciona también en una red de oficina sin internet', 'Un chat qui marche aussi sur un réseau de bureau sans internet', 'Chat, der auch im Büronetz ohne Internet funktioniert', 'دردشة تعمل أيضًا على شبكة المكتب دون إنترنت'],
      ['Seen, typing and online status', 'Visto, escribiendo y en línea', 'Lu, en train d’écrire et en ligne', 'Gelesen, schreibt gerade und online', 'تمت المشاهدة ويكتب الآن ومتصل'],
    ]),
  b('outreach', 'feature', 'outreach', { icon: 'send', tone: 6 }, ['sequences', 'email_templates', 'email_finder', 'prospect_lists', 'browser_extension', 'marketing', 'campaigns', 'website_visitors'], ['page.sequences', 'page.finder', 'page.prospects', 'page.marketing', 'page.campaigns', 'page.websiteVisitors'],
    ['Prospecting and outreach', 'Prospección y alcance', 'Prospection et campagnes', 'Akquise und Outreach', 'البحث عن العملاء والتواصل'],
    ['Find the right people and reach them', 'Encuentra a las personas adecuadas y llega a ellas', 'Trouvez les bonnes personnes et contactez-les', 'Die richtigen Personen finden und erreichen', 'اعثر على الأشخاص المناسبين وتواصل معهم'],
    [
      'Build prospect lists from files, the browser extension and Apollo.io, find and verify work emails, and run multi-step email sequences, segments, lead forms and campaigns.',
      'Crea listas de prospectos desde archivos, la extensión del navegador y Apollo.io, encuentra y verifica correos de trabajo y lanza secuencias de varios pasos, segmentos, formularios y campañas.',
      'Constituez des listes de prospects depuis des fichiers, l’extension du navigateur et Apollo.io, trouvez et vérifiez les e-mails pro, et lancez séquences, segments, formulaires et campagnes.',
      'Erstellen Sie Prospect-Listen aus Dateien, der Browser-Erweiterung und Apollo.io, finden und prüfen Sie geschäftliche E-Mail-Adressen und starten Sie mehrstufige Sequenzen, Segmente, Formulare und Kampagnen.',
      'أنشئ قوائم عملاء محتملين من الملفات وإضافة المتصفح وApollo.io، واعثر على عناوين البريد المهنية وتحقق منها، وشغّل تسلسلات بريد متعددة الخطوات وشرائح ونماذج وحملات.',
    ],
    [
      ['Send windows, tracking and reply detection', 'Ventanas de envío, seguimiento y detección de respuestas', 'Plages d’envoi, suivi et détection des réponses', 'Versandfenster, Tracking und Antworterkennung', 'نوافذ إرسال وتتبع واكتشاف الردود'],
      ['Hosted lead forms with recorded consent', 'Formularios alojados con consentimiento registrado', 'Formulaires hébergés avec consentement enregistré', 'Gehostete Formulare mit erfasster Einwilligung', 'نماذج مستضافة مع تسجيل الموافقة'],
      ['Consent-aware website visitor tracking', 'Seguimiento de visitas web que respeta el consentimiento', 'Suivi des visiteurs du site respectueux du consentement', 'Website-Besucher-Tracking mit Einwilligung', 'تتبع زوار الموقع مع احترام الموافقة'],
    ]),
  b('documents', 'feature', 'documents', { icon: 'file-text', tone: 1 }, ['quotes', 'proposals', 'contracts'], ['page.quotes', 'page.quickBid', 'page.contracts'],
    ['Quotes, proposals and contracts', 'Cotizaciones, propuestas y contratos', 'Devis, propositions et contrats', 'Angebote, Vorschläge und Verträge', 'عروض الأسعار والمقترحات والعقود'],
    ['From price to signature', 'Del precio a la firma', 'Du prix à la signature', 'Vom Preis bis zur Unterschrift', 'من السعر إلى التوقيع'],
    [
      'Keep products and price books, build quotes with approvals and PDFs, turn them into proposals clients accept online, and track contracts with renewals and reminders.',
      'Mantén productos y listas de precios, crea cotizaciones con aprobaciones y PDF, conviértelas en propuestas que el cliente acepta en línea y controla contratos con renovaciones y recordatorios.',
      'Gérez produits et grilles tarifaires, créez des devis avec validations et PDF, transformez-les en propositions acceptées en ligne et suivez les contrats avec renouvellements et rappels.',
      'Pflegen Sie Produkte und Preislisten, erstellen Sie Angebote mit Freigaben und PDFs, machen Sie daraus Vorschläge, die Kunden online annehmen, und verfolgen Sie Verträge mit Verlängerungen und Erinnerungen.',
      'احتفظ بالمنتجات وقوائم الأسعار، وأنشئ عروض أسعار مع الموافقات وملفات PDF، وحوّلها إلى مقترحات يقبلها العميل عبر الإنترنت، وتابع العقود مع التجديدات والتذكيرات.',
    ],
    [
      ['Quick Bid Studio and bid templates', 'Quick Bid Studio y plantillas de oferta', 'Quick Bid Studio et modèles d’offre', 'Quick Bid Studio und Angebotsvorlagen', 'Quick Bid Studio وقوالب العروض'],
      ['Proposals shared by link and accepted online', 'Propuestas compartidas por enlace y aceptadas en línea', 'Propositions partagées par lien et acceptées en ligne', 'Vorschläge per Link teilen und online annehmen', 'مقترحات تُشارك برابط وتُقبل عبر الإنترنت'],
      ['E-signature with DocuSign and card payments', 'Firma electrónica con DocuSign y pagos con tarjeta', 'Signature électronique DocuSign et paiement par carte', 'E-Signatur mit DocuSign und Kartenzahlung', 'توقيع إلكتروني عبر DocuSign ودفع بالبطاقة'],
    ]),
  b('ai', 'feature', 'ai', { icon: 'sparkles', tone: 2 }, ['ai_assistant', 'automation', 'meeting_intelligence', 'voice_notes'], ['page.agents', 'page.automation', 'page.workflowEditor'],
    ['AI copilot, agents and automation', 'Copiloto de IA, agentes y automatización', 'Copilote IA, agents et automatisation', 'KI-Copilot, Agenten und Automatisierung', 'المساعد الذكي والوكلاء والأتمتة'],
    ['Let SampForce do the busywork', 'Deja que SampForce haga el trabajo repetitivo', 'Laissez SampForce faire le travail répétitif', 'Lassen Sie SampForce die Routine erledigen', 'دع SampForce يتولى الأعمال الروتينية'],
    [
      'Ask the Copilot about your records, let AI agents write emails and analyse deals, record meetings with transcripts and summaries, and build workflows with triggers, conditions and actions.',
      'Pregunta al Copiloto por tus registros, deja que los agentes de IA redacten correos y analicen oportunidades, graba reuniones con transcripción y resumen y crea flujos con disparadores, condiciones y acciones.',
      'Interrogez le Copilote sur vos fiches, laissez les agents IA rédiger des e-mails et analyser les affaires, enregistrez les réunions avec transcription et résumé, et créez des workflows avec déclencheurs, conditions et actions.',
      'Fragen Sie den Copilot zu Ihren Datensätzen, lassen Sie KI-Agenten E-Mails schreiben und Deals analysieren, zeichnen Sie Meetings mit Transkript und Zusammenfassung auf und bauen Sie Workflows mit Auslösern, Bedingungen und Aktionen.',
      'اسأل المساعد عن سجلاتك، ودع وكلاء الذكاء الاصطناعي يكتبون الرسائل ويحللون الصفقات، وسجّل الاجتماعات مع النص والملخص، وأنشئ مسارات عمل بمشغّلات وشروط وإجراءات.',
    ],
    [
      ['Voice notes turned into suggested CRM updates', 'Notas de voz convertidas en actualizaciones sugeridas', 'Notes vocales transformées en mises à jour suggérées', 'Sprachnotizen werden zu vorgeschlagenen CRM-Änderungen', 'ملاحظات صوتية تتحول إلى تحديثات مقترحة'],
      ['Works within your plan’s AI credits and monthly runs', 'Funciona dentro de los créditos de IA y ejecuciones de tu plan', 'Dans la limite des crédits IA et exécutions de votre offre', 'Im Rahmen der KI-Credits und Ausführungen Ihres Tarifs', 'ضمن أرصدة الذكاء الاصطناعي والتشغيلات الشهرية لخطتك'],
      ['Every AI answer in your own language', 'Cada respuesta de IA en tu idioma', 'Chaque réponse IA dans votre langue', 'Jede KI-Antwort in Ihrer Sprache', 'كل إجابة ذكاء اصطناعي بلغتك'],
    ]),
  b('insights', 'feature', 'insights', { icon: 'chart-column', tone: 3 }, ['reports', 'forecasting', 'revenue_intelligence', 'revenue_attribution', 'gamification'], ['page.reports', 'page.forecasting', 'page.revenue', 'page.gamification'],
    ['Reports, forecasts and revenue', 'Informes, previsiones e ingresos', 'Rapports, prévisions et chiffre d’affaires', 'Berichte, Prognosen und Umsatz', 'التقارير والتوقعات والإيرادات'],
    ['Decisions backed by your own data', 'Decisiones basadas en tus propios datos', 'Des décisions fondées sur vos données', 'Entscheidungen auf Basis Ihrer Daten', 'قرارات مبنية على بياناتك'],
    [
      'Build reports and dashboards of your own, forecast with weighted and scenario views and snapshots, follow revenue against targets in any currency, and motivate teams with points and leaderboards.',
      'Crea informes y paneles propios, prevé con vistas ponderadas y de escenarios e instantáneas, sigue los ingresos frente a objetivos en cualquier moneda y motiva a los equipos con puntos y clasificaciones.',
      'Créez vos rapports et tableaux de bord, prévoyez avec des vues pondérées, des scénarios et des instantanés, suivez le chiffre d’affaires par rapport aux objectifs dans toute devise et motivez les équipes avec points et classements.',
      'Erstellen Sie eigene Berichte und Dashboards, prognostizieren Sie mit gewichteten und Szenario-Ansichten und Snapshots, verfolgen Sie Umsatz gegen Ziele in jeder Währung und motivieren Sie Teams mit Punkten und Ranglisten.',
      'أنشئ تقاريرك ولوحاتك، وتوقّع بعروض مرجّحة وسيناريوهات ولقطات، وتابع الإيرادات مقابل الأهداف بأي عملة، وحفّز الفرق بالنقاط ولوحات الصدارة.',
    ],
    [
      ['Immersive pipeline flow, globe and replay views', 'Vistas inmersivas: flujo, globo y repetición', 'Vues immersives : flux, globe et relecture', 'Immersive Ansichten: Fluss, Globus und Wiedergabe', 'عروض غامرة: التدفق والكرة الأرضية وإعادة العرض'],
      ['Revenue split fairly between the people who won it', 'Ingresos repartidos con justicia entre quienes los ganaron', 'Chiffre d’affaires réparti équitablement entre les gagnants', 'Umsatz fair auf die Gewinner aufgeteilt', 'تقسيم الإيرادات بعدل بين من حققوها'],
      ['Badges and competitions for your teams', 'Insignias y competiciones para tus equipos', 'Badges et challenges pour vos équipes', 'Abzeichen und Wettbewerbe für Ihre Teams', 'شارات ومسابقات لفرقك'],
    ]),
  b('customers', 'feature', 'customers', { icon: 'heart-handshake', tone: 4 }, ['client_portal', 'customer_success', 'client_concerns'], ['page.portal', 'page.customerSuccess'],
    ['Client portal and customer success', 'Portal de clientes y éxito del cliente', 'Portail client et succès client', 'Kundenportal und Customer Success', 'بوابة العملاء ونجاح العملاء'],
    ['Keep clients happy after the sale', 'Mantén a los clientes contentos tras la venta', 'Fidélisez vos clients après la vente', 'Kunden auch nach dem Verkauf begeistern', 'حافظ على رضا العملاء بعد البيع'],
    [
      'Give clients a signed-in portal to follow projects and approve proposals, and watch health scores, churn risk, escalations and renewals for every account.',
      'Da a los clientes un portal con acceso para seguir proyectos y aprobar propuestas, y vigila la salud, el riesgo de abandono, las escalaciones y las renovaciones de cada cuenta.',
      'Offrez à vos clients un portail sécurisé pour suivre les projets et valider les propositions, et surveillez santé, risque de départ, escalades et renouvellements de chaque compte.',
      'Geben Sie Kunden ein Portal mit Anmeldung, um Projekte zu verfolgen und Vorschläge freizugeben, und behalten Sie Health Scores, Abwanderungsrisiko, Eskalationen und Verlängerungen jedes Kontos im Blick.',
      'امنح العملاء بوابة بتسجيل دخول لمتابعة المشاريع واعتماد المقترحات، وراقب مؤشرات الصحة وخطر المغادرة والتصعيدات والتجديدات لكل حساب.',
    ],
    [
      ['Client concerns with severity and escalation', 'Inquietudes del cliente con gravedad y escalación', 'Réclamations client avec gravité et escalade', 'Kundenanliegen mit Schweregrad und Eskalation', 'مخاوف العملاء مع الخطورة والتصعيد'],
      ['Renewal reminders before contracts end', 'Recordatorios de renovación antes de que acaben los contratos', 'Rappels de renouvellement avant la fin des contrats', 'Verlängerungserinnerungen vor Vertragsende', 'تذكيرات بالتجديد قبل انتهاء العقود'],
      ['Approvals from clients, online', 'Aprobaciones de clientes, en línea', 'Validations des clients, en ligne', 'Freigaben von Kunden, online', 'موافقات العملاء عبر الإنترنت'],
    ]),
  b('apps', 'feature', 'apps', { icon: 'plug', tone: 5 }, ['slack', 'teams', 'zoom', 'docusign', 'card_payments', 'whatsapp', 'sms', 'sampbidx', 'api_access', 'webhooks'], ['page.integrations'],
    ['Integrations and API', 'Integraciones y API', 'Intégrations et API', 'Integrationen und API', 'التكاملات وواجهة البرمجة'],
    ['SampForce works with the tools you use', 'SampForce funciona con tus herramientas', 'SampForce s’intègre à vos outils', 'SampForce arbeitet mit Ihren Tools', 'يعمل SampForce مع أدواتك'],
    [
      'Send CRM alerts to Slack and Teams, meet on Zoom, message clients on WhatsApp and SMS, sign with DocuSign, take card payments, and connect your own systems with API keys, Zapier and signed webhooks.',
      'Envía avisos a Slack y Teams, reúnete en Zoom, escribe a clientes por WhatsApp y SMS, firma con DocuSign, cobra con tarjeta y conecta tus sistemas con claves de API, Zapier y webhooks firmados.',
      'Envoyez des alertes vers Slack et Teams, réunissez-vous sur Zoom, écrivez aux clients sur WhatsApp et par SMS, signez avec DocuSign, encaissez par carte et reliez vos systèmes via clés d’API, Zapier et webhooks signés.',
      'Senden Sie CRM-Hinweise an Slack und Teams, treffen Sie sich in Zoom, schreiben Sie Kunden per WhatsApp und SMS, unterschreiben Sie mit DocuSign, nehmen Sie Kartenzahlungen an und verbinden Sie eigene Systeme über API-Schlüssel, Zapier und signierte Webhooks.',
      'أرسل تنبيهات إلى Slack وTeams، واجتمع عبر Zoom، وراسل العملاء عبر WhatsApp والرسائل القصيرة، ووقّع عبر DocuSign، واقبل الدفع بالبطاقة، واربط أنظمتك بمفاتيح API وZapier وwebhooks موقّعة.',
    ],
    [
      ['Messages sent from the client’s record', 'Mensajes enviados desde el registro del cliente', 'Messages envoyés depuis la fiche du client', 'Nachrichten direkt aus dem Kundendatensatz', 'رسائل تُرسل من سجل العميل'],
      ['Zoom transcripts on the meeting', 'Transcripciones de Zoom en la reunión', 'Transcriptions Zoom sur la réunion', 'Zoom-Transkripte am Meeting', 'نصوص Zoom على الاجتماع'],
      ['Webhooks signed so your systems can trust them', 'Webhooks firmados para que tus sistemas confíen en ellos', 'Webhooks signés pour que vos systèmes leur fassent confiance', 'Signierte Webhooks, denen Ihre Systeme vertrauen können', 'webhooks موقّعة لتثق بها أنظمتك'],
    ]),
  b('workspaces', 'feature', 'workspaces', { icon: 'network', tone: 6 }, ['workspace_management', 'user_management', 'permission_management', 'custom_roles', 'sso_scim'], ['page.workspaces', 'page.team', 'page.administration'],
    ['Workspaces, teams and permissions', 'Espacios, equipos y permisos', 'Espaces, équipes et autorisations', 'Arbeitsbereiche, Teams und Rechte', 'مساحات العمل والفرق والصلاحيات'],
    ['Built for how your organisation is run', 'Pensado para cómo funciona tu organización', 'Conçu pour l’organisation de votre entreprise', 'Gebaut für die Struktur Ihrer Organisation', 'مصمم لطريقة إدارة مؤسستك'],
    [
      'Mirror your organisation with Super, Manager and Executive Workspaces. Each level hands features and data down to the one below, and people see only what their role allows.',
      'Refleja tu organización con espacios Super, Manager y Executive. Cada nivel entrega funciones y datos al de abajo, y cada persona ve solo lo que su rol permite.',
      'Reproduisez votre organisation avec des espaces Super, Manager et Executive. Chaque niveau transmet fonctions et données au niveau inférieur, et chacun ne voit que ce que son rôle permet.',
      'Bilden Sie Ihre Organisation mit Super-, Manager- und Executive-Arbeitsbereichen ab. Jede Ebene gibt Funktionen und Daten an die nächste weiter, und jede Person sieht nur, was ihre Rolle erlaubt.',
      'اعكس هيكل مؤسستك بمساحات المدير الأعلى والمدير والتنفيذي. تمنح كل مستوى الميزات والبيانات للمستوى الأدنى، ولا يرى كل شخص إلا ما يسمح به دوره.',
    ],
    [
      ['Five standard roles, or roles of your own', 'Cinco roles estándar, o roles propios', 'Cinq rôles standard, ou vos propres rôles', 'Fünf Standardrollen oder eigene Rollen', 'خمسة أدوار قياسية أو أدوار خاصة بك'],
      ['Single sign-on with OpenID Connect and SCIM', 'Inicio de sesión único con OpenID Connect y SCIM', 'Authentification unique OpenID Connect et SCIM', 'Single Sign-on mit OpenID Connect und SCIM', 'تسجيل دخول موحد عبر OpenID Connect وSCIM'],
      ['A permission center to see who can do what', 'Un centro de permisos para ver quién puede hacer qué', 'Un centre des autorisations pour voir qui peut faire quoi', 'Ein Rechtecenter: wer darf was', 'مركز صلاحيات لمعرفة من يحق له فعل ماذا'],
    ]),
  b('data', 'feature', 'data', { icon: 'database', tone: 1 }, ['data_import', 'data_export', 'excel_export', 'custom_fields_advanced', 'crm_configuration', 'audit_log'], ['page.import', 'page.customFields', 'page.crmConfiguration'],
    ['Your data, your way', 'Tus datos, a tu manera', 'Vos données, à votre façon', 'Ihre Daten, wie Sie sie brauchen', 'بياناتك بطريقتك'],
    ['Bring it in, shape it, take it with you', 'Tráelos, dales forma y llévatelos', 'Importez-les, organisez-les, emportez-les', 'Importieren, gestalten, mitnehmen', 'أدخلها وشكّلها وخذها معك'],
    [
      'Import companies, contacts and leads from CSV and Excel with smart matching of headings, add custom fields for what you track, export to Excel at any time, and see who changed what in the audit log.',
      'Importa empresas, contactos y leads desde CSV y Excel con coincidencia inteligente de encabezados, añade campos personalizados, exporta a Excel cuando quieras y consulta quién cambió qué en el registro de auditoría.',
      'Importez entreprises, contacts et leads depuis CSV et Excel avec reconnaissance intelligente des en-têtes, ajoutez des champs personnalisés, exportez vers Excel à tout moment et voyez qui a modifié quoi dans le journal d’audit.',
      'Importieren Sie Unternehmen, Kontakte und Leads aus CSV und Excel mit intelligenter Spaltenzuordnung, ergänzen Sie eigene Felder, exportieren Sie jederzeit nach Excel und sehen Sie im Audit-Protokoll, wer was geändert hat.',
      'استورد الشركات وجهات الاتصال والعملاء المحتملين من CSV وExcel مع مطابقة ذكية للعناوين، وأضف حقولًا مخصصة، وصدّر إلى Excel متى شئت، واعرف من غيّر ماذا في سجل التدقيق.',
    ],
    [
      ['Custom fields created during import', 'Campos personalizados creados al importar', 'Champs personnalisés créés pendant l’import', 'Eigene Felder beim Import angelegt', 'حقول مخصصة تُنشأ أثناء الاستيراد'],
      ['Fourteen field types, shown to the designations you choose', 'Catorce tipos de campo, visibles para los cargos que elijas', 'Quatorze types de champ, visibles par les fonctions choisies', 'Vierzehn Feldtypen, sichtbar für gewählte Positionen', 'أربعة عشر نوعًا من الحقول تظهر للمسميات التي تختارها'],
      ['Nothing is lost when a plan changes', 'Nada se pierde al cambiar de plan', 'Rien n’est perdu quand l’offre change', 'Nichts geht bei einem Tarifwechsel verloren', 'لا يضيع شيء عند تغيير الخطة'],
    ]),

  // ── Facilities ─────────────────────────────────────────────────────────────────────────────────────────────────
  b('security', 'facility', 'account', { icon: 'shield-check', tone: 2 }, [], ['page.accountSecurity', 'page.workspaceSecurity'],
    ['Security and privacy', 'Seguridad y privacidad', 'Sécurité et confidentialité', 'Sicherheit und Datenschutz', 'الأمان والخصوصية'],
    ['Your data stays yours', 'Tus datos siguen siendo tuyos', 'Vos données restent les vôtres', 'Ihre Daten bleiben Ihre', 'بياناتك تبقى ملكك'],
    [
      'Each organisation’s data is kept apart from every other’s, keys for connected services are stored encrypted, and important actions are recorded in the audit log.',
      'Los datos de cada organización se guardan aparte de los demás, las claves de servicios conectados se almacenan cifradas y las acciones importantes quedan en el registro de auditoría.',
      'Les données de chaque organisation sont séparées de toutes les autres, les clés des services connectés sont chiffrées et les actions importantes sont consignées dans le journal d’audit.',
      'Die Daten jeder Organisation sind von allen anderen getrennt, Schlüssel verbundener Dienste werden verschlüsselt gespeichert, und wichtige Aktionen landen im Audit-Protokoll.',
      'تُحفظ بيانات كل مؤسسة منفصلة عن غيرها، وتُخزَّن مفاتيح الخدمات المتصلة مشفّرة، وتُسجَّل الإجراءات المهمة في سجل التدقيق.',
    ],
    [
      ['Two-step verification for every account', 'Verificación en dos pasos para cada cuenta', 'Validation en deux étapes pour chaque compte', 'Bestätigung in zwei Schritten für jedes Konto', 'تحقق بخطوتين لكل حساب'],
      ['Your password asked again before anything is deleted', 'Se pide tu contraseña antes de borrar algo', 'Votre mot de passe redemandé avant toute suppression', 'Passwortabfrage vor jedem Löschen', 'يُطلب كلمة المرور قبل حذف أي شيء'],
      ['Support can see your workspace only when you allow it', 'Soporte solo ve tu espacio si lo permites', 'Le support ne voit votre espace que si vous l’autorisez', 'Der Support sieht Ihren Bereich nur mit Ihrer Erlaubnis', 'لا يرى الدعم مساحتك إلا إذا سمحت بذلك'],
    ]),
  b('mobile-app', 'facility', 'mobile', { icon: 'smartphone', tone: 3 }, ['mobile_app'], ['page.mobileAccess'],
    ['Mobile app for iPhone and Android', 'App móvil para iPhone y Android', 'Application mobile iPhone et Android', 'Mobile App für iPhone und Android', 'تطبيق الجوال لأجهزة iPhone وAndroid'],
    ['SampForce in your pocket', 'SampForce en tu bolsillo', 'SampForce dans votre poche', 'SampForce in der Hosentasche', 'SampForce في جيبك'],
    [
      'Open records, your figures and targets, take photos for a record, chat with your team, get notifications and reach Help and support, wherever you are.',
      'Abre registros, tus cifras y objetivos, haz fotos para un registro, chatea con tu equipo, recibe notificaciones y accede a Ayuda y soporte, estés donde estés.',
      'Ouvrez vos fiches, vos chiffres et objectifs, prenez des photos pour une fiche, échangez avec votre équipe, recevez des notifications et accédez à l’Aide, où que vous soyez.',
      'Öffnen Sie Datensätze, Ihre Zahlen und Ziele, machen Sie Fotos für einen Datensatz, chatten Sie mit Ihrem Team, erhalten Sie Benachrichtigungen und erreichen Sie Hilfe und Support, wo immer Sie sind.',
      'افتح السجلات وأرقامك وأهدافك، والتقط صورًا لسجل، وتحدّث مع فريقك، واستقبل الإشعارات، وادخل إلى المساعدة والدعم أينما كنت.',
    ],
    [
      ['Your administrator decides who may use it', 'Tu administrador decide quién puede usarla', 'Votre administrateur décide qui peut l’utiliser', 'Ihr Administrator entscheidet, wer sie nutzen darf', 'يقرر المسؤول من يحق له استخدامه'],
      ['The same Help Center and queries as on the web', 'El mismo Centro de ayuda y consultas que en la web', 'Le même centre d’aide et les mêmes demandes que sur le web', 'Dasselbe Hilfe-Center und dieselben Anfragen wie im Web', 'مركز المساعدة والاستفسارات نفسها كما في الويب'],
      ['Your company’s colours and logo', 'Los colores y el logo de tu empresa', 'Les couleurs et le logo de votre entreprise', 'Farben und Logo Ihres Unternehmens', 'ألوان شركتك وشعارها'],
    ]),
  b('languages', 'facility', 'account', { icon: 'languages', tone: 4 }, [], ['page.themeStudio'],
    ['Five languages, right to left too', 'Cinco idiomas, también de derecha a izquierda', 'Cinq langues, y compris de droite à gauche', 'Fünf Sprachen, auch von rechts nach links', 'خمس لغات بما فيها من اليمين إلى اليسار'],
    ['Everyone works in their own language', 'Cada uno trabaja en su idioma', 'Chacun travaille dans sa langue', 'Alle arbeiten in ihrer Sprache', 'كل شخص يعمل بلغته'],
    [
      'Use SampForce in English, Spanish, French, German or Arabic. Screens, emails, PDFs, notifications, Help and AI answers follow each person’s language, and Arabic reads right to left.',
      'Usa SampForce en inglés, español, francés, alemán o árabe. Pantallas, correos, PDF, notificaciones, Ayuda y respuestas de IA siguen el idioma de cada persona, y el árabe se lee de derecha a izquierda.',
      'Utilisez SampForce en anglais, espagnol, français, allemand ou arabe. Écrans, e-mails, PDF, notifications, Aide et réponses IA suivent la langue de chacun, et l’arabe se lit de droite à gauche.',
      'Nutzen Sie SampForce auf Englisch, Spanisch, Französisch, Deutsch oder Arabisch. Bildschirme, E-Mails, PDFs, Benachrichtigungen, Hilfe und KI-Antworten folgen der Sprache jeder Person, Arabisch läuft von rechts nach links.',
      'استخدم SampForce بالإنجليزية أو الإسبانية أو الفرنسية أو الألمانية أو العربية. تتبع الشاشات والرسائل وملفات PDF والإشعارات والمساعدة وإجابات الذكاء الاصطناعي لغة كل شخص، وتُقرأ العربية من اليمين إلى اليسار.',
    ],
    [
      ['Change your language at any time', 'Cambia tu idioma cuando quieras', 'Changez de langue à tout moment', 'Sprache jederzeit ändern', 'غيّر لغتك متى شئت'],
      ['Arabic PDFs laid out correctly', 'PDF en árabe bien maquetados', 'PDF en arabe correctement mis en page', 'Arabische PDFs richtig gesetzt', 'ملفات PDF عربية بتنسيق صحيح'],
      ['Light, dark and your own themes', 'Temas claro, oscuro y propios', 'Thèmes clair, sombre et personnalisés', 'Helle, dunkle und eigene Designs', 'سمات فاتحة وداكنة وخاصة بك'],
    ]),
  b('help-support', 'facility', 'support', { icon: 'life-buoy', tone: 5 }, [], ['page.help', 'page.helpQueries'],
    ['Help and support', 'Ayuda y soporte', 'Aide et support', 'Hilfe und Support', 'المساعدة والدعم'],
    ['Answers in seconds, people when you need them', 'Respuestas en segundos, personas cuando las necesitas', 'Des réponses en quelques secondes, des humains si besoin', 'Antworten in Sekunden, Menschen wenn nötig', 'إجابات في ثوانٍ وأشخاص عند الحاجة'],
    [
      'Search answers and guides for everything you can use, open the i button on any page, and raise a query when you need a person. You get a reference number, notifications and the whole conversation in My queries.',
      'Busca respuestas y guías de todo lo que puedes usar, abre el botón i de cualquier página y envía una consulta cuando necesites a una persona. Recibes un número de referencia, avisos y toda la conversación en Mis consultas.',
      'Cherchez réponses et guides pour tout ce que vous pouvez utiliser, ouvrez le bouton i de chaque page et posez une question quand il vous faut quelqu’un. Vous recevez une référence, des notifications et tout l’échange dans Mes demandes.',
      'Durchsuchen Sie Antworten und Anleitungen zu allem, was Sie nutzen können, öffnen Sie die i-Schaltfläche jeder Seite und stellen Sie eine Anfrage, wenn Sie einen Menschen brauchen. Sie erhalten eine Referenznummer, Benachrichtigungen und das ganze Gespräch unter Meine Anfragen.',
      'ابحث في الإجابات والأدلة لكل ما يمكنك استخدامه، وافتح زر i في أي صفحة، وأرسل استفسارًا حين تحتاج إلى شخص. تحصل على رقم مرجعي وإشعارات والمحادثة كاملة في استفساراتي.',
    ],
    [
      ['Attach screenshots and the record it is about', 'Adjunta capturas y el registro afectado', 'Joignez captures et fiche concernée', 'Screenshots und den betroffenen Datensatz anhängen', 'أرفق لقطات الشاشة والسجل المعني'],
      ['Six clear statuses from Submitted to Closed', 'Seis estados claros, de Enviada a Cerrada', 'Six statuts clairs, de Envoyée à Clôturée', 'Sechs klare Status von Eingereicht bis Geschlossen', 'ست حالات واضحة من مُرسل إلى مغلق'],
      ['Ask by phone, email or in the app', 'Pregunta por teléfono, correo o en la app', 'Par téléphone, e-mail ou dans l’app', 'Per Telefon, E-Mail oder in der App', 'اسأل عبر الهاتف أو البريد أو التطبيق'],
    ]),
  b('hosting', 'facility', 'workspaces', { icon: 'server', tone: 6 }, [], ['page.workspaces'],
    ['Cloud or your own server', 'En la nube o en tu servidor', 'Dans le cloud ou sur votre serveur', 'In der Cloud oder auf Ihrem Server', 'في السحابة أو على خادمك'],
    ['Run SampForce where it suits you', 'Usa SampForce donde te convenga', 'Faites tourner SampForce où cela vous convient', 'SampForce dort betreiben, wo es passt', 'شغّل SampForce حيث يناسبك'],
    [
      'Use SampForce as a service, or run it on your own Ubuntu server with the self-hosting package. Workspaces can also use their own mail and chat servers.',
      'Usa SampForce como servicio o instálalo en tu propio servidor Ubuntu con el paquete de autoalojamiento. Los espacios también pueden usar sus propios servidores de correo y chat.',
      'Utilisez SampForce en service ou installez-le sur votre propre serveur Ubuntu avec le paquet d’auto-hébergement. Les espaces peuvent aussi utiliser leurs propres serveurs de messagerie et de chat.',
      'Nutzen Sie SampForce als Dienst oder betreiben Sie es mit dem Self-Hosting-Paket auf Ihrem eigenen Ubuntu-Server. Arbeitsbereiche können auch eigene Mail- und Chat-Server nutzen.',
      'استخدم SampForce كخدمة أو شغّله على خادم Ubuntu خاص بك بحزمة الاستضافة الذاتية. ويمكن لمساحات العمل أيضًا استخدام خوادم البريد والدردشة الخاصة بها.',
    ],
    [
      ['Send from your own SMTP server', 'Envía desde tu propio servidor SMTP', 'Envoyez depuis votre propre serveur SMTP', 'Über Ihren eigenen SMTP-Server senden', 'أرسل من خادم SMTP الخاص بك'],
      ['Team chat on your office network', 'Chat de equipo en la red de tu oficina', 'Chat d’équipe sur le réseau de votre bureau', 'Team-Chat im Büronetz', 'دردشة الفريق على شبكة مكتبك'],
      ['Keys entered once in the Console, never in files', 'Claves introducidas una vez en la Consola, nunca en archivos', 'Clés saisies une fois dans la Console, jamais dans des fichiers', 'Schlüssel einmal in der Konsole, nie in Dateien', 'المفاتيح تُدخل مرة في لوحة التحكم ولا تُحفظ في ملفات'],
    ]),
  b('ai-providers', 'facility', 'ai', { icon: 'cpu', tone: 1 }, ['ai_assistant'], ['page.agents'],
    ['Your choice of AI provider', 'El proveedor de IA que elijas', 'Le fournisseur d’IA de votre choix', 'KI-Anbieter Ihrer Wahl', 'مزوّد الذكاء الاصطناعي الذي تختاره'],
    ['AI that keeps working', 'IA que sigue funcionando', 'Une IA qui ne s’arrête pas', 'KI, die weiterläuft', 'ذكاء اصطناعي يواصل العمل'],
    [
      'SampForce works with Claude and also Gemini, Groq, OpenAI, Mistral, OpenRouter and Ollama. If one provider is unavailable, the next in your order answers instead.',
      'SampForce funciona con Claude y también con Gemini, Groq, OpenAI, Mistral, OpenRouter y Ollama. Si un proveedor no está disponible, responde el siguiente de tu lista.',
      'SampForce fonctionne avec Claude, mais aussi Gemini, Groq, OpenAI, Mistral, OpenRouter et Ollama. Si un fournisseur est indisponible, le suivant de votre liste répond.',
      'SampForce arbeitet mit Claude sowie Gemini, Groq, OpenAI, Mistral, OpenRouter und Ollama. Ist ein Anbieter nicht erreichbar, antwortet der nächste in Ihrer Reihenfolge.',
      'يعمل SampForce مع Claude وأيضًا Gemini وGroq وOpenAI وMistral وOpenRouter وOllama. إذا تعذّر مزوّد، يجيب التالي في ترتيبك.',
    ],
    [
      ['A fallback order set in the Console', 'Un orden de respaldo fijado en la Consola', 'Un ordre de secours défini dans la Console', 'Eine Ausweichreihenfolge in der Konsole', 'ترتيب بديل يُضبط في لوحة التحكم'],
      ['Run models on your own Ollama server', 'Ejecuta modelos en tu propio servidor Ollama', 'Faites tourner des modèles sur votre serveur Ollama', 'Modelle auf Ihrem eigenen Ollama-Server', 'شغّل النماذج على خادم Ollama الخاص بك'],
      ['AI credits shown per plan', 'Créditos de IA indicados por plan', 'Crédits IA indiqués par offre', 'KI-Credits pro Tarif ausgewiesen', 'أرصدة الذكاء الاصطناعي معروضة لكل خطة'],
    ]),
];

export const PRODUCT_BRIEF_BY_ID: Readonly<Record<string, ProductBrief>> = Object.fromEntries(PRODUCT_BRIEFS.map((x) => [x.id, x]));

/** How much of a brief the reader's plan and workspace include. */
export type BriefAvailability = 'included' | 'partial' | 'not-included';

export function briefAvailability(brief: Pick<ProductBrief, 'features'>, reader: HelpReader): BriefAvailability {
  if (reader.audience === 'console' || !brief.features.length) return 'included';
  const have = new Set(reader.features ?? []);
  const n = brief.features.filter((f) => have.has(f)).length;
  return n === brief.features.length ? 'included' : n ? 'partial' : 'not-included';
}

/** The first workspace page a brief's included features open on, for "Open". */
export function briefHref(brief: Pick<ProductBrief, 'features'>, reader: HelpReader): string | null {
  const have = new Set(reader.features ?? []);
  for (const f of brief.features) {
    if (!have.has(f)) continue;
    const path = FEATURE_BY_KEY[f]?.paths[0];
    if (path) return path;
  }
  return null;
}
