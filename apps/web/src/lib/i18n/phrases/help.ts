import type { PhraseTable } from './types';

/** The "i" help buttons and the Help center's feature guide. The help sentences themselves live in lib/help. */
export const help = {
  'What is this?': ['¿Qué es esto?', 'Qu’est-ce que c’est ?', 'Was ist das?', 'ما هذا؟'],
  'About {topic}': ['Acerca de {topic}', 'À propos de {topic}', 'Über {topic}', 'حول {topic}'],
  'What it is for': ['Para qué sirve', 'À quoi ça sert', 'Wofür es da ist', 'الغرض منه'],
  'How to use it': ['Cómo usarlo', 'Comment l’utiliser', 'So nutzen Sie es', 'طريقة استخدامه'],
  'Where to use it': ['Dónde usarlo', 'Quand l’utiliser', 'Wann Sie es nutzen', 'متى تستخدمه'],
  // Section and page names that appear only in help.
  Targets: ['Objetivos', 'Objectifs', 'Ziele', 'الأهداف'],
  'Language & region': ['Idioma y región', 'Langue et région', 'Sprache & Region', 'اللغة والمنطقة'],
  Workspaces: ['Espacios de trabajo', 'Espaces de travail', 'Arbeitsbereiche', 'مساحات العمل'],
  Providers: ['Proveedores', 'Fournisseurs', 'Anbieter', 'المزوّدون'],
  'Operator log': ['Registro de operadores', 'Journal des opérateurs', 'Betreiberprotokoll', 'سجل المشغّلين'],
  // Help center feature guide
  'Feature guide': ['Guía de funciones', 'Guide des fonctions', 'Funktionsleitfaden', 'دليل الميزات'],
  'What every page and section is for, how to use it and when it helps. The same help opens from the i button next to each title.': [
    'Para qué sirve cada página y sección, cómo usarla y cuándo ayuda. La misma ayuda se abre con el botón i junto a cada título.',
    'À quoi sert chaque page et section, comment l’utiliser et quand elle aide. La même aide s’ouvre avec le bouton i à côté de chaque titre.',
    'Wofür jede Seite und jeder Bereich da ist, wie Sie ihn nutzen und wann er hilft. Dieselbe Hilfe öffnet die i-Schaltfläche neben jedem Titel.',
    'الغرض من كل صفحة وقسم وطريقة استخدامه ومتى يفيد. تُفتح المساعدة نفسها من زر i بجانب كل عنوان.',
  ],
  'Search features': ['Buscar funciones', 'Rechercher une fonction', 'Funktionen suchen', 'ابحث في الميزات'],
  'No feature matches “{query}”.': ['Ninguna función coincide con «{query}».', 'Aucune fonction ne correspond à « {query} ».', 'Keine Funktion passt zu „{query}“.', 'لا توجد ميزة تطابق «{query}».'],
  'Open page': ['Abrir página', 'Ouvrir la page', 'Seite öffnen', 'افتح الصفحة'],
  'Sections on this page': ['Secciones de esta página', 'Sections de cette page', 'Bereiche auf dieser Seite', 'أقسام هذه الصفحة'],
} as const satisfies PhraseTable;
