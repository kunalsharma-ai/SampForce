import type { PhraseTable } from './types';

/** Hidden sections the Super Workspace can show again (redesign, menu). */
export const menuSections = {
  'Hidden sections': ['Secciones ocultas', 'Sections masquées', 'Ausgeblendete Bereiche', 'الأقسام المخفية'],
  'Leads and Accounts are hidden everywhere until you show them here. The change applies to every workspace in your organisation.': [
    'Leads y Cuentas están ocultos en todas partes hasta que los muestres aquí. El cambio se aplica a todos los espacios de trabajo de tu organización.',
    'Prospects et Comptes sont masqués partout tant que vous ne les affichez pas ici. Le changement s’applique à tous les espaces de travail de votre organisation.',
    'Leads und Konten sind überall ausgeblendet, bis Sie sie hier einblenden. Die Änderung gilt für alle Arbeitsbereiche Ihrer Organisation.',
    'العملاء المحتملون والحسابات مخفية في كل مكان حتى تُظهرها هنا. يسري التغيير على كل مساحات العمل في مؤسستك.',
  ],
  'Show the Leads page': ['Mostrar la página de Leads', 'Afficher la page Prospects', 'Seite „Leads“ anzeigen', 'إظهار صفحة العملاء المحتملين'],
  'A separate list for inbound leads. Off: leads live with their companies and contacts.': [
    'Una lista aparte para los leads entrantes. Desactivada: los leads están con sus empresas y contactos.',
    'Une liste à part pour les prospects entrants. Désactivée : les prospects restent avec leurs entreprises et contacts.',
    'Eine eigene Liste für eingehende Leads. Aus: Leads liegen bei ihren Unternehmen und Kontakten.',
    'قائمة منفصلة للعملاء المحتملين الواردين. عند الإيقاف: يبقى العملاء المحتملون مع شركاتهم وجهات اتصالهم.',
  ],
  'Show the Accounts page': ['Mostrar la página de Cuentas', 'Afficher la page Comptes', 'Seite „Konten“ anzeigen', 'إظهار صفحة الحسابات'],
  'A separate list of accounts. Off: Companies is the account list.': [
    'Una lista aparte de cuentas. Desactivada: Empresas es la lista de cuentas.',
    'Une liste à part des comptes. Désactivée : Entreprises est la liste des comptes.',
    'Eine eigene Kontenliste. Aus: Unternehmen ist die Kontenliste.',
    'قائمة منفصلة للحسابات. عند الإيقاف: قائمة الشركات هي قائمة الحسابات.',
  ],
} as const satisfies PhraseTable;
