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
} as const satisfies PhraseTable;
