import type { PhraseTable } from './types';

/** The welcome banner on the home dashboards (redesign): the greeting and the line of the day. */
export const welcome = {
  'Working late': ['Trabajando hasta tarde', 'Encore au travail', 'Noch fleißig', 'تعمل حتى وقت متأخر'],
  'Every conversation today is a step closer to a win.': ['Cada conversación de hoy te acerca un paso más a una venta.', 'Chaque conversation aujourd’hui vous rapproche d’une victoire.', 'Jedes Gespräch heute bringt Sie einem Abschluss näher.', 'كل محادثة اليوم خطوة أقرب إلى الفوز.'],
  'Small follow-ups build big relationships.': ['Los pequeños seguimientos construyen grandes relaciones.', 'Les petites relances bâtissent de grandes relations.', 'Kleine Nachfassaktionen bauen große Beziehungen auf.', 'المتابعات الصغيرة تبني علاقات كبيرة.'],
  'Your next client is one good email away.': ['Tu próximo cliente está a un buen correo de distancia.', 'Votre prochain client n’est qu’à un bon e-mail.', 'Ihr nächster Kunde ist nur eine gute E-Mail entfernt.', 'عميلك القادم على بُعد رسالة بريد جيدة واحدة.'],
  'Focus on the few things that move deals forward.': ['Céntrate en lo poco que hace avanzar las oportunidades.', 'Concentrez-vous sur les quelques actions qui font avancer les affaires.', 'Konzentrieren Sie sich auf das Wenige, das Geschäfte voranbringt.', 'ركّز على الأمور القليلة التي تدفع الصفقات إلى الأمام.'],
  'Great teams celebrate progress, not just results.': ['Los grandes equipos celebran el avance, no solo los resultados.', 'Les grandes équipes célèbrent les progrès, pas seulement les résultats.', 'Großartige Teams feiern Fortschritte, nicht nur Ergebnisse.', 'الفرق العظيمة تحتفل بالتقدم، لا بالنتائج فقط.'],
  'Make today count: one call, one follow-up, one win.': ['Haz que hoy cuente: una llamada, un seguimiento, una victoria.', 'Faites compter aujourd’hui : un appel, une relance, une victoire.', 'Machen Sie heute etwas daraus: ein Anruf, ein Nachfassen, ein Erfolg.', 'اجعل اليوم مهمًا: مكالمة واحدة، متابعة واحدة، فوز واحد.'],
  'Consistency beats intensity. Keep showing up.': ['La constancia gana a la intensidad. Sigue presente.', 'La régularité l’emporte sur l’intensité. Continuez.', 'Beständigkeit schlägt Intensität. Bleiben Sie dran.', 'الاستمرارية تتفوق على الحماس المؤقت. واصل الحضور.'],
  // The live clock and today's special day (Kunal, 2026-11-27)
  'Current time': ['Hora actual', 'Heure actuelle', 'Aktuelle Uhrzeit', 'الوقت الحالي'],
  'Public holiday today': ['Hoy es festivo', 'Jour férié aujourd’hui', 'Heute ist Feiertag', 'عطلة رسمية اليوم'],
  'Celebrated today': ['Se celebra hoy', 'Célébré aujourd’hui', 'Heute wird gefeiert', 'يُحتفل به اليوم'],
  'Company event today': ['Evento de la empresa hoy', 'Événement de l’entreprise aujourd’hui', 'Firmenereignis heute', 'حدث الشركة اليوم'],
  // Company events (Settings > CRM configuration)
  'Company events': ['Eventos de la empresa', 'Événements de l’entreprise', 'Firmenereignisse', 'أحداث الشركة'],
  'Your own special days, such as a founding day, an annual party or an office closure. On the day, every home dashboard in your organisation shows it beside the clock, together with public holidays and well-known days.': [
    'Tus propios días especiales, como el aniversario de la fundación, la fiesta anual o un cierre de la oficina. Ese día, todos los paneles de inicio de tu organización lo muestran junto al reloj, con los festivos oficiales y los días conocidos.',
    'Vos propres journées spéciales, comme l’anniversaire de la création, la fête annuelle ou une fermeture des bureaux. Ce jour-là, chaque tableau de bord d’accueil de votre organisation l’affiche à côté de l’horloge, avec les jours fériés et les journées connues.',
    'Ihre eigenen besonderen Tage, etwa der Gründungstag, die jährliche Feier oder eine Büroschließung. An dem Tag zeigt jedes Start-Dashboard Ihrer Organisation ihn neben der Uhr, zusammen mit Feiertagen und bekannten Aktionstagen.',
    'أيامك الخاصة، مثل يوم التأسيس أو الحفل السنوي أو إغلاق المكتب. في ذلك اليوم تعرضه كل لوحة رئيسية في مؤسستك بجانب الساعة، مع العطل الرسمية والأيام المعروفة.',
  ],
  'No company events yet.': ['Aún no hay eventos de la empresa.', 'Aucun événement d’entreprise pour le moment.', 'Noch keine Firmenereignisse.', 'لا توجد أحداث للشركة بعد.'],
  'Event name': ['Nombre del evento', 'Nom de l’événement', 'Name des Ereignisses', 'اسم الحدث'],
  'Note (optional)': ['Nota (opcional)', 'Note (facultatif)', 'Notiz (optional)', 'ملاحظة (اختيارية)'],
  'Every year': ['Cada año', 'Chaque année', 'Jedes Jahr', 'كل عام'],
  'Add event': ['Añadir evento', 'Ajouter un événement', 'Ereignis hinzufügen', 'إضافة حدث'],
  'Give every event a name and a date.': ['Pon un nombre y una fecha a cada evento.', 'Donnez un nom et une date à chaque événement.', 'Geben Sie jedem Ereignis einen Namen und ein Datum.', 'أعطِ كل حدث اسمًا وتاريخًا.'],
  'Only administrators of the Super Workspace can change company events.': ['Solo los administradores del Super Workspace pueden cambiar los eventos de la empresa.', 'Seuls les administrateurs du Super Workspace peuvent modifier les événements de l’entreprise.', 'Nur Administratoren des Super Workspace können Firmenereignisse ändern.', 'يمكن لمسؤولي Super Workspace فقط تغيير أحداث الشركة.'],
} as const satisfies PhraseTable;
