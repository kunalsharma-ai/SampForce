import type { TextTable } from '../catalogue';

/** The mobile app (ADR 0072): Console approval, Super Workspace activation and phone sign-in. */
export const mobile = {
  // Feature
  'Mobile app': ['Aplicación móvil', 'Application mobile', 'Mobile App', 'تطبيق الجوال'],
  'The SampForce app for iPhone and Android, once the Console Admin approves it and the Super Workspace switches it on.': [
    'La aplicación de SampForce para iPhone y Android, una vez que el administrador de la consola la aprueba y el espacio de trabajo superior la activa.',
    'L’application SampForce pour iPhone et Android, dès que l’administrateur de la console l’approuve et que l’espace de travail principal l’active.',
    'Die SampForce-App für iPhone und Android, sobald der Konsolen-Admin sie genehmigt und der Super-Arbeitsbereich sie einschaltet.',
    'تطبيق SampForce لأجهزة iPhone وAndroid، بعد موافقة مسؤول وحدة التحكم وتفعيله من مساحة العمل الرئيسية.',
  ],

  // Phone refusals
  'The mobile app cannot do this. Use SampForce in your browser.': [
    'La aplicación móvil no puede hacer esto. Usa SampForce en tu navegador.',
    'L’application mobile ne peut pas faire cela. Utilisez SampForce dans votre navigateur.',
    'Die Mobile App kann das nicht. Nutzen Sie SampForce im Browser.',
    'لا يمكن لتطبيق الجوال القيام بذلك. استخدم SampForce في متصفحك.',
  ],
  'The mobile app is not included in your organisation’s plan.': [
    'La aplicación móvil no está incluida en el plan de tu organización.',
    'L’application mobile n’est pas incluse dans l’offre de votre organisation.',
    'Die Mobile App ist im Tarif Ihrer Organisation nicht enthalten.',
    'تطبيق الجوال غير مشمول في خطة مؤسستك.',
  ],
  'Mobile access has not been approved for your organisation yet.': [
    'El acceso móvil aún no se ha aprobado para tu organización.',
    'L’accès mobile n’a pas encore été approuvé pour votre organisation.',
    'Der mobile Zugang wurde für Ihre Organisation noch nicht genehmigt.',
    'لم تتم الموافقة على الوصول عبر الجوال لمؤسستك بعد.',
  ],
  'Mobile access for your organisation is suspended. You can keep using SampForce in your browser.': [
    'El acceso móvil de tu organización está suspendido. Puedes seguir usando SampForce en tu navegador.',
    'L’accès mobile de votre organisation est suspendu. Vous pouvez continuer à utiliser SampForce dans votre navigateur.',
    'Der mobile Zugang Ihrer Organisation ist ausgesetzt. Sie können SampForce weiter im Browser nutzen.',
    'الوصول عبر الجوال لمؤسستك معلّق. يمكنك مواصلة استخدام SampForce في متصفحك.',
  ],
  'Mobile access for your organisation has been withdrawn. You can keep using SampForce in your browser.': [
    'Se ha retirado el acceso móvil de tu organización. Puedes seguir usando SampForce en tu navegador.',
    'L’accès mobile de votre organisation a été retiré. Vous pouvez continuer à utiliser SampForce dans votre navigateur.',
    'Der mobile Zugang Ihrer Organisation wurde entzogen. Sie können SampForce weiter im Browser nutzen.',
    'تم سحب الوصول عبر الجوال من مؤسستك. يمكنك مواصلة استخدام SampForce في متصفحك.',
  ],
  'Your organisation has not switched on the mobile app yet. Ask your administrator.': [
    'Tu organización aún no ha activado la aplicación móvil. Pregunta a tu administrador.',
    'Votre organisation n’a pas encore activé l’application mobile. Demandez à votre administrateur.',
    'Ihre Organisation hat die Mobile App noch nicht eingeschaltet. Fragen Sie Ihren Administrator.',
    'لم تفعّل مؤسستك تطبيق الجوال بعد. اسأل المسؤول.',
  ],
  'This workspace is suspended.': ['Este espacio de trabajo está suspendido.', 'Cet espace de travail est suspendu.', 'Dieser Arbeitsbereich ist gesperrt.', 'مساحة العمل هذه معلّقة.'],
  'Your workspace requires single sign-on, which the mobile app does not support yet. Use SampForce in your browser.': [
    'Tu espacio de trabajo exige inicio de sesión único, que la aplicación móvil aún no admite. Usa SampForce en tu navegador.',
    'Votre espace de travail exige l’authentification unique, que l’application mobile ne prend pas encore en charge. Utilisez SampForce dans votre navigateur.',
    'Ihr Arbeitsbereich verlangt Single Sign-On, das die Mobile App noch nicht unterstützt. Nutzen Sie SampForce im Browser.',
    'تتطلب مساحة عملك تسجيل الدخول الموحد، وهو ما لا يدعمه تطبيق الجوال بعد. استخدم SampForce في متصفحك.',
  ],
  'This workspace requires two-step verification. Turn it on in SampForce in your browser, then sign in here again.': [
    'Este espacio de trabajo exige verificación en dos pasos. Actívala en SampForce en tu navegador y vuelve a iniciar sesión aquí.',
    'Cet espace de travail exige la validation en deux étapes. Activez-la dans SampForce dans votre navigateur, puis reconnectez-vous ici.',
    'Dieser Arbeitsbereich verlangt die Zwei-Schritt-Verifizierung. Schalten Sie sie in SampForce im Browser ein und melden Sie sich dann hier erneut an.',
    'تتطلب مساحة العمل هذه التحقق بخطوتين. فعّله في SampForce من متصفحك، ثم سجّل الدخول هنا مرة أخرى.',
  ],
  'Your organisation has reached the number of phones it may sign in. Ask your administrator to sign out a phone that is no longer used.': [
    'Tu organización ha alcanzado el número de teléfonos que puede conectar. Pide a tu administrador que cierre la sesión de un teléfono que ya no se use.',
    'Votre organisation a atteint le nombre de téléphones qu’elle peut connecter. Demandez à votre administrateur de déconnecter un téléphone qui n’est plus utilisé.',
    'Ihre Organisation hat die Zahl der Telefone erreicht, die sie anmelden darf. Bitten Sie Ihren Administrator, ein nicht mehr genutztes Telefon abzumelden.',
    'وصلت مؤسستك إلى عدد الهواتف المسموح بتسجيل دخولها. اطلب من المسؤول تسجيل خروج هاتف لم يعد مستخدمًا.',
  ],
  'Mobile access is not available in that workspace.': [
    'El acceso móvil no está disponible en ese espacio de trabajo.',
    'L’accès mobile n’est pas disponible dans cet espace de travail.',
    'Mobiler Zugang ist in diesem Arbeitsbereich nicht verfügbar.',
    'الوصول عبر الجوال غير متاح في مساحة العمل هذه.',
  ],

  // Super Workspace
  'Mobile access has already been requested. The SampForce team will decide soon.': [
    'Ya se ha solicitado el acceso móvil. El equipo de SampForce decidirá pronto.',
    'L’accès mobile a déjà été demandé. L’équipe SampForce décidera bientôt.',
    'Mobiler Zugang wurde bereits beantragt. Das SampForce-Team entscheidet bald.',
    'تم طلب الوصول عبر الجوال بالفعل. سيقرر فريق SampForce قريبًا.',
  ],
  'Mobile access is already approved.': ['El acceso móvil ya está aprobado.', 'L’accès mobile est déjà approuvé.', 'Mobiler Zugang ist bereits genehmigt.', 'الوصول عبر الجوال معتمد بالفعل.'],
  'Mobile access is suspended. Contact SampForce support.': [
    'El acceso móvil está suspendido. Contacta con el soporte de SampForce.',
    'L’accès mobile est suspendu. Contactez le support SampForce.',
    'Mobiler Zugang ist ausgesetzt. Wenden Sie sich an den SampForce-Support.',
    'الوصول عبر الجوال معلّق. تواصل مع دعم SampForce.',
  ],
  'Mobile access has to be approved by the SampForce team before you can switch it on.': [
    'El equipo de SampForce tiene que aprobar el acceso móvil antes de que puedas activarlo.',
    'L’équipe SampForce doit approuver l’accès mobile avant que vous puissiez l’activer.',
    'Das SampForce-Team muss den mobilen Zugang genehmigen, bevor Sie ihn einschalten können.',
    'يجب أن يوافق فريق SampForce على الوصول عبر الجوال قبل أن تتمكن من تفعيله.',
  ],
  'That phone was not found.': ['No se encontró ese teléfono.', 'Ce téléphone est introuvable.', 'Dieses Telefon wurde nicht gefunden.', 'لم يتم العثور على هذا الهاتف.'],

  // Console Admin
  'That change is not possible in mobile access’s current state. Reload the page and try again.': [
    'Ese cambio no es posible en el estado actual del acceso móvil. Recarga la página e inténtalo de nuevo.',
    'Ce changement n’est pas possible dans l’état actuel de l’accès mobile. Rechargez la page et réessayez.',
    'Diese Änderung ist im aktuellen Zustand des mobilen Zugangs nicht möglich. Laden Sie die Seite neu und versuchen Sie es erneut.',
    'هذا التغيير غير ممكن في الحالة الحالية للوصول عبر الجوال. أعد تحميل الصفحة وحاول مرة أخرى.',
  ],
  'The client’s plan does not include the mobile app. Add “Mobile app” to the plan, or switch it on for this client under Plan features, first.': [
    'El plan del cliente no incluye la aplicación móvil. Primero añade «Aplicación móvil» al plan o actívala para este cliente en Funciones del plan.',
    'L’offre du client n’inclut pas l’application mobile. Ajoutez d’abord « Application mobile » à l’offre, ou activez-la pour ce client dans Fonctionnalités de l’offre.',
    'Der Tarif des Kunden enthält die Mobile App nicht. Fügen Sie zuerst „Mobile App“ zum Tarif hinzu oder schalten Sie sie für diesen Kunden unter Tariffunktionen ein.',
    'لا تتضمن خطة العميل تطبيق الجوال. أضف أولًا «تطبيق الجوال» إلى الخطة، أو فعّله لهذا العميل ضمن ميزات الخطة.',
  ],

  // Validation
  'Give a reason of at least 5 characters': ['Indica un motivo de al menos 5 caracteres', 'Indiquez une raison d’au moins 5 caractères', 'Geben Sie einen Grund mit mindestens 5 Zeichen an', 'اذكر سببًا من 5 أحرف على الأقل'],
  'Use letters, digits, - and _ only': ['Usa solo letras, números, - y _', 'Utilisez uniquement des lettres, des chiffres, - et _', 'Verwenden Sie nur Buchstaben, Ziffern, - und _', 'استخدم الحروف والأرقام و- و_ فقط'],
} satisfies TextTable;
