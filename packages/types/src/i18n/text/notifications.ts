import type { TextTable } from '../catalogue';

/**
 * Notification titles and bodies. They are stored in English when the event happens (often in a worker, with nobody's
 * language at hand) and translated when the person opens their notifications (ADR 0052).
 */
export const notifications = {
  // Card payments, quotes and proposals
  'Proposal {ref} was paid': ['La propuesta {ref} se ha pagado', 'La proposition {ref} a été payée', 'Angebot {ref} wurde bezahlt', 'تم دفع العرض {ref}'],
  '{currency} {amount} by card from {payer}, confirmed by {provider}.': [
    '{currency} {amount} con tarjeta de {payer}, confirmado por {provider}.',
    '{currency} {amount} par carte de {payer}, confirmé par {provider}.',
    '{currency} {amount} per Karte von {payer}, bestätigt von {provider}.',
    '{currency} {amount} بالبطاقة من {payer}، أكّدها {provider}.',
  ],
  '{currency} {amount} by card, confirmed by {provider}.': [
    '{currency} {amount} con tarjeta, confirmado por {provider}.',
    '{currency} {amount} par carte, confirmé par {provider}.',
    '{currency} {amount} per Karte, bestätigt von {provider}.',
    '{currency} {amount} بالبطاقة، أكّدها {provider}.',
  ],
  'Proposal {ref} was opened': ['Se abrió la propuesta {ref}', 'La proposition {ref} a été ouverte', 'Angebot {ref} wurde geöffnet', 'فُتح العرض {ref}'],
  '{deal}: the online proposal link was opened. Email security scanners can also open links, so treat this as a likely view.': [
    '{deal}: se abrió el enlace de la propuesta en línea. Los escáneres de seguridad del correo también abren enlaces, así que tómalo como una visita probable.',
    '{deal} : le lien de la proposition en ligne a été ouvert. Les scanners de sécurité des e-mails ouvrent aussi les liens ; considérez-le comme une consultation probable.',
    '{deal}: Der Link zum Online-Angebot wurde geöffnet. Auch E-Mail-Sicherheitsscanner öffnen Links, werten Sie es also als wahrscheinliche Ansicht.',
    '{deal}: فُتح رابط العرض عبر الإنترنت. قد تفتح أدوات فحص أمان البريد الروابط أيضًا، فاعتبرها مشاهدة محتملة.',
  ],
  'Discount approval needed: {ref}': ['Se necesita aprobar un descuento: {ref}', 'Approbation de remise requise : {ref}', 'Rabattfreigabe erforderlich: {ref}', 'مطلوب اعتماد خصم: {ref}'],
  '{percent}% discount on {deal}.': ['{percent} % de descuento en {deal}.', 'Remise de {percent} % sur {deal}.', '{percent} % Rabatt auf {deal}.', 'خصم {percent}% على {deal}.'],

  // Texts and WhatsApp
  '{name} opted out of text messages': ['{name} se dio de baja de los SMS', '{name} s’est désinscrit des SMS', '{name} hat SMS abbestellt', 'ألغى {name} الاشتراك في الرسائل النصية'],
  '{name} opted back in to texts': ['{name} volvió a aceptar los SMS', '{name} accepte à nouveau les SMS', '{name} hat SMS wieder zugestimmt', 'عاد {name} للاشتراك في الرسائل النصية'],
  'Text from {name}': ['SMS de {name}', 'SMS de {name}', 'SMS von {name}', 'رسالة نصية من {name}'],
  'They replied STOP, so their SMS consent was withdrawn and Twilio will block texts to them until they reply START.': [
    'Respondió STOP, así que se retiró su consentimiento para SMS y Twilio bloqueará los mensajes hasta que responda START.',
    'La personne a répondu STOP : son consentement SMS est retiré et Twilio bloquera les SMS jusqu’à ce qu’elle réponde START.',
    'Die Person hat mit STOP geantwortet. Ihre SMS-Einwilligung wurde widerrufen, und Twilio blockiert SMS, bis sie mit START antwortet.',
    'ردّ بكلمة STOP، فسُحبت موافقته على الرسائل النصية وسيحظر Twilio الرسائل إليه حتى يرد بكلمة START.',
  ],
  'They replied START. Record their consent again before texting them.': [
    'Respondió START. Vuelve a registrar su consentimiento antes de enviarle SMS.',
    'La personne a répondu START. Enregistrez à nouveau son consentement avant de lui envoyer des SMS.',
    'Die Person hat mit START geantwortet. Erfassen Sie die Einwilligung erneut, bevor Sie SMS senden.',
    'ردّ بكلمة START. سجّل موافقته مجددًا قبل مراسلته نصيًا.',
  ],
  'Text to {phone} was not delivered': ['No se entregó el SMS a {phone}', 'Le SMS à {phone} n’a pas été remis', 'SMS an {phone} wurde nicht zugestellt', 'لم تُسلَّم الرسالة النصية إلى {phone}'],
  '{name} opted out of WhatsApp messages': ['{name} se dio de baja de los mensajes de WhatsApp', '{name} s’est désinscrit des messages WhatsApp', '{name} hat WhatsApp-Nachrichten abbestellt', 'ألغى {name} الاشتراك في رسائل WhatsApp'],
  'WhatsApp message from {name}': ['Mensaje de WhatsApp de {name}', 'Message WhatsApp de {name}', 'WhatsApp-Nachricht von {name}', 'رسالة WhatsApp من {name}'],
  'They replied STOP, so their WhatsApp consent was withdrawn. Templates can no longer be sent to them.': [
    'Respondió STOP, así que se retiró su consentimiento para WhatsApp. Ya no se le pueden enviar plantillas.',
    'La personne a répondu STOP : son consentement WhatsApp est retiré. Les modèles ne peuvent plus lui être envoyés.',
    'Die Person hat mit STOP geantwortet. Ihre WhatsApp-Einwilligung wurde widerrufen; Vorlagen können ihr nicht mehr gesendet werden.',
    'ردّ بكلمة STOP، فسُحبت موافقته على WhatsApp. لم يعد بالإمكان إرسال القوالب إليه.',
  ],
  'WhatsApp message to +{phone} failed': ['Falló el mensaje de WhatsApp a +{phone}', 'Échec du message WhatsApp à +{phone}', 'WhatsApp-Nachricht an +{phone} fehlgeschlagen', 'فشلت رسالة WhatsApp إلى +{phone}'],
  'WhatsApp did not deliver it.': ['WhatsApp no lo entregó.', 'WhatsApp ne l’a pas remis.', 'WhatsApp hat sie nicht zugestellt.', 'لم يسلّمها WhatsApp.'],

  // Assignments, tasks and workflows
  '{name} was assigned to you': ['Se te asignó {name}', '{name} vous a été attribué', '{name} wurde Ihnen zugewiesen', 'أُسند إليك {name}'],
  'New task for you: {title}': ['Nueva tarea para ti: {title}', 'Nouvelle tâche pour vous : {title}', 'Neue Aufgabe für Sie: {title}', 'مهمة جديدة لك: {title}'],
  'Deal won: {deal}': ['Oportunidad ganada: {deal}', 'Opportunité gagnée : {deal}', 'Verkaufschance gewonnen: {deal}', 'صفقة مربوحة: {deal}'],
  'Workflow "{name}" failed': ['Falló el flujo de trabajo «{name}»', 'Le workflow « {name} » a échoué', 'Workflow „{name}“ ist fehlgeschlagen', 'فشل سير العمل «{name}»'],
  'Approval needed: {title}': ['Se necesita aprobación: {title}', 'Approbation requise : {title}', 'Freigabe erforderlich: {title}', 'مطلوب اعتماد: {title}'],
  'A conversation was assigned to you': ['Se te asignó una conversación', 'Une conversation vous a été attribuée', 'Ihnen wurde eine Unterhaltung zugewiesen', 'أُسندت إليك محادثة'],
  '{name} added a note': ['{name} añadió una nota', '{name} a ajouté une note', '{name} hat eine Notiz hinzugefügt', 'أضاف {name} ملاحظة'],
  'A teammate': ['Un compañero', 'Un collègue', 'Ein Teammitglied', 'زميل'],
  'Prospect list assigned to you: {name}': ['Lista de prospectos asignada a ti: {name}', 'Liste de prospects qui vous est attribuée : {name}', 'Ihnen zugewiesene Interessentenliste: {name}', 'قائمة عملاء محتملين مسندة إليك: {name}'],
  'Open the list to work through its prospects.': [
    'Abre la lista para trabajar sus prospectos.',
    'Ouvrez la liste pour traiter ses prospects.',
    'Öffnen Sie die Liste, um die Interessenten abzuarbeiten.',
    'افتح القائمة للعمل على عملائها المحتملين.',
  ],

  // Billing
  'Payment received for invoice {number}': ['Pago recibido de la factura {number}', 'Paiement reçu pour la facture {number}', 'Zahlung für Rechnung {number} eingegangen', 'تم استلام دفعة الفاتورة {number}'],
  '{plan} is active until {date}.': ['{plan} está activo hasta el {date}.', '{plan} est actif jusqu’au {date}.', '{plan} ist bis {date} aktiv.', '{plan} نشطة حتى {date}.'],
  'A payment for DealFlow failed': ['Falló un pago de DealFlow', 'Un paiement DealFlow a échoué', 'Eine Zahlung für DealFlow ist fehlgeschlagen', 'فشلت دفعة لـ DealFlow'],
  'Paid features stay on for {n} days while you update the payment method.': [
    'Las funciones de pago siguen activas {n} días mientras actualizas el método de pago.',
    'Les fonctions payantes restent actives {n} jours le temps de mettre à jour le moyen de paiement.',
    'Kostenpflichtige Funktionen bleiben {n} Tage aktiv, während Sie die Zahlungsmethode aktualisieren.',
    'تبقى الميزات المدفوعة مفعّلة {n} أيام ريثما تحدّث طريقة الدفع.',
  ],
  'Your paid DealFlow plan has ended': ['Tu plan de pago de DealFlow ha terminado', 'Votre forfait payant DealFlow a pris fin', 'Ihr kostenpflichtiger DealFlow-Tarif ist beendet', 'انتهت خطتك المدفوعة في DealFlow'],
  'The workspace is on the Free plan now. All data is kept.': [
    'El espacio de trabajo está ahora en el plan Free. Se conservan todos los datos.',
    'L’espace de travail est désormais sur le forfait Free. Toutes les données sont conservées.',
    'Der Arbeitsbereich ist jetzt im Free-Tarif. Alle Daten bleiben erhalten.',
    'مساحة العمل الآن على الخطة المجانية. جميع البيانات محفوظة.',
  ],
  'Your DealFlow trial has ended': ['Tu prueba de DealFlow ha terminado', 'Votre essai DealFlow est terminé', 'Ihre DealFlow-Testphase ist beendet', 'انتهت الفترة التجريبية لـ DealFlow'],
  'The workspace is back on the Free plan. All data is kept; choose a plan to continue with paid features.': [
    'El espacio de trabajo vuelve al plan Free. Se conservan todos los datos; elige un plan para seguir con las funciones de pago.',
    'L’espace de travail repasse sur le forfait Free. Toutes les données sont conservées ; choisissez un forfait pour continuer avec les fonctions payantes.',
    'Der Arbeitsbereich ist wieder im Free-Tarif. Alle Daten bleiben erhalten; wählen Sie einen Tarif, um kostenpflichtige Funktionen weiter zu nutzen.',
    'عادت مساحة العمل إلى الخطة المجانية. جميع البيانات محفوظة؛ اختر خطة لمواصلة استخدام الميزات المدفوعة.',
  ],
  'Your DealFlow plan is due for renewal': ['Tu plan de DealFlow debe renovarse', 'Votre forfait DealFlow doit être renouvelé', 'Ihr DealFlow-Tarif steht zur Verlängerung an', 'حان موعد تجديد خطتك في DealFlow'],
  'The paid period has ended. Paid features stay on for {n} days from its end; request and pay the renewal invoice under Billing before then.': [
    'El periodo de pago ha terminado. Las funciones de pago siguen activas {n} días desde su fin; solicita y paga la factura de renovación en Facturación antes.',
    'La période payée est terminée. Les fonctions payantes restent actives {n} jours après sa fin ; demandez et réglez la facture de renouvellement dans Facturation d’ici là.',
    'Der bezahlte Zeitraum ist beendet. Kostenpflichtige Funktionen bleiben ab dem Ende {n} Tage aktiv; fordern Sie die Verlängerungsrechnung unter Abrechnung an und bezahlen Sie sie bis dahin.',
    'انتهت الفترة المدفوعة. تبقى الميزات المدفوعة مفعّلة {n} أيام من نهايتها؛ اطلب فاتورة التجديد وادفعها من قسم الفوترة قبل ذلك.',
  ],
  '{plan} is paid until {date}': ['{plan} está pagado hasta el {date}', '{plan} est payé jusqu’au {date}', '{plan} ist bis {date} bezahlt', '{plan} مدفوعة حتى {date}'],
  'Request the renewal invoice under Billing and pay it before then to keep paid features without a break.': [
    'Solicita la factura de renovación en Facturación y págala antes para mantener las funciones de pago sin interrupción.',
    'Demandez la facture de renouvellement dans Facturation et réglez-la d’ici là pour garder les fonctions payantes sans interruption.',
    'Fordern Sie die Verlängerungsrechnung unter Abrechnung an und bezahlen Sie sie vorher, damit kostenpflichtige Funktionen ohne Unterbrechung weiterlaufen.',
    'اطلب فاتورة التجديد من قسم الفوترة وادفعها قبل ذلك لتبقى الميزات المدفوعة دون انقطاع.',
  ],
  'Paid features are paused': ['Las funciones de pago están en pausa', 'Les fonctions payantes sont suspendues', 'Kostenpflichtige Funktionen sind pausiert', 'الميزات المدفوعة متوقفة مؤقتًا'],
  'The grace period for the failed payment has ended, so Free plan limits apply until it is paid. No data has been removed.': [
    'El periodo de gracia del pago fallido ha terminado, así que se aplican los límites del plan Free hasta que se pague. No se ha eliminado ningún dato.',
    'Le délai de grâce du paiement échoué est terminé : les limites du forfait Free s’appliquent jusqu’au règlement. Aucune donnée n’a été supprimée.',
    'Die Kulanzfrist für die fehlgeschlagene Zahlung ist abgelaufen, daher gelten bis zur Zahlung die Limits des Free-Tarifs. Es wurden keine Daten entfernt.',
    'انتهت فترة السماح للدفعة الفاشلة، لذا تُطبَّق حدود الخطة المجانية حتى تُدفع. لم تُحذف أي بيانات.',
  ],

  // Contracts
  '{ref} has expired': ['{ref} ha vencido', '{ref} a expiré', '{ref} ist abgelaufen', 'انتهت صلاحية {ref}'],
  '{name} ended on {date}.': ['{name} terminó el {date}.', '{name} s’est terminé le {date}.', '{name} endete am {date}.', 'انتهى {name} في {date}.'],
  'Renewal due: {ref}': ['Renovación pendiente: {ref}', 'Renouvellement à prévoir : {ref}', 'Verlängerung fällig: {ref}', 'التجديد مستحق: {ref}'],
  '{name} ends in {n} day ({date}). It is marked to auto-renew; start the renewal to record the next term.': [
    '{name} termina en {n} día ({date}). Está marcado para renovarse automáticamente; inicia la renovación para registrar el siguiente periodo.',
    '{name} se termine dans {n} jour ({date}). Il est en renouvellement automatique ; lancez le renouvellement pour enregistrer la période suivante.',
    '{name} endet in {n} Tag ({date}). Er verlängert sich automatisch; starten Sie die Verlängerung, um die nächste Laufzeit zu erfassen.',
    'ينتهي {name} خلال {n} يوم ({date}). وهو مُعلَّم للتجديد التلقائي؛ ابدأ التجديد لتسجيل المدة التالية.',
  ],
  '{name} ends in {n} days ({date}). It is marked to auto-renew; start the renewal to record the next term.': [
    '{name} termina en {n} días ({date}). Está marcado para renovarse automáticamente; inicia la renovación para registrar el siguiente periodo.',
    '{name} se termine dans {n} jours ({date}). Il est en renouvellement automatique ; lancez le renouvellement pour enregistrer la période suivante.',
    '{name} endet in {n} Tagen ({date}). Er verlängert sich automatisch; starten Sie die Verlängerung, um die nächste Laufzeit zu erfassen.',
    'ينتهي {name} خلال {n} أيام ({date}). وهو مُعلَّم للتجديد التلقائي؛ ابدأ التجديد لتسجيل المدة التالية.',
  ],
  '{name} ends in {n} day ({date}).': ['{name} termina en {n} día ({date}).', '{name} se termine dans {n} jour ({date}).', '{name} endet in {n} Tag ({date}).', 'ينتهي {name} خلال {n} يوم ({date}).'],
  '{name} ends in {n} days ({date}).': ['{name} termina en {n} días ({date}).', '{name} se termine dans {n} jours ({date}).', '{name} endet in {n} Tagen ({date}).', 'ينتهي {name} خلال {n} أيام ({date}).'],

  // Gamification
  'You earned the "{badge}" badge': ['Has conseguido la insignia «{badge}»', 'Vous avez obtenu le badge « {badge} »', 'Sie haben das Abzeichen „{badge}“ erhalten', 'حصلت على شارة «{badge}»'],
  'New team challenge: {name}': ['Nuevo reto de equipo: {name}', 'Nouveau défi d’équipe : {name}', 'Neue Team-Challenge: {name}', 'تحدٍّ جماعي جديد: {name}'],
  'New competition: {name}': ['Nueva competición: {name}', 'Nouvelle compétition : {name}', 'Neuer Wettbewerb: {name}', 'منافسة جديدة: {name}'],
  '{start} to {end}. Reward: {reward}': ['Del {start} al {end}. Premio: {reward}', 'Du {start} au {end}. Récompense : {reward}', '{start} bis {end}. Belohnung: {reward}', 'من {start} إلى {end}. المكافأة: {reward}'],
  '{start} to {end}': ['Del {start} al {end}', 'Du {start} au {end}', '{start} bis {end}', 'من {start} إلى {end}'],

  // Mailboxes and webhooks
  'Mailbox sync stopped for {email}': ['Se detuvo la sincronización del buzón {email}', 'La synchronisation de la boîte {email} s’est arrêtée', 'Postfach-Synchronisierung für {email} angehalten', 'توقفت مزامنة صندوق البريد {email}'],
  'Reconnect the account to resume syncing.': ['Vuelve a conectar la cuenta para reanudar la sincronización.', 'Reconnectez le compte pour reprendre la synchronisation.', 'Verbinden Sie das Konto neu, um die Synchronisierung fortzusetzen.', 'أعد ربط الحساب لاستئناف المزامنة.'],
  'Syncing failed repeatedly. Check the integration settings.': [
    'La sincronización falló varias veces. Revisa la configuración de la integración.',
    'La synchronisation a échoué à plusieurs reprises. Vérifiez les paramètres de l’intégration.',
    'Die Synchronisierung ist wiederholt fehlgeschlagen. Prüfen Sie die Einstellungen der Integration.',
    'فشلت المزامنة مرارًا. تحقق من إعدادات التكامل.',
  ],
  'A webhook was switched off': ['Se desactivó un webhook', 'Un webhook a été désactivé', 'Ein Webhook wurde ausgeschaltet', 'أُوقف خطاف ويب'],
  '{url} failed {n} times in a row.': ['{url} falló {n} veces seguidas.', '{url} a échoué {n} fois d’affilée.', '{url} ist {n}-mal hintereinander fehlgeschlagen.', 'فشل {url} {n} مرات متتالية.'],

  // Deal and customer health, visitors
  '{deal} is at high risk': ['{deal} está en riesgo alto', '{deal} présente un risque élevé', '{deal} hat ein hohes Risiko', '{deal} في خطر مرتفع'],
  'Health {score}/100: {signals}.': ['Salud {score}/100: {signals}.', 'Santé {score}/100 : {signals}.', 'Zustand {score}/100: {signals}.', 'الصحة {score}/100: {signals}.'],
  '{company} is at risk': ['{company} está en riesgo', '{company} est à risque', '{company} ist gefährdet', '{company} معرّض للخطر'],
  'low escalation: {company}': ['escalado bajo: {company}', 'escalade faible : {company}', 'niedrige Eskalation: {company}', 'تصعيد منخفض: {company}'],
  'medium escalation: {company}': ['escalado medio: {company}', 'escalade moyenne : {company}', 'mittlere Eskalation: {company}', 'تصعيد متوسط: {company}'],
  'high escalation: {company}': ['escalado alto: {company}', 'escalade élevée : {company}', 'hohe Eskalation: {company}', 'تصعيد مرتفع: {company}'],
  'critical escalation: {company}': ['escalado crítico: {company}', 'escalade critique : {company}', 'kritische Eskalation: {company}', 'تصعيد حرج: {company}'],
  '{name} is showing high intent on your website': ['{name} muestra una intención alta en tu sitio web', '{name} montre une forte intention sur votre site', '{name} zeigt hohes Kaufinteresse auf Ihrer Website', 'يُظهر {name} نية شراء عالية على موقعك'],
  'Intent score {score}/100.': ['Puntuación de intención {score}/100.', 'Score d’intention {score}/100.', 'Interessenwert {score}/100.', 'درجة النية {score}/100.'],

  // Client portal
  'Portal request {ref} assigned to you': ['Solicitud del portal {ref} asignada a ti', 'Demande du portail {ref} qui vous est attribuée', 'Portalanfrage {ref} wurde Ihnen zugewiesen', 'طلب البوابة {ref} مسند إليك'],
  '{name} approved {ref}': ['{name} aprobó {ref}', '{name} a approuvé {ref}', '{name} hat {ref} angenommen', 'وافق {name} على {ref}'],
  '{name} declined {ref}': ['{name} rechazó {ref}', '{name} a décliné {ref}', '{name} hat {ref} abgelehnt', 'رفض {name} {ref}'],
  '{deal}, in the client portal. Note: {note}': ['{deal}, en el portal de clientes. Nota: {note}', '{deal}, dans le portail client. Note : {note}', '{deal}, im Kundenportal. Notiz: {note}', '{deal}، في بوابة العملاء. ملاحظة: {note}'],
  '{deal}, in the client portal.': ['{deal}, en el portal de clientes.', '{deal}, dans le portail client.', '{deal}, im Kundenportal.', '{deal}، في بوابة العملاء.'],
  'New portal request {ref} from {company}': ['Nueva solicitud del portal {ref} de {company}', 'Nouvelle demande du portail {ref} de {company}', 'Neue Portalanfrage {ref} von {company}', 'طلب بوابة جديد {ref} من {company}'],
  '{name} replied on {ref}': ['{name} respondió en {ref}', '{name} a répondu sur {ref}', '{name} hat auf {ref} geantwortet', 'ردّ {name} على {ref}'],
  'Message from {name} ({company})': ['Mensaje de {name} ({company})', 'Message de {name} ({company})', 'Nachricht von {name} ({company})', 'رسالة من {name} ({company})'],
  '{name} uploaded {file}': ['{name} subió {file}', '{name} a téléversé {file}', '{name} hat {file} hochgeladen', 'رفع {name} {file}'],

  // Sequences
  'Paused: {email} in {sequence}': ['En pausa: {email} en {sequence}', 'En pause : {email} dans {sequence}', 'Pausiert: {email} in {sequence}', 'متوقف مؤقتًا: {email} في {sequence}'],
  'In the sequence "{sequence}".': ['En la secuencia «{sequence}».', 'Dans la séquence « {sequence} ».', 'In der Sequenz „{sequence}“.', 'في التسلسل «{sequence}».'],
  '{email} replied': ['{email} respondió', '{email} a répondu', '{email} hat geantwortet', 'ردّ {email}'],
  '{email} opened an email': ['{email} abrió un correo', '{email} a ouvert un e-mail', '{email} hat eine E-Mail geöffnet', 'فتح {email} رسالة'],
  '{email} clicked a link': ['{email} hizo clic en un enlace', '{email} a cliqué sur un lien', '{email} hat auf einen Link geklickt', 'نقر {email} رابطًا'],
  '{email} bounced': ['{email} rebotó', '{email} a été rejeté', '{email} ist unzustellbar', 'ارتدّ {email}'],
  '{email} unsubscribed': ['{email} se dio de baja', '{email} s’est désabonné', '{email} hat sich abgemeldet', 'ألغى {email} الاشتراك'],
} satisfies TextTable;
