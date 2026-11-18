import type { PhraseTable } from './types';

/** Edit everywhere (ADR 0065): edit dialogs for activities, interactions, tasks, follow-ups, concerns, instructions, transfer requests and files. */
export const edit = {
  'Edit “{subject}”': ['Editar «{subject}»', 'Modifier « {subject} »', '„{subject}“ bearbeiten', 'تعديل «{subject}»'],
  'Edit activity': ['Editar actividad', 'Modifier l’activité', 'Aktivität bearbeiten', 'تعديل النشاط'],
  'Changes are saved to this activity and kept in the audit log.': [
    'Los cambios se guardan en esta actividad y quedan en el registro de auditoría.',
    'Les modifications sont enregistrées dans cette activité et conservées dans le journal d’audit.',
    'Änderungen werden in dieser Aktivität gespeichert und im Prüfprotokoll festgehalten.',
    'تُحفظ التغييرات في هذا النشاط وتُسجَّل في سجل التدقيق.',
  ],
  'Set by the interaction type. Change it from the company page.': [
    'Lo determina el tipo de interacción. Cámbialo desde la página de la empresa.',
    'Défini par le type d’interaction. Modifiez-le depuis la page de l’entreprise.',
    'Durch die Art der Interaktion festgelegt. Ändern Sie sie auf der Seite des Unternehmens.',
    'يحدده نوع التفاعل. غيّره من صفحة الشركة.',
  ],
  'Edit interaction': ['Editar interacción', 'Modifier l’interaction', 'Interaktion bearbeiten', 'تعديل التفاعل'],
  'With {company}. Changes are saved to this interaction and kept in the audit log.': [
    'Con {company}. Los cambios se guardan en esta interacción y quedan en el registro de auditoría.',
    'Avec {company}. Les modifications sont enregistrées dans cette interaction et conservées dans le journal d’audit.',
    'Mit {company}. Änderungen werden in dieser Interaktion gespeichert und im Prüfprotokoll festgehalten.',
    'مع {company}. تُحفظ التغييرات في هذا التفاعل وتُسجَّل في سجل التدقيق.',
  ],
  'Edit task': ['Editar tarea', 'Modifier la tâche', 'Aufgabe bearbeiten', 'تعديل المهمة'],
  'Change what the task is, when it is due and who does it.': [
    'Cambia de qué trata la tarea, cuándo vence y quién la hace.',
    'Modifiez l’objet de la tâche, son échéance et la personne qui s’en charge.',
    'Ändern Sie, worum es in der Aufgabe geht, wann sie fällig ist und wer sie erledigt.',
    'غيّر موضوع المهمة وموعد استحقاقها ومن يتولاها.',
  ],
  'Edit follow-up': ['Editar seguimiento', 'Modifier la relance', 'Nachfassen bearbeiten', 'تعديل المتابعة'],
  'Edit client concern': ['Editar inquietud del cliente', 'Modifier la préoccupation client', 'Kundenanliegen bearbeiten', 'تعديل ملاحظة العميل'],
  'Edit instruction': ['Editar instrucción', 'Modifier l’instruction', 'Anweisung bearbeiten', 'تعديل التعليمات'],
  'They are told it changed and see the new wording.': [
    'Se le avisa del cambio y ve el texto nuevo.',
    'La personne est informée du changement et voit le nouveau texte.',
    'Die Person wird über die Änderung informiert und sieht den neuen Wortlaut.',
    'يُبلَّغ بالتغيير ويرى الصياغة الجديدة.',
  ],
  'Edit transfer request': ['Editar solicitud de traspaso', 'Modifier la demande de transfert', 'Übergabeanfrage bearbeiten', 'تعديل طلب النقل'],
  'File name': ['Nombre del archivo', 'Nom du fichier', 'Dateiname', 'اسم الملف'],
  'Save file name': ['Guardar nombre del archivo', 'Enregistrer le nom du fichier', 'Dateinamen speichern', 'حفظ اسم الملف'],
  'Rename {name}': ['Renombrar {name}', 'Renommer {name}', '{name} umbenennen', 'إعادة تسمية {name}'],
} as const satisfies PhraseTable;
