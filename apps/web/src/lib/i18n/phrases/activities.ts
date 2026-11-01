import type { PhraseTable } from './types';

/** Sales Activities: the task list and the recent activity feed. */
export const activities = {
  'Sales Activities': ['Actividades de venta', 'Activités commerciales', 'Vertriebsaktivitäten', 'أنشطة المبيعات'],
  "Your tasks and the team's latest calls, emails, meetings and notes. Log activities from any lead, contact, company or deal.": [
    'Tus tareas y las últimas llamadas, correos, reuniones y notas del equipo. Registra actividades desde cualquier lead, contacto, empresa u oportunidad.',
    'Vos tâches et les derniers appels, e-mails, réunions et notes de l’équipe. Enregistrez des activités depuis n’importe quel prospect, contact, entreprise ou opportunité.',
    'Ihre Aufgaben und die neuesten Anrufe, E-Mails, Meetings und Notizen des Teams. Erfassen Sie Aktivitäten bei jedem Lead, Kontakt, Unternehmen oder jeder Verkaufschance.',
    'مهامك وأحدث مكالمات الفريق ورسائله واجتماعاته وملاحظاته. سجّل الأنشطة من أي عميل محتمل أو جهة اتصال أو شركة أو صفقة.',
  ],
  Tasks: ['Tareas', 'Tâches', 'Aufgaben', 'المهام'],
  '{count} overdue': ['{count} vencidas', '{count} en retard', '{count} überfällig', '{count} متأخرة'],
  'Whose tasks': ['Tareas de quién', 'Tâches de qui', 'Wessen Aufgaben', 'مهام مَن'],
  'My tasks': ['Mis tareas', 'Mes tâches', 'Meine Aufgaben', 'مهامي'],
  'New task': ['Nueva tarea', 'Nouvelle tâche', 'Neue Aufgabe', 'مهمة جديدة'],
  'New task…': ['Nueva tarea…', 'Nouvelle tâche…', 'Neue Aufgabe…', 'مهمة جديدة…'],
  Assignee: ['Asignada a', 'Assignée à', 'Zuständig', 'المُكلَّف'],
  'Assign to me': ['Asignármela', 'Me l’assigner', 'Mir zuweisen', 'إسنادها إليّ'],
  'Add task': ['Añadir tarea', 'Ajouter la tâche', 'Aufgabe hinzufügen', 'إضافة مهمة'],
  'Nothing to do. Nice work.': ['Nada pendiente. Buen trabajo.', 'Rien à faire. Beau travail.', 'Nichts zu tun. Gute Arbeit.', 'لا شيء لتفعله. عمل رائع.'],
  'No completed tasks yet.': ['Aún no hay tareas completadas.', 'Aucune tâche terminée pour l’instant.', 'Noch keine erledigten Aufgaben.', 'لا توجد مهام مكتملة بعد.'],
  'Reopen {title}': ['Reabrir {title}', 'Rouvrir {title}', '{title} wieder öffnen', 'إعادة فتح {title}'],
  'No activity logged yet. Open a record and use “Log activity”.': [
    'Aún no se ha registrado actividad. Abre un registro y usa «Registrar actividad».',
    'Aucune activité enregistrée. Ouvrez une fiche et utilisez « Enregistrer une activité ».',
    'Noch keine Aktivitäten erfasst. Öffnen Sie einen Datensatz und nutzen Sie „Aktivität erfassen“.',
    'لم يُسجَّل أي نشاط بعد. افتح سجلًا واستخدم «تسجيل نشاط».',
  ],
  Lead: ['Lead', 'Prospect', 'Lead', 'عميل محتمل'],
} as const satisfies PhraseTable;
