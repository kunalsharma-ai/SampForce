import type { PhraseTable } from './types';

/** Notification Center (ADR 0075): the bell, the home card, section strips, the history page and alert settings. */
export const notifications = {
  // Section names a notification can come from (NOTIFICATION_SECTIONS); the rest are already page names.
  'Inbox and messages': ['Bandeja de entrada y mensajes', 'Boîte de réception et messages', 'Posteingang und Nachrichten', 'البريد الوارد والرسائل'],
  Automation: ['Automatización', 'Automatisation', 'Automatisierung', 'الأتمتة'],
  'Help and support': ['Ayuda y soporte', 'Aide et assistance', 'Hilfe und Support', 'المساعدة والدعم'],
  'Everything else': ['Todo lo demás', 'Tout le reste', 'Alles andere', 'كل ما عدا ذلك'],

  // The bell and its panel
  'Notification settings': ['Ajustes de notificaciones', 'Paramètres des notifications', 'Benachrichtigungseinstellungen', 'إعدادات الإشعارات'],
  'View all notifications': ['Ver todas las notificaciones', 'Voir toutes les notifications', 'Alle Benachrichtigungen anzeigen', 'عرض كل الإشعارات'],
  'No unread notifications.': ['No hay notificaciones sin leer.', 'Aucune notification non lue.', 'Keine ungelesenen Benachrichtigungen.', 'لا توجد إشعارات غير مقروءة.'],
  'Nothing needs your action right now.': ['Nada requiere tu acción ahora mismo.', 'Rien ne demande votre action pour le moment.', 'Gerade ist nichts von Ihnen zu tun.', 'لا شيء يتطلب إجراءً منك الآن.'],
  'Mark as read': ['Marcar como leída', 'Marquer comme lue', 'Als gelesen markieren', 'تعليم كمقروء'],
  'Mark as read: {title}': ['Marcar como leída: {title}', 'Marquer comme lue : {title}', 'Als gelesen markieren: {title}', 'تعليم كمقروء: {title}'],
  'Mark as unread': ['Marcar como no leída', 'Marquer comme non lue', 'Als ungelesen markieren', 'تعليم كغير مقروء'],
  'Mark as unread: {title}': ['Marcar como no leída: {title}', 'Marquer comme non lue : {title}', 'Als ungelesen markieren: {title}', 'تعليم كغير مقروء: {title}'],

  // The home dashboard card
  'View all': ['Ver todo', 'Tout voir', 'Alle anzeigen', 'عرض الكل'],
  'You’re all caught up.': ['Estás al día.', 'Vous êtes à jour.', 'Alles erledigt.', 'أنت مطّلع على كل شيء.'],
  '{n} unread · {a} need your action · {i} important': [
    '{n} sin leer · {a} requieren tu acción · {i} importantes',
    '{n} non lues · {a} demandent votre action · {i} importantes',
    '{n} ungelesen · {a} erfordern Ihr Handeln · {i} wichtig',
    '{n} غير مقروءة · {a} تتطلب إجراءً منك · {i} مهمة',
  ],
  'Unread by section': ['Sin leer por sección', 'Non lues par section', 'Ungelesen nach Bereich', 'غير المقروءة حسب القسم'],
  'New leads, tasks, approvals and reminders appear here as they happen.': [
    'Los nuevos leads, tareas, aprobaciones y recordatorios aparecen aquí en cuanto ocurren.',
    'Les nouveaux leads, tâches, approbations et rappels apparaissent ici dès qu’ils arrivent.',
    'Neue Leads, Aufgaben, Freigaben und Erinnerungen erscheinen hier, sobald sie eintreffen.',
    'تظهر هنا العملاء المحتملون الجدد والمهام والموافقات والتذكيرات فور حدوثها.',
  ],

  // In the section they come from
  'New in {section}': ['Novedades en {section}', 'Nouveautés dans {section}', 'Neu in {section}', 'الجديد في {section}'],
  'New in {section}: {n}': ['Novedades en {section}: {n}', 'Nouveautés dans {section} : {n}', 'Neu in {section}: {n}', 'الجديد في {section}: {n}'],
  'New about this record: {n}': ['Novedades sobre este registro: {n}', 'Nouveautés sur cette fiche : {n}', 'Neu zu diesem Datensatz: {n}', 'الجديد حول هذا السجل: {n}'],
  'Marked as read': ['Marcadas como leídas', 'Marquées comme lues', 'Als gelesen markiert', 'تم تعليمها كمقروءة'],
  'Got it': ['Entendido', 'Compris', 'Verstanden', 'حسنًا'],
  'Mark these read': ['Marcar estas como leídas', 'Marquer comme lues', 'Diese als gelesen markieren', 'تعليم هذه كمقروءة'],
  'See all {n} in {section}': ['Ver las {n} de {section}', 'Voir les {n} dans {section}', 'Alle {n} in {section} anzeigen', 'عرض كل الـ {n} في {section}'],

  // The history page
  'Everything SampForce has told you, newest first: assignments, approvals, reminders and updates from every section. Read and unread match the bell, the home dashboard and each section.': [
    'Todo lo que SampForce te ha comunicado, de lo más reciente a lo más antiguo: asignaciones, aprobaciones, recordatorios y novedades de cada sección. Leído y no leído coinciden con la campana, el panel de inicio y cada sección.',
    'Tout ce que SampForce vous a signalé, du plus récent au plus ancien : attributions, approbations, rappels et nouvelles de chaque section. Lu et non lu sont les mêmes dans la cloche, le tableau de bord d’accueil et chaque section.',
    'Alles, was SampForce Ihnen mitgeteilt hat, das Neueste zuerst: Zuweisungen, Freigaben, Erinnerungen und Neuigkeiten aus jedem Bereich. Gelesen und ungelesen stimmen mit der Glocke, dem Start-Dashboard und jedem Bereich überein.',
    'كل ما أبلغك به SampForce، الأحدث أولًا: الإسنادات والموافقات والتذكيرات والتحديثات من كل قسم. حالة المقروء وغير المقروء مطابقة للجرس ولوحة البداية ولكل قسم.',
  ],
  'All sections': ['Todas las secciones', 'Toutes les sections', 'Alle Bereiche', 'كل الأقسام'],
  'No notifications here yet.': ['Aún no hay notificaciones aquí.', 'Aucune notification ici pour l’instant.', 'Hier gibt es noch keine Benachrichtigungen.', 'لا توجد إشعارات هنا بعد.'],

  // Sound and alerts
  'Sound and alerts': ['Sonido y alertas', 'Son et alertes', 'Ton und Hinweise', 'الصوت والتنبيهات'],
  'Your own settings. They follow you to every workspace, browser and phone you sign in to.': [
    'Tus propios ajustes. Te acompañan en cada espacio de trabajo, navegador y teléfono donde inicies sesión.',
    'Vos propres réglages. Ils vous suivent dans chaque espace de travail, navigateur et téléphone où vous vous connectez.',
    'Ihre eigenen Einstellungen. Sie gelten in jedem Arbeitsbereich, Browser und Telefon, an dem Sie sich anmelden.',
    'إعداداتك الخاصة. ترافقك في كل مساحة عمل ومتصفح وهاتف تسجّل الدخول إليه.',
  ],
  'Play a sound when a notification arrives': ['Reproducir un sonido al llegar una notificación', 'Jouer un son à l’arrivée d’une notification', 'Ton abspielen, wenn eine Benachrichtigung eintrifft', 'تشغيل صوت عند وصول إشعار'],
  'A short, soft chime, once per notification. Urgent and action-required ones sound a little brighter. Never when you first open SampForce.': [
    'Un tono breve y suave, una vez por notificación. Las urgentes y las que requieren acción suenan algo más brillantes. Nunca al abrir SampForce.',
    'Un carillon court et doux, une fois par notification. Les urgentes et celles qui demandent une action sonnent un peu plus clair. Jamais à l’ouverture de SampForce.',
    'Ein kurzer, sanfter Klang, einmal pro Benachrichtigung. Dringende und solche, die Handeln erfordern, klingen etwas heller. Nie beim Öffnen von SampForce.',
    'نغمة قصيرة وهادئة، مرة واحدة لكل إشعار. الإشعارات العاجلة وتلك التي تتطلب إجراءً أعلى قليلًا. لا تُشغَّل أبدًا عند فتح SampForce.',
  ],
  Volume: ['Volumen', 'Volume', 'Lautstärke', 'مستوى الصوت'],
  'Play a test sound': ['Reproducir un sonido de prueba', 'Jouer un son d’essai', 'Testton abspielen', 'تشغيل صوت تجريبي'],
  'Play the sound for': ['Reproducir el sonido para', 'Jouer le son pour', 'Ton abspielen für', 'تشغيل الصوت لـ'],
  'Show browser notifications while SampForce is in the background': [
    'Mostrar notificaciones del navegador mientras SampForce está en segundo plano',
    'Afficher les notifications du navigateur quand SampForce est en arrière-plan',
    'Browser-Benachrichtigungen anzeigen, während SampForce im Hintergrund ist',
    'عرض إشعارات المتصفح أثناء عمل SampForce في الخلفية',
  ],
  'Your browser asks for permission the first time. Your computer’s own notification and Do Not Disturb settings still apply.': [
    'Tu navegador pedirá permiso la primera vez. Siguen aplicándose los ajustes de notificaciones y No molestar de tu equipo.',
    'Votre navigateur demande l’autorisation la première fois. Les réglages de notifications et Ne pas déranger de votre ordinateur s’appliquent toujours.',
    'Ihr Browser fragt beim ersten Mal nach der Erlaubnis. Die Benachrichtigungs- und Nicht-stören-Einstellungen Ihres Computers gelten weiterhin.',
    'يطلب متصفحك الإذن في المرة الأولى. تبقى إعدادات الإشعارات وعدم الإزعاج في حاسوبك سارية.',
  ],
  'Your browser blocks notifications from SampForce. Allow them in the browser’s site settings, then turn this on again.': [
    'Tu navegador bloquea las notificaciones de SampForce. Permítelas en los ajustes del sitio del navegador y vuelve a activar esta opción.',
    'Votre navigateur bloque les notifications de SampForce. Autorisez-les dans les paramètres du site, puis réactivez cette option.',
    'Ihr Browser blockiert Benachrichtigungen von SampForce. Erlauben Sie sie in den Website-Einstellungen des Browsers und schalten Sie dies dann erneut ein.',
    'يحظر متصفحك إشعارات SampForce. اسمح بها في إعدادات الموقع في المتصفح، ثم فعّل هذا الخيار مجددًا.',
  ],
  'Could not save. Please try again.': ['No se pudo guardar. Inténtalo de nuevo.', 'Enregistrement impossible. Veuillez réessayer.', 'Speichern fehlgeschlagen. Bitte erneut versuchen.', 'تعذّر الحفظ. يُرجى المحاولة مرة أخرى.'],
  // Sign-in scenes and the welcome after signing in
  'Welcome back, {name}': ['Bienvenido de nuevo, {name}', 'Bon retour, {name}', 'Willkommen zurück, {name}', 'مرحبًا بعودتك، {name}'],
  'You’re signing in to': ['Estás iniciando sesión en', 'Vous vous connectez à', 'Sie melden sich an bei', 'أنت تسجّل الدخول إلى'],
  'For owners and admins': ['Para propietarios y administradores', 'Pour les propriétaires et administrateurs', 'Für Inhaber und Administratoren', 'للمالكين والمسؤولين'],
  'For team leads': ['Para líderes de equipo', 'Pour les responsables d’équipe', 'Für Teamleitungen', 'لقادة الفرق'],
  'For sales executives': ['Para ejecutivos de ventas', 'Pour les commerciaux', 'Für Vertriebsmitarbeitende', 'لمندوبي المبيعات'],
  'Good morning': ['Buenos días', 'Bonjour', 'Guten Morgen', 'صباح الخير'],
  'Good afternoon': ['Buenas tardes', 'Bon après-midi', 'Guten Tag', 'مساء الخير'],
  'Good evening': ['Buenas noches', 'Bonsoir', 'Guten Abend', 'مساء الخير'],
  'Welcome to {name}': ['Bienvenido a {name}', 'Bienvenue dans {name}', 'Willkommen in {name}', 'مرحبًا بك في {name}'],
  'Secure, encrypted sign-in': ['Inicio de sesión seguro y cifrado', 'Connexion sécurisée et chiffrée', 'Sichere, verschlüsselte Anmeldung', 'تسجيل دخول آمن ومشفّر'],
  'Switch to light mode': ['Cambiar a modo claro', 'Passer en mode clair', 'Zum hellen Modus wechseln', 'التبديل إلى الوضع الفاتح'],
  'Switch to dark mode': ['Cambiar a modo oscuro', 'Passer en mode sombre', 'Zum dunklen Modus wechseln', 'التبديل إلى الوضع الداكن'],
  'Colour palette': ['Paleta de colores', 'Palette de couleurs', 'Farbpalette', 'لوحة الألوان'],
  'SampForce red': ['Rojo SampForce', 'Rouge SampForce', 'SampForce-Rot', 'أحمر SampForce'],
  'Royal rose': ['Rosa real', 'Rose royal', 'Königsrosa', 'وردي ملكي'],
  'Ocean blue': ['Azul océano', 'Bleu océan', 'Ozeanblau', 'أزرق المحيط'],
  'Emerald': ['Esmeralda', 'Émeraude', 'Smaragd', 'زمردي'],
  'Sunset amber': ['Ámbar atardecer', 'Ambre couchant', 'Abendbernstein', 'كهرماني الغروب'],
  'Show password': ['Mostrar contraseña', 'Afficher le mot de passe', 'Passwort anzeigen', 'إظهار كلمة المرور'],
  'Hide password': ['Ocultar contraseña', 'Masquer le mot de passe', 'Passwort verbergen', 'إخفاء كلمة المرور'],
  'Signed in': ['Sesión iniciada', 'Connecté', 'Angemeldet', 'تم تسجيل الدخول'],
  'Opening your workspace…': ['Abriendo tu espacio de trabajo…', 'Ouverture de votre espace…', 'Ihr Arbeitsbereich wird geöffnet…', 'جارٍ فتح مساحة العمل…'],
  'Getting your dashboard ready…': ['Preparando tu panel…', 'Préparation de votre tableau de bord…', 'Ihr Dashboard wird vorbereitet…', 'جارٍ تجهيز لوحة المعلومات…'],
  'Welcome to SampForce': ['Bienvenido a SampForce', 'Bienvenue sur SampForce', 'Willkommen bei SampForce', 'مرحبًا بك في SampForce'],
  'Your whole company, in one place': ['Toda tu empresa, en un solo lugar', 'Toute votre entreprise, au même endroit', 'Ihr ganzes Unternehmen an einem Ort', 'شركتك كلها في مكان واحد'],
  'Workspaces, teams, targets and every client relationship, from the top.': [
    'Espacios de trabajo, equipos, objetivos y cada relación con clientes, desde arriba.',
    'Espaces de travail, équipes, objectifs et chaque relation client, vus d’en haut.',
    'Arbeitsbereiche, Teams, Ziele und jede Kundenbeziehung, von oben.',
    'مساحات العمل والفرق والأهداف وكل علاقة مع العملاء، من القمة.',
  ],
  'Lead your team to the next win': ['Lleva a tu equipo a la próxima victoria', 'Menez votre équipe vers la prochaine victoire', 'Führen Sie Ihr Team zum nächsten Erfolg', 'قُد فريقك إلى الفوز التالي'],
  'Assign work, track targets and coach your executives as it happens.': [
    'Asigna trabajo, sigue los objetivos y guía a tus ejecutivos en el momento.',
    'Attribuez le travail, suivez les objectifs et accompagnez vos commerciaux en direct.',
    'Arbeit zuweisen, Ziele verfolgen und Ihre Mitarbeitenden direkt begleiten.',
    'وزّع العمل وتابع الأهداف ووجّه مندوبيك لحظة بلحظة.',
  ],
  'Ready to close? Let’s sell.': ['¿Listo para cerrar? A vender.', 'Prêt à conclure ? Vendons.', 'Bereit zum Abschluss? Los geht’s.', 'مستعد لإتمام الصفقة؟ لنبدأ البيع.'],
  'Your leads, follow-ups and deals, ready the moment you sign in.': [
    'Tus leads, seguimientos y oportunidades, listos en cuanto inicias sesión.',
    'Vos leads, relances et affaires, prêts dès la connexion.',
    'Ihre Leads, Nachfassaktionen und Deals, bereit, sobald Sie sich anmelden.',
    'عملاؤك المحتملون ومتابعاتك وصفقاتك جاهزة لحظة تسجيل الدخول.',
  ],
} as const satisfies PhraseTable;
