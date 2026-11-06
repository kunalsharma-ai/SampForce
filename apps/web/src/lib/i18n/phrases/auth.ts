import type { PhraseTable } from './types';

/** The signed-out pages: sign in, two-step verification, single sign-on, sign up, password reset and invitations. */
export const auth = {
  // Layout
  'Close smarter. Grow faster.': ['Cierra mejor. Crece más rápido.', 'Concluez mieux. Grandissez plus vite.', 'Klüger abschließen. Schneller wachsen.', 'أغلق صفقاتك بذكاء. وانمُ أسرع.'],
  'Sell. Close. Grow.': ['Vende. Cierra. Crece.', 'Vendez. Concluez. Grandissez.', 'Verkaufen. Abschließen. Wachsen.', 'بِع. أغلِق. انمُ.'],
  'One workspace for leads, deals, automation and revenue intelligence, with AI that shows its reasoning and asks before it acts.': [
    'Un solo espacio para leads, oportunidades, automatización e inteligencia de ingresos, con una IA que explica su razonamiento y pregunta antes de actuar.',
    'Un seul espace pour les prospects, les opportunités, l’automatisation et l’intelligence commerciale, avec une IA qui explique son raisonnement et demande avant d’agir.',
    'Ein Arbeitsbereich für Leads, Verkaufschancen, Automatisierung und Umsatzanalysen, mit einer KI, die ihre Begründung zeigt und fragt, bevor sie handelt.',
    'مساحة عمل واحدة للعملاء المحتملين والصفقات والأتمتة وذكاء الإيرادات، مع ذكاء اصطناعي يوضح أسبابه ويستأذن قبل أن يتصرف.',
  ],

  // Sign in
  'Sign in': ['Iniciar sesión', 'Se connecter', 'Anmelden', 'تسجيل الدخول'],
  'Welcome back to your revenue workspace.': ['Te damos la bienvenida de nuevo a tu espacio de ingresos.', 'Bon retour dans votre espace commercial.', 'Willkommen zurück in Ihrem Umsatz-Arbeitsbereich.', 'مرحبًا بعودتك إلى مساحة عمل الإيرادات.'],
  'Work email': ['Correo del trabajo', 'E-mail professionnel', 'Geschäftliche E-Mail', 'البريد الإلكتروني للعمل'],
  Password: ['Contraseña', 'Mot de passe', 'Passwort', 'كلمة المرور'],
  'Forgot your password?': ['¿Olvidaste tu contraseña?', 'Mot de passe oublié ?', 'Passwort vergessen?', 'هل نسيت كلمة المرور؟'],
  'Signing in…': ['Iniciando sesión…', 'Connexion…', 'Anmeldung läuft…', 'جارٍ تسجيل الدخول…'],
  or: ['o', 'ou', 'oder', 'أو'],
  'Sign in with SSO': ['Iniciar sesión con SSO', 'Se connecter avec le SSO', 'Mit SSO anmelden', 'تسجيل الدخول عبر SSO'],
  'New to SampForce?': ['¿Eres nuevo en SampForce?', 'Nouveau sur SampForce ?', 'Neu bei SampForce?', 'جديد على SampForce؟'],
  'Start free': ['Empieza gratis', 'Commencer gratuitement', 'Kostenlos starten', 'ابدأ مجانًا'],
  'Could not reach SampForce. Check your connection.': [
    'No se pudo conectar con SampForce. Revisa tu conexión.',
    'Impossible de joindre SampForce. Vérifiez votre connexion.',
    'SampForce ist nicht erreichbar. Prüfen Sie Ihre Verbindung.',
    'تعذر الوصول إلى SampForce. تحقق من اتصالك.',
  ],

  // Two-step verification
  'Two-step verification': ['Verificación en dos pasos', 'Validation en deux étapes', 'Zweistufige Verifizierung', 'التحقق بخطوتين'],
  'Enter the 6-digit code from your authenticator app.': [
    'Introduce el código de 6 dígitos de tu app de autenticación.',
    'Saisissez le code à 6 chiffres de votre application d’authentification.',
    'Geben Sie den 6-stelligen Code aus Ihrer Authenticator-App ein.',
    'أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة.',
  ],
  'Enter one of the recovery codes you saved when you turned on two-step verification. Each code works once.': [
    'Introduce uno de los códigos de recuperación que guardaste al activar la verificación en dos pasos. Cada código sirve una sola vez.',
    'Saisissez l’un des codes de récupération enregistrés lors de l’activation de la validation en deux étapes. Chaque code ne sert qu’une fois.',
    'Geben Sie einen der Wiederherstellungscodes ein, die Sie beim Aktivieren der zweistufigen Verifizierung gespeichert haben. Jeder Code funktioniert nur einmal.',
    'أدخل أحد رموز الاسترداد التي حفظتها عند تفعيل التحقق بخطوتين. يعمل كل رمز مرة واحدة فقط.',
  ],
  'Authentication code': ['Código de autenticación', 'Code d’authentification', 'Authentifizierungscode', 'رمز المصادقة'],
  'Recovery code': ['Código de recuperación', 'Code de récupération', 'Wiederherstellungscode', 'رمز الاسترداد'],
  'Checking…': ['Comprobando…', 'Vérification…', 'Wird geprüft…', 'جارٍ التحقق…'],
  Verify: ['Verificar', 'Vérifier', 'Bestätigen', 'تحقق'],
  'Use a recovery code': ['Usar un código de recuperación', 'Utiliser un code de récupération', 'Wiederherstellungscode verwenden', 'استخدام رمز استرداد'],
  'Use your authenticator app': ['Usar tu app de autenticación', 'Utiliser votre application d’authentification', 'Authenticator-App verwenden', 'استخدام تطبيق المصادقة'],
  Back: ['Atrás', 'Retour', 'Zurück', 'رجوع'],

  // Single sign-on
  'Use your organization’s identity provider, such as Okta, Microsoft Entra ID or Google Workspace.': [
    'Usa el proveedor de identidad de tu organización, como Okta, Microsoft Entra ID o Google Workspace.',
    'Utilisez le fournisseur d’identité de votre organisation, comme Okta, Microsoft Entra ID ou Google Workspace.',
    'Verwenden Sie den Identitätsanbieter Ihrer Organisation, etwa Okta, Microsoft Entra ID oder Google Workspace.',
    'استخدم مزود الهوية الخاص بمؤسستك، مثل Okta أو Microsoft Entra ID أو Google Workspace.',
  ],
  'Workspace sign-in name': ['Nombre de acceso del espacio', 'Nom de connexion de l’espace', 'Anmeldename des Arbeitsbereichs', 'اسم تسجيل الدخول لمساحة العمل'],
  'Enter the sign-in name your administrator gave you, such as acme.': [
    'Introduce el nombre de acceso que te dio tu administrador, como acme.',
    'Saisissez le nom de connexion fourni par votre administrateur, par exemple acme.',
    'Geben Sie den Anmeldenamen ein, den Ihre Administration Ihnen gegeben hat, etwa acme.',
    'أدخل اسم تسجيل الدخول الذي أعطاك إياه المسؤول، مثل acme.',
  ],
  'Your administrator sets this in SampForce’s security settings.': [
    'Tu administrador lo configura en los ajustes de seguridad de SampForce.',
    'Votre administrateur le définit dans les paramètres de sécurité de SampForce.',
    'Ihre Administration legt dies in den Sicherheitseinstellungen von SampForce fest.',
    'يضبط المسؤول هذا في إعدادات الأمان في SampForce.',
  ],
  Continue: ['Continuar', 'Continuer', 'Weiter', 'متابعة'],
  'Sign in with email and password': ['Iniciar sesión con correo y contraseña', 'Se connecter avec e-mail et mot de passe', 'Mit E-Mail und Passwort anmelden', 'تسجيل الدخول بالبريد الإلكتروني وكلمة المرور'],
  'No workspace uses that single sign-on name, or single sign-on is turned off.': [
    'Ningún espacio usa ese nombre de inicio de sesión único, o el inicio de sesión único está desactivado.',
    'Aucun espace n’utilise ce nom d’authentification unique, ou l’authentification unique est désactivée.',
    'Kein Arbeitsbereich verwendet diesen Single-Sign-on-Namen, oder Single Sign-on ist ausgeschaltet.',
    'لا توجد مساحة عمل تستخدم اسم الدخول الموحد هذا، أو أن الدخول الموحد متوقف.',
  ],
  'Your identity provider did not complete the sign-in. Try again, or ask your administrator.': [
    'Tu proveedor de identidad no completó el inicio de sesión. Inténtalo de nuevo o consulta a tu administrador.',
    'Votre fournisseur d’identité n’a pas terminé la connexion. Réessayez ou contactez votre administrateur.',
    'Ihr Identitätsanbieter hat die Anmeldung nicht abgeschlossen. Versuchen Sie es erneut oder wenden Sie sich an Ihre Administration.',
    'لم يُكمل مزود الهوية تسجيل الدخول. حاول مرة أخرى أو اسأل المسؤول.',
  ],
  'The sign-in response could not be verified. Ask your administrator to check the single sign-on settings.': [
    'No se pudo verificar la respuesta de inicio de sesión. Pide a tu administrador que revise los ajustes del inicio de sesión único.',
    'La réponse de connexion n’a pas pu être vérifiée. Demandez à votre administrateur de vérifier les paramètres d’authentification unique.',
    'Die Anmeldeantwort konnte nicht überprüft werden. Bitten Sie Ihre Administration, die Single-Sign-on-Einstellungen zu prüfen.',
    'تعذر التحقق من استجابة تسجيل الدخول. اطلب من المسؤول مراجعة إعدادات الدخول الموحد.',
  ],
  'The sign-in took too long. Start again.': ['El inicio de sesión tardó demasiado. Empieza de nuevo.', 'La connexion a pris trop de temps. Recommencez.', 'Die Anmeldung hat zu lange gedauert. Beginnen Sie erneut.', 'استغرق تسجيل الدخول وقتًا طويلًا. ابدأ من جديد.'],
  'Your email domain is not allowed for this workspace.': [
    'El dominio de tu correo no está permitido en este espacio.',
    'Le domaine de votre e-mail n’est pas autorisé pour cet espace.',
    'Ihre E-Mail-Domain ist für diesen Arbeitsbereich nicht zugelassen.',
    'نطاق بريدك الإلكتروني غير مسموح به في مساحة العمل هذه.',
  ],
  'You do not have access to this workspace yet. Ask an administrator to invite you.': [
    'Aún no tienes acceso a este espacio. Pide a un administrador que te invite.',
    'Vous n’avez pas encore accès à cet espace. Demandez à un administrateur de vous inviter.',
    'Sie haben noch keinen Zugriff auf diesen Arbeitsbereich. Bitten Sie eine Administratorin oder einen Administrator um eine Einladung.',
    'ليس لديك وصول إلى مساحة العمل هذه بعد. اطلب من أحد المسؤولين دعوتك.',
  ],
  'Your access to this workspace is suspended.': ['Tu acceso a este espacio está suspendido.', 'Votre accès à cet espace est suspendu.', 'Ihr Zugriff auf diesen Arbeitsbereich ist gesperrt.', 'وصولك إلى مساحة العمل هذه معلّق.'],
  'This workspace has no free seats. Ask an administrator.': [
    'Este espacio no tiene puestos libres. Consulta a un administrador.',
    'Cet espace n’a plus de places disponibles. Contactez un administrateur.',
    'Dieser Arbeitsbereich hat keine freien Plätze. Wenden Sie sich an die Administration.',
    'لا توجد مقاعد متاحة في مساحة العمل هذه. اسأل أحد المسؤولين.',
  ],

  // Sign up
  'Create your workspace': ['Crea tu espacio de trabajo', 'Créez votre espace de travail', 'Arbeitsbereich erstellen', 'أنشئ مساحة عملك'],
  'Free for up to 2 users. No card required.': ['Gratis hasta 2 usuarios. Sin tarjeta.', 'Gratuit jusqu’à 2 utilisateurs. Sans carte bancaire.', 'Kostenlos für bis zu 2 Personen. Keine Karte nötig.', 'مجاني حتى مستخدمَين. لا حاجة إلى بطاقة.'],
  'Your name': ['Tu nombre', 'Votre nom', 'Ihr Name', 'اسمك'],
  'Organization name': ['Nombre de la organización', 'Nom de l’organisation', 'Name der Organisation', 'اسم المؤسسة'],
  'At least 10 characters, with a letter and a number.': [
    'Al menos 10 caracteres, con una letra y un número.',
    'Au moins 10 caractères, dont une lettre et un chiffre.',
    'Mindestens 10 Zeichen, mit einem Buchstaben und einer Zahl.',
    '10 أحرف على الأقل، تتضمن حرفًا ورقمًا.',
  ],
  'Creating workspace…': ['Creando el espacio…', 'Création de l’espace…', 'Arbeitsbereich wird erstellt…', 'جارٍ إنشاء مساحة العمل…'],
  'Already have an account?': ['¿Ya tienes una cuenta?', 'Vous avez déjà un compte ?', 'Sie haben bereits ein Konto?', 'لديك حساب بالفعل؟'],

  // Validation sent by the shared schemas
  'Use at least 10 characters': ['Usa al menos 10 caracteres', 'Utilisez au moins 10 caractères', 'Verwenden Sie mindestens 10 Zeichen', 'استخدم 10 أحرف على الأقل'],
  'Include at least one letter': ['Incluye al menos una letra', 'Incluez au moins une lettre', 'Verwenden Sie mindestens einen Buchstaben', 'أضف حرفًا واحدًا على الأقل'],
  'Include at least one number': ['Incluye al menos un número', 'Incluez au moins un chiffre', 'Verwenden Sie mindestens eine Zahl', 'أضف رقمًا واحدًا على الأقل'],
  'Enter your name': ['Introduce tu nombre', 'Saisissez votre nom', 'Geben Sie Ihren Namen ein', 'أدخل اسمك'],
  'Enter your organization name': ['Introduce el nombre de tu organización', 'Saisissez le nom de votre organisation', 'Geben Sie den Namen Ihrer Organisation ein', 'أدخل اسم مؤسستك'],
  'Enter your password': ['Introduce tu contraseña', 'Saisissez votre mot de passe', 'Geben Sie Ihr Passwort ein', 'أدخل كلمة المرور'],
  'Invalid email': ['Correo no válido', 'E-mail non valide', 'Ungültige E-Mail-Adresse', 'بريد إلكتروني غير صالح'],
  'The passwords do not match': ['Las contraseñas no coinciden', 'Les mots de passe ne correspondent pas', 'Die Passwörter stimmen nicht überein', 'كلمتا المرور غير متطابقتين'],
  'Choose a stronger password': ['Elige una contraseña más segura', 'Choisissez un mot de passe plus robuste', 'Wählen Sie ein sichereres Passwort', 'اختر كلمة مرور أقوى'],

  // Password reset
  'Reset your password': ['Restablece tu contraseña', 'Réinitialisez votre mot de passe', 'Passwort zurücksetzen', 'إعادة تعيين كلمة المرور'],
  'Enter the email you sign in with and we will send you a link to choose a new password.': [
    'Introduce el correo con el que inicias sesión y te enviaremos un enlace para elegir una contraseña nueva.',
    'Saisissez l’e-mail avec lequel vous vous connectez et nous vous enverrons un lien pour choisir un nouveau mot de passe.',
    'Geben Sie die E-Mail-Adresse ein, mit der Sie sich anmelden, und wir senden Ihnen einen Link für ein neues Passwort.',
    'أدخل البريد الإلكتروني الذي تسجّل الدخول به وسنرسل إليك رابطًا لاختيار كلمة مرور جديدة.',
  ],
  'Check your email': ['Revisa tu correo', 'Consultez vos e-mails', 'Prüfen Sie Ihre E-Mails', 'تحقق من بريدك الإلكتروني'],
  'If {email} has a SampForce account, a reset link is on its way. It works once and expires soon. Nothing arrived? Check spam, or ask again in a few minutes.': [
    'Si {email} tiene una cuenta de SampForce, el enlace para restablecerla va en camino. Sirve una sola vez y caduca pronto. ¿No llegó nada? Revisa el spam o vuelve a pedirlo en unos minutos.',
    'Si {email} a un compte SampForce, un lien de réinitialisation est en route. Il ne sert qu’une fois et expire bientôt. Rien reçu ? Vérifiez vos spams ou redemandez dans quelques minutes.',
    'Wenn {email} ein SampForce-Konto hat, ist ein Link zum Zurücksetzen unterwegs. Er funktioniert einmal und läuft bald ab. Nichts angekommen? Prüfen Sie den Spam-Ordner oder fragen Sie in ein paar Minuten erneut.',
    'إذا كان لدى {email} حساب في SampForce، فرابط إعادة التعيين في الطريق. يعمل مرة واحدة وتنتهي صلاحيته قريبًا. لم يصلك شيء؟ تحقق من البريد العشوائي أو اطلبه مجددًا بعد بضع دقائق.',
  ],
  'Sending…': ['Enviando…', 'Envoi…', 'Wird gesendet…', 'جارٍ الإرسال…'],
  'Send reset link': ['Enviar enlace', 'Envoyer le lien', 'Link senden', 'إرسال رابط إعادة التعيين'],
  'Your workspace uses single sign-on? Reset your password with your company instead.': [
    '¿Tu espacio usa inicio de sesión único? Restablece la contraseña con tu empresa.',
    'Votre espace utilise l’authentification unique ? Réinitialisez plutôt votre mot de passe auprès de votre entreprise.',
    'Ihr Arbeitsbereich nutzt Single Sign-on? Setzen Sie Ihr Passwort dann bei Ihrem Unternehmen zurück.',
    'هل تستخدم مساحة عملك الدخول الموحد؟ أعد تعيين كلمة المرور لدى شركتك بدلًا من ذلك.',
  ],
  'Back to sign in': ['Volver a iniciar sesión', 'Retour à la connexion', 'Zurück zur Anmeldung', 'العودة إلى تسجيل الدخول'],
  'Choose a new password': ['Elige una contraseña nueva', 'Choisissez un nouveau mot de passe', 'Neues Passwort wählen', 'اختر كلمة مرور جديدة'],
  'Your password was changed': ['Se cambió tu contraseña', 'Votre mot de passe a été modifié', 'Ihr Passwort wurde geändert', 'تم تغيير كلمة المرور'],
  'Sign in with your new password. If you use two-step verification, you will still need your code.': [
    'Inicia sesión con tu contraseña nueva. Si usas la verificación en dos pasos, seguirás necesitando tu código.',
    'Connectez-vous avec votre nouveau mot de passe. Si vous utilisez la validation en deux étapes, votre code reste nécessaire.',
    'Melden Sie sich mit Ihrem neuen Passwort an. Wenn Sie die zweistufige Verifizierung nutzen, brauchen Sie weiterhin Ihren Code.',
    'سجّل الدخول بكلمة المرور الجديدة. إذا كنت تستخدم التحقق بخطوتين، فستظل بحاجة إلى رمزك.',
  ],
  'Go to sign in': ['Ir a iniciar sesión', 'Aller à la connexion', 'Zur Anmeldung', 'الانتقال إلى تسجيل الدخول'],
  'This page needs the link from your reset email. Open the link again, or ask for a new one.': [
    'Esta página necesita el enlace de tu correo de restablecimiento. Ábrelo de nuevo o pide uno nuevo.',
    'Cette page nécessite le lien de votre e-mail de réinitialisation. Rouvrez le lien ou demandez-en un nouveau.',
    'Diese Seite braucht den Link aus Ihrer E-Mail zum Zurücksetzen. Öffnen Sie den Link erneut oder fordern Sie einen neuen an.',
    'تحتاج هذه الصفحة إلى الرابط الموجود في رسالة إعادة التعيين. افتح الرابط مرة أخرى أو اطلب رابطًا جديدًا.',
  ],
  'Ask for a new link': ['Pedir un enlace nuevo', 'Demander un nouveau lien', 'Neuen Link anfordern', 'طلب رابط جديد'],
  'New password': ['Contraseña nueva', 'Nouveau mot de passe', 'Neues Passwort', 'كلمة المرور الجديدة'],
  'Type it again': ['Escríbela de nuevo', 'Saisissez-le à nouveau', 'Erneut eingeben', 'اكتبها مرة أخرى'],
  'At least 10 characters, with a letter and a number. You will be signed out on every device.': [
    'Al menos 10 caracteres, con una letra y un número. Se cerrará tu sesión en todos los dispositivos.',
    'Au moins 10 caractères, dont une lettre et un chiffre. Vous serez déconnecté sur tous vos appareils.',
    'Mindestens 10 Zeichen, mit einem Buchstaben und einer Zahl. Sie werden auf allen Geräten abgemeldet.',
    '10 أحرف على الأقل، تتضمن حرفًا ورقمًا. سيتم تسجيل خروجك من جميع الأجهزة.',
  ],
  'Save new password': ['Guardar contraseña nueva', 'Enregistrer le nouveau mot de passe', 'Neues Passwort speichern', 'حفظ كلمة المرور الجديدة'],

  // Invitations
  'Invitation unavailable': ['Invitación no disponible', 'Invitation indisponible', 'Einladung nicht verfügbar', 'الدعوة غير متاحة'],
  'Join {workspace}': ['Únete a {workspace}', 'Rejoindre {workspace}', '{workspace} beitreten', 'الانضمام إلى {workspace}'],
  'You were invited as {role} with {email}.': ['Te invitaron como {role} con {email}.', 'Vous avez été invité en tant que {role} avec {email}.', 'Sie wurden als {role} mit {email} eingeladen.', 'تمت دعوتك بصفة {role} باستخدام {email}.'],
  'You already have an account; confirm it is you.': ['Ya tienes una cuenta; confirma que eres tú.', 'Vous avez déjà un compte ; confirmez qu’il s’agit bien de vous.', 'Sie haben bereits ein Konto; bestätigen Sie, dass Sie es sind.', 'لديك حساب بالفعل؛ أكّد أنك صاحبه.'],
  'Your SampForce password': ['Tu contraseña de SampForce', 'Votre mot de passe SampForce', 'Ihr SampForce-Passwort', 'كلمة مرورك في SampForce'],
  'Choose a password': ['Elige una contraseña', 'Choisissez un mot de passe', 'Passwort wählen', 'اختر كلمة مرور'],
  'Joining…': ['Uniéndote…', 'Connexion à l’espace…', 'Beitritt läuft…', 'جارٍ الانضمام…'],
} as const satisfies PhraseTable;
