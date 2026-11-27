import type { PhraseTable } from './types';

/** Selecting every matching record on every page of a list, and acting on all of them at once. */
export const bulkSelect = {
  'Select all {items}': ['Seleccionar los {items}', 'Sélectionner les {items}', 'Alle {items} auswählen', 'تحديد كل {items}'],
  'All {items} selected, on every page': [
    'Seleccionados los {items}, en todas las páginas',
    '{items} sélectionnés, sur toutes les pages',
    'Alle {items} ausgewählt, auf allen Seiten',
    'تم تحديد كل {items} في جميع الصفحات',
  ],
  'This deletes every record that matches this list, on every page, not only the rows you can see.': [
    'Esto elimina todos los registros que coinciden con esta lista, en todas las páginas, no solo las filas que ves.',
    'Cela supprime tous les enregistrements correspondant à cette liste, sur toutes les pages, pas seulement les lignes visibles.',
    'Damit werden alle Datensätze dieser Liste gelöscht, auf allen Seiten, nicht nur die sichtbaren Zeilen.',
    'سيؤدي هذا إلى حذف كل السجلات المطابقة لهذه القائمة في جميع الصفحات، وليس الصفوف الظاهرة فقط.',
  ],
  // Delete all on lists that are not tables (ADR 0096)
  'Delete all': ['Eliminar todo', 'Tout supprimer', 'Alle löschen', 'حذف الكل'],
  'Counting…': ['Contando…', 'Décompte…', 'Wird gezählt…', 'جارٍ العدّ…'],
  'Delete all {count}': ['Eliminar los {count}', 'Supprimer les {count}', 'Alle {count} löschen', 'حذف الكل ({count})'],
  'Delete everything in this list?': ['¿Eliminar todo lo de esta lista?', 'Tout supprimer dans cette liste ?', 'Alles in dieser Liste löschen?', 'حذف كل ما في هذه القائمة؟'],
  'This deletes all {count} records this list shows with its current filters, not only the ones you can see.': [
    'Esto elimina los {count} registros que muestra esta lista con sus filtros actuales, no solo los que ves.',
    'Cela supprime les {count} enregistrements que cette liste affiche avec ses filtres actuels, pas seulement ceux que vous voyez.',
    'Damit werden alle {count} Datensätze gelöscht, die diese Liste mit ihren aktuellen Filtern zeigt, nicht nur die sichtbaren.',
    'سيؤدي هذا إلى حذف كل السجلات ({count}) التي تعرضها هذه القائمة بعوامل التصفية الحالية، وليس الظاهرة فقط.',
  ],
} as const satisfies PhraseTable;
