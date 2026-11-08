import type { PhraseTable } from './types';

/** Plan features (ADR 0057): the upgrade page, the sidebar locks and the feature list on the Billing page. */
export const plans = {
  '{feature} is not in your plan': ['{feature} no está en tu plan', '{feature} n’est pas dans votre offre', '{feature} ist nicht in Ihrem Tarif', '{feature} ليست ضمن خطتك'],
  'Not in your plan': ['No está en tu plan', 'Pas dans votre offre', 'Nicht in Ihrem Tarif', 'ليست ضمن خطتك'],
  'Your workspace is on the {plan} plan.': [
    'Tu espacio de trabajo está en el plan {plan}.',
    'Votre espace de travail est sur l’offre {plan}.',
    'Ihr Arbeitsbereich nutzt den Tarif {plan}.',
    'مساحة عملك على خطة {plan}.',
  ],
  '{feature} is included from the {plan} plan.': [
    '{feature} se incluye a partir del plan {plan}.',
    '{feature} est inclus à partir de l’offre {plan}.',
    '{feature} ist ab dem Tarif {plan} enthalten.',
    '{feature} مشمولة بدءًا من خطة {plan}.',
  ],
  'Nothing you created is deleted. It is all here again when your plan includes this feature.': [
    'No se borra nada de lo que creaste. Todo vuelve a estar aquí cuando tu plan incluya esta función.',
    'Rien de ce que vous avez créé n’est supprimé. Tout réapparaît dès que votre offre inclut cette fonctionnalité.',
    'Nichts, was Sie erstellt haben, wird gelöscht. Alles ist wieder da, sobald Ihr Tarif diese Funktion enthält.',
    'لا يُحذف أي شيء أنشأته. سيعود كل شيء هنا عندما تتضمن خطتك هذه الميزة.',
  ],
  'See plans and upgrade': ['Ver planes y mejorar', 'Voir les offres et passer à la supérieure', 'Tarife ansehen und upgraden', 'عرض الخطط والترقية'],
  'Ask a workspace admin to upgrade the plan.': [
    'Pide a un administrador del espacio de trabajo que mejore el plan.',
    'Demandez à un administrateur de l’espace de travail de changer d’offre.',
    'Bitten Sie einen Admin des Arbeitsbereichs, den Tarif zu upgraden.',
    'اطلب من مسؤول مساحة العمل ترقية الخطة.',
  ],
  'Features in your plan': ['Funciones de tu plan', 'Fonctionnalités de votre offre', 'Funktionen in Ihrem Tarif', 'الميزات في خطتك'],
  '{n} of {total} features': ['{n} de {total} funciones', '{n} sur {total} fonctionnalités', '{n} von {total} Funktionen', '{n} من {total} ميزة'],
  'Included': ['Incluida', 'Incluse', 'Enthalten', 'مشمولة'],
  'added for your workspace': ['añadida para tu espacio de trabajo', 'ajoutée pour votre espace de travail', 'für Ihren Arbeitsbereich hinzugefügt', 'مضافة لمساحة عملك'],
  'turned off for your workspace': ['desactivada para tu espacio de trabajo', 'désactivée pour votre espace de travail', 'für Ihren Arbeitsbereich abgeschaltet', 'متوقفة لمساحة عملك'],
  'Not included': ['No incluida', 'Non incluse', 'Nicht enthalten', 'غير مشمولة'],
  'Compare features': ['Comparar funciones', 'Comparer les fonctionnalités', 'Funktionen vergleichen', 'قارن الميزات'],
  Feature: ['Función', 'Fonctionnalité', 'Funktion', 'الميزة'],
} as const satisfies PhraseTable;
