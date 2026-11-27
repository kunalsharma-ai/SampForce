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
  // Removing unwanted information from a company or contact (ADR 0097)
  'Delete {item}': ['Eliminar {item}', 'Supprimer {item}', '{item} löschen', 'حذف {item}'],
  'Delete employee': ['Eliminar empleado', "Supprimer l'employé", 'Person löschen', 'حذف الموظف'],
  'Use Delete beside a field, or remove a line from a list, to delete unwanted details. Nothing is deleted until you press Save.': [
    'Usa Eliminar junto a un campo, o quita una línea de una lista, para borrar datos que no quieres. No se borra nada hasta que pulses Guardar.',
    "Utilisez Supprimer à côté d'un champ, ou retirez une ligne d'une liste, pour effacer les informations inutiles. Rien n'est supprimé avant d'appuyer sur Enregistrer.",
    'Mit „Löschen“ neben einem Feld oder durch Entfernen einer Zeile aus einer Liste löschen Sie unerwünschte Angaben. Gelöscht wird erst, wenn Sie auf Speichern klicken.',
    'استخدم حذف بجانب الحقل، أو احذف سطرًا من القائمة، لحذف البيانات غير المرغوبة. لا يُحذف شيء حتى تضغط حفظ.',
  ],
  'Could not delete this record.': ['No se pudo eliminar este registro.', "Impossible de supprimer cet enregistrement.", 'Dieser Datensatz konnte nicht gelöscht werden.', 'تعذّر حذف هذا السجل.'],
  'Delete all employees': ['Eliminar todos los empleados', 'Supprimer tous les employés', 'Alle Mitarbeitenden löschen', 'حذف كل الموظفين'],
  'Delete all {count} shown': ['Eliminar los {count} mostrados', 'Supprimer les {count} affichés', 'Alle {count} angezeigten löschen', 'حذف المعروضين ({count})'],
  'Delete employees?': ['¿Eliminar empleados?', 'Supprimer des employés ?', 'Mitarbeitende löschen?', 'حذف الموظفين؟'],
  'Delete selected ({count})': ['Eliminar seleccionados ({count})', 'Supprimer la sélection ({count})', 'Auswahl löschen ({count})', 'حذف المحدد ({count})'],
  'Delete this employee?': ['¿Eliminar este empleado?', 'Supprimer cet employé ?', 'Diese Person löschen?', 'حذف هذا الموظف؟'],
  'Delete {count} employees?': ['¿Eliminar {count} empleados?', 'Supprimer {count} employés ?', '{count} Mitarbeitende löschen?', 'حذف {count} من الموظفين؟'],
  'Delete {count}': ['Eliminar {count}', 'Supprimer {count}', '{count} löschen', 'حذف {count}'],
  'Deleting…': ['Eliminando…', 'Suppression…', 'Wird gelöscht…', 'جارٍ الحذف…'],
  'Select all employees': ['Seleccionar todos los empleados', 'Sélectionner tous les employés', 'Alle Mitarbeitenden auswählen', 'تحديد كل الموظفين'],
  'This deletes the contact records themselves, with their details. To keep a person but take them off this company, use Remove from company instead.': [
    'Esto elimina los propios registros de contacto, con sus datos. Para conservar a una persona pero quitarla de esta empresa, usa Quitar de la empresa.',
    "Cela supprime les fiches contact elles-mêmes, avec leurs informations. Pour garder une personne mais la retirer de cette entreprise, utilisez plutôt Retirer de l'entreprise.",
    'Damit werden die Kontaktdatensätze selbst mit ihren Angaben gelöscht. Um eine Person zu behalten, sie aber von diesem Unternehmen zu lösen, nutzen Sie stattdessen „Vom Unternehmen entfernen“.',
    'سيؤدي هذا إلى حذف سجلات جهات الاتصال نفسها مع بياناتها. للإبقاء على الشخص مع إزالته من هذه الشركة، استخدم الإزالة من الشركة بدلًا من ذلك.',
  ],
} as const satisfies PhraseTable;
