import type { PhraseTable } from './types';

/** The role and workflow redesign (ADR 0081): the header, working status and team status. */
export const redesign = {
  // Header
  'Search companies, contacts, deals, tasks...': ['Busca empresas, contactos, acuerdos, tareas...', 'Rechercher entreprises, contacts, affaires, tâches...', 'Firmen, Kontakte, Deals, Aufgaben suchen...', 'ابحث عن الشركات وجهات الاتصال والصفقات والمهام...'],
  'Add this page to favourites': ['Añadir esta página a favoritos', 'Ajouter cette page aux favoris', 'Diese Seite zu Favoriten hinzufügen', 'أضف هذه الصفحة إلى المفضلة'],
  'Remove this page from favourites': ['Quitar esta página de favoritos', 'Retirer cette page des favoris', 'Diese Seite aus Favoriten entfernen', 'أزل هذه الصفحة من المفضلة'],
  'Help Center': ['Centro de ayuda', 'Centre d’aide', 'Hilfecenter', 'مركز المساعدة'],

  // Working status
  'Working': ['Trabajando', 'Au travail', 'Bei der Arbeit', 'يعمل'],
  'On break': ['En pausa', 'En pause', 'In der Pause', 'في استراحة'],
  'Away': ['Ausente', 'Absent', 'Abwesend', 'غير موجود'],
  'Checked out': ['Salida fichada', 'Départ pointé', 'Ausgecheckt', 'تم الانصراف'],
  'Checked in': ['Entrada fichada', 'Arrivée pointée', 'Eingecheckt', 'تم الحضور'],
  'Check in': ['Fichar entrada', 'Pointer l’arrivée', 'Einchecken', 'تسجيل الحضور'],
  'Check out': ['Fichar salida', 'Pointer le départ', 'Auschecken', 'تسجيل الانصراف'],
  'Break': ['Pausa', 'Pause', 'Pause', 'استراحة'],
  'Breaks': ['Pausas', 'Pauses', 'Pausen', 'الاستراحات'],
  'Worked today': ['Trabajado hoy', 'Travaillé aujourd’hui', 'Heute gearbeitet', 'العمل اليوم'],
  '{h} h {m} min': ['{h} h {m} min', '{h} h {m} min', '{h} Std. {m} Min.', '{h} س {m} د'],
  '{m} min': ['{m} min', '{m} min', '{m} Min.', '{m} د'],
  '{n} · {time}': ['{n} · {time}', '{n} · {time}', '{n} · {time}', '{n} · {time}'],
  'Your status: {status}, {since}': ['Tu estado: {status}, {since}', 'Votre statut : {status}, {since}', 'Ihr Status: {status}, {since}', 'حالتك: {status}، {since}'],
  'Your status: {status}': ['Tu estado: {status}', 'Votre statut : {status}', 'Ihr Status: {status}', 'حالتك: {status}'],
  'Set your status': ['Elige tu estado', 'Choisir votre statut', 'Status festlegen', 'حدّد حالتك'],
  'No SampForce page was open for a while, so you show as away. Any click brings you back.': [
    'No tuviste ninguna página de SampForce abierta durante un rato, así que apareces como ausente. Cualquier clic te devuelve.',
    'Aucune page SampForce n’était ouverte depuis un moment, vous apparaissez donc absent. Un clic suffit pour revenir.',
    'Eine Weile war keine SampForce-Seite geöffnet, deshalb erscheinen Sie als abwesend. Ein Klick genügt, um zurückzukehren.',
    'لم تكن أي صفحة من SampForce مفتوحة لفترة، لذلك تظهر غير موجود. أي نقرة تعيدك.',
  ],
  'Team status': ['Estado del equipo', 'Statut de l’équipe', 'Teamstatus', 'حالة الفريق'],
  'Who is working, on a break, away or checked out right now, with today’s check-in and working time.': [
    'Quién está trabajando, en pausa, ausente o ha fichado la salida ahora mismo, con la entrada y el tiempo trabajado de hoy.',
    'Qui travaille, est en pause, absent ou parti en ce moment, avec l’arrivée et le temps de travail du jour.',
    'Wer gerade arbeitet, Pause macht, abwesend oder ausgecheckt ist, mit dem heutigen Check-in und der Arbeitszeit.',
    'من يعمل الآن أو في استراحة أو غير موجود أو انصرف، مع وقت الحضور ووقت العمل اليوم.',
  ],
  'for {time}': ['desde hace {time}', 'depuis {time}', 'seit {time}', 'منذ {time}'],
  'Checked out at {time}': ['Salida a las {time}', 'Parti à {time}', 'Ausgecheckt um {time}', 'انصرف في {time}'],
  'Not checked in today': ['Sin entrada hoy', 'Pas d’arrivée aujourd’hui', 'Heute nicht eingecheckt', 'لم يسجّل الحضور اليوم'],
  'Since {time}': ['Desde las {time}', 'Depuis {time}', 'Seit {time}', 'منذ {time}'],
  'Team status could not be loaded. Try again in a moment.': [
    'No se pudo cargar el estado del equipo. Inténtalo de nuevo en un momento.',
    'Le statut de l’équipe n’a pas pu être chargé. Réessayez dans un instant.',
    'Der Teamstatus konnte nicht geladen werden. Versuchen Sie es gleich noch einmal.',
    'تعذّر تحميل حالة الفريق. حاول مرة أخرى بعد قليل.',
  ],
  'Show people by status': ['Mostrar personas por estado', 'Afficher les personnes par statut', 'Personen nach Status anzeigen', 'اعرض الأشخاص حسب الحالة'],
  'Nobody is {status} right now.': ['Nadie está {status} ahora mismo.', 'Personne n’est {status} en ce moment.', 'Gerade ist niemand {status}.', 'لا أحد {status} الآن.'],
  'Nobody to show yet.': ['Todavía no hay nadie que mostrar.', 'Personne à afficher pour l’instant.', 'Noch niemand anzuzeigen.', 'لا يوجد أحد لعرضه بعد.'],
  'Worked {worked} · breaks {breaks}': ['Trabajado {worked} · pausas {breaks}', 'Travaillé {worked} · pauses {breaks}', 'Gearbeitet {worked} · Pausen {breaks}', 'العمل {worked} · الاستراحات {breaks}'],
} as const satisfies PhraseTable;
