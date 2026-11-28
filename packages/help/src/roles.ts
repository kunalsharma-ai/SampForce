import type { WorkspaceLevel } from '@dealflow/types';
import type { HelpReader } from './access';
import type { HelpId } from './topics';
import type { HelpText } from './types';

/**
 * "Start here" guides for each role (ADR 0073): the pages a Console administrator, a Super Workspace administrator,
 * and people in Super, Manager and Executive Workspaces use first, in the order to learn them. Only pages the reader
 * can use are shown, so each list follows the plan and role like the rest of Help.
 */
export type HelpRole = 'console' | 'superAdmin' | WorkspaceLevel;

export interface RoleGuide {
  role: HelpRole;
  title: HelpText;
  intro: HelpText;
  pages: readonly HelpId[];
}

export const ROLE_GUIDES: Readonly<Record<HelpRole, RoleGuide>> = {
  console: {
    role: 'console',
    title: ['Console Admin', 'Administrador de la Consola', 'Administrateur de la Console', 'Konsolen-Administrator', 'مسؤول لوحة التحكم'],
    intro: [
      'Set up clients and their plans, keep provider keys working, answer support tickets and keep Help up to date.',
      'Da de alta clientes y sus planes, mantén las claves de proveedores, responde tickets de soporte y mantén la Ayuda al día.',
      'Créez les clients et leurs offres, gardez les clés des fournisseurs valides, répondez aux tickets et tenez l’Aide à jour.',
      'Kunden und Tarife anlegen, Anbieterschlüssel pflegen, Support-Tickets beantworten und die Hilfe aktuell halten.',
      'أعدّ العملاء وخططهم، وحافظ على مفاتيح المزوّدين، وأجب عن تذاكر الدعم، وحدّث المساعدة.',
    ],
    pages: ['page.consoleOverview', 'page.operatorNotifications', 'page.operatorWorkspaces', 'page.operatorCreateClient', 'page.operatorSubscriptions', 'page.operatorPlans', 'page.operatorProviders', 'page.operatorLocations', 'page.operatorSupport', 'page.operatorHelpManage', 'page.operatorAudit', 'page.operatorOperators', 'page.operatorRoles', 'page.operatorAccount', 'page.operatorSecurity'],
  },
  superAdmin: {
    role: 'superAdmin',
    title: ['Super Admin', 'Superadministrador', 'Super-administrateur', 'Super-Admin', 'المسؤول الأعلى'],
    intro: [
      'Shape the organisation: create Manager and Executive Workspaces, invite people, set roles and settings, bring in your data and manage billing.',
      'Organiza la empresa: crea espacios Manager y Executive, invita personas, define roles y ajustes, importa tus datos y gestiona la facturación.',
      'Organisez l’entreprise : créez les espaces Manager et Executive, invitez, définissez rôles et réglages, importez vos données et gérez la facturation.',
      'Organisation gestalten: Manager- und Executive-Arbeitsbereiche anlegen, Personen einladen, Rollen und Einstellungen festlegen, Daten importieren, Abrechnung verwalten.',
      'نظّم مؤسستك: أنشئ مساحات المدير والتنفيذي، وادعُ الأشخاص، وحدّد الأدوار والإعدادات، واستورد بياناتك وأدر الفوترة.',
    ],
    pages: ['page.commandCenter', 'page.workspaces', 'page.team', 'page.settings', 'page.import', 'page.crmConfiguration', 'page.billing', 'page.workspaceSecurity'],
  },
  SUPER: {
    role: 'SUPER',
    title: ['Super Workspace', 'Espacio Super', 'Espace Super', 'Super-Arbeitsbereich', 'مساحة Super'],
    intro: [
      'See the whole organisation: its pipeline, targets, teams and reports, and follow up where it matters.',
      'Ve toda la organización: su embudo, objetivos, equipos e informes, y actúa donde importa.',
      'Voyez toute l’organisation : pipeline, objectifs, équipes et rapports, et agissez là où c’est utile.',
      'Die ganze Organisation im Blick: Pipeline, Ziele, Teams und Berichte, und dort nachfassen, wo es zählt.',
      'شاهد المؤسسة كلها: مسار الصفقات والأهداف والفرق والتقارير، وتابع حيث يهم.',
    ],
    pages: ['page.commandCenter', 'page.workspaces', 'page.targets', 'page.deals', 'page.companies', 'page.reports', 'page.forecasting'],
  },
  MANAGER: {
    role: 'MANAGER',
    title: ['Manager Workspace', 'Espacio Manager', 'Espace Manager', 'Manager-Arbeitsbereich', 'مساحة المدير'],
    intro: [
      'Run your team: set targets, hand out tasks, watch your branch’s deals and answer your team’s queries.',
      'Dirige tu equipo: fija objetivos, reparte tareas, sigue las oportunidades de tu sucursal y responde las consultas de tu equipo.',
      'Dirigez votre équipe : fixez des objectifs, distribuez des tâches, suivez les opportunités de votre site et répondez aux demandes de votre équipe.',
      'Führen Sie Ihr Team: Ziele setzen, Aufgaben verteilen, die Verkaufschancen Ihrer Niederlassung verfolgen und Anfragen Ihres Teams beantworten.',
      'أدِر فريقك: حدّد الأهداف ووزّع المهام وتابع صفقات فرعك وأجب عن استفسارات فريقك.',
    ],
    pages: ['page.commandCenter', 'page.workspaces', 'page.targets', 'page.tasks', 'page.deals', 'page.activities', 'page.reports', 'page.helpQueries'],
  },
  EXECUTIVE: {
    role: 'EXECUTIVE',
    title: ['Executive Workspace', 'Espacio Executive', 'Espace Executive', 'Executive-Arbeitsbereich', 'مساحة التنفيذي'],
    intro: [
      'Do the selling: work your companies and contacts, move deals forward, log activities and keep your tasks and targets on track.',
      'Vende: trabaja tus empresas y contactos, haz avanzar las oportunidades, registra actividades y mantén al día tus tareas y objetivos.',
      'Vendez : travaillez vos entreprises et contacts, faites avancer les opportunités, consignez les activités et tenez vos tâches et objectifs.',
      'Verkaufen Sie: Bearbeiten Sie Ihre Unternehmen und Kontakte, bringen Sie Verkaufschancen voran, erfassen Sie Aktivitäten und halten Sie Aufgaben und Ziele auf Kurs.',
      'قم بالبيع: اعمل على شركاتك وجهات اتصالك، وادفع الصفقات إلى الأمام، وسجّل الأنشطة، وحافظ على مهامك وأهدافك في مسارها.',
    ],
    pages: ['page.commandCenter', 'page.leads', 'page.companies', 'page.deals', 'page.activities', 'page.tasks', 'page.targets', 'page.helpQueries'],
  },
};

/** The reader's role guide: the Console, the Super Workspace's administrators, or their workspace level. */
export function roleGuideFor(reader: HelpReader): RoleGuide {
  if (reader.audience === 'console') return ROLE_GUIDES.console;
  const level = reader.level ?? 'SUPER';
  if (level === 'SUPER' && reader.permissions?.includes('tenant:manage')) return ROLE_GUIDES.superAdmin;
  return ROLE_GUIDES[level];
}
