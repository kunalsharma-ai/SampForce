import type { PhraseTable } from './types';

/** Company export to Excel and CSV (ADR 0079): the Export menu on the Companies list and on a company page. */
export const companyExport = {
  Export: ['Exportar', 'Exporter', 'Exportieren', 'تصدير'],
  'Export this company with its employees': ['Exportar esta empresa con sus empleados', 'Exporter cette entreprise avec ses employés', 'Dieses Unternehmen mit seinen Mitarbeitern exportieren', 'تصدير هذه الشركة مع موظفيها'],
  'Export the companies in this list': ['Exportar las empresas de esta lista', 'Exporter les entreprises de cette liste', 'Die Unternehmen dieser Liste exportieren', 'تصدير الشركات في هذه القائمة'],
  'Excel workbook (.xlsx)': ['Libro de Excel (.xlsx)', 'Classeur Excel (.xlsx)', 'Excel-Arbeitsmappe (.xlsx)', 'مصنف Excel (.xlsx)'],
  'Companies, employees, branches and interactions on separate sheets': [
    'Empresas, empleados, sucursales e interacciones en hojas separadas',
    'Entreprises, employés, agences et interactions sur des feuilles séparées',
    'Unternehmen, Mitarbeiter, Niederlassungen und Interaktionen auf getrennten Blättern',
    'الشركات والموظفون والفروع والتفاعلات في أوراق منفصلة',
  ],
  'CSV: companies': ['CSV: empresas', 'CSV : entreprises', 'CSV: Unternehmen', 'CSV: الشركات'],
  'CSV: employees': ['CSV: empleados', 'CSV : employés', 'CSV: Mitarbeiter', 'CSV: الموظفون'],
  'CSV: branches': ['CSV: sucursales', 'CSV : agences', 'CSV: Niederlassungen', 'CSV: الفروع'],
  'CSV: interactions': ['CSV: interacciones', 'CSV : interactions', 'CSV: Interaktionen', 'CSV: التفاعلات'],
} as const satisfies PhraseTable;
