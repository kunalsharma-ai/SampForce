import type { PhraseTable } from './types';

/** The workspace hierarchy (ADR 0071): the header badge, the profile menu and the locked page. */
export const workspaces = {
  'Super Workspace': ['Espacio principal', 'Espace principal', 'Super-Arbeitsbereich', 'مساحة العمل الرئيسية'],
  'Manager Workspace': ['Espacio de gerente', 'Espace manager', 'Manager-Arbeitsbereich', 'مساحة عمل المدير'],
  'Executive Workspace': ['Espacio de ejecutivo', 'Espace commercial', 'Executive-Arbeitsbereich', 'مساحة عمل التنفيذي'],
  'Client Administrator': ['Administrador del cliente', 'Administrateur client', 'Kundenadministration', 'مسؤول العميل'],
  'Active workspace': ['Espacio de trabajo activo', 'Espace de travail actif', 'Aktiver Arbeitsbereich', 'مساحة العمل النشطة'],
  'Organisation: {name}': ['Organización: {name}', 'Organisation : {name}', 'Organisation: {name}', 'المؤسسة: {name}'],
  '{feature} is not available in your workspace': ['{feature} no está disponible en tu espacio de trabajo', '{feature} n’est pas disponible dans votre espace de travail', '{feature} ist in Ihrem Arbeitsbereich nicht verfügbar', '{feature} غير متاحة في مساحة عملك'],
  'Your organisation’s plan includes it, but the workspace above yours has not handed it to this workspace. Ask its administrator if you need it.': [
    'El plan de tu organización lo incluye, pero el espacio superior no lo ha concedido a este espacio. Pídeselo a su administrador si lo necesitas.',
    'L’offre de votre organisation l’inclut, mais l’espace au-dessus du vôtre ne l’a pas accordé à cet espace. Demandez-le à son administrateur si besoin.',
    'Der Tarif Ihrer Organisation enthält es, aber der übergeordnete Arbeitsbereich hat es diesem Arbeitsbereich nicht freigegeben. Fragen Sie dessen Administration.',
    'تتضمنها خطة مؤسستك، لكن مساحة العمل الأعلى لم تمنحها لهذه المساحة. اطلبها من مسؤولها إن احتجت إليها.',
  ],
} as const satisfies PhraseTable;
