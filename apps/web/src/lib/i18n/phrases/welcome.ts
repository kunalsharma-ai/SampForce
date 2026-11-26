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
} as const satisfies PhraseTable;
