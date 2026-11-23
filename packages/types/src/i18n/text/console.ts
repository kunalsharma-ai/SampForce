import type { TextTable } from '../catalogue';

/** The Console Admin (ADR 0074): operators, roles and permissions, and operator password links. */
export const consoleAdmin = {
  'This link has expired or was already used. Ask for a new one.': [
    'Este enlace ha caducado o ya se usó. Pide uno nuevo.',
    'Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.',
    'Dieser Link ist abgelaufen oder wurde bereits verwendet. Fordern Sie einen neuen an.',
    'انتهت صلاحية هذا الرابط أو تم استخدامه بالفعل. اطلب رابطًا جديدًا.',
  ],
  'You can only give permissions that you have yourself.': [
    'Solo puedes conceder permisos que tú mismo tienes.',
    'Vous ne pouvez accorder que des autorisations que vous avez vous-même.',
    'Sie können nur Berechtigungen vergeben, die Sie selbst haben.',
    'يمكنك منح الصلاحيات التي تملكها أنت فقط.',
  ],
  'Choose one of the roles in the list.': [
    'Elige uno de los roles de la lista.',
    'Choisissez l’un des rôles de la liste.',
    'Wählen Sie eine der Rollen aus der Liste.',
    'اختر أحد الأدوار في القائمة.',
  ],
  'A role with this name already exists.': [
    'Ya existe un rol con este nombre.',
    'Un rôle portant ce nom existe déjà.',
    'Eine Rolle mit diesem Namen gibt es bereits.',
    'يوجد دور بهذا الاسم بالفعل.',
  ],
  'Built-in roles cannot be changed. Create a custom role instead.': [
    'Los roles integrados no se pueden cambiar. Crea un rol personalizado.',
    'Les rôles intégrés ne peuvent pas être modifiés. Créez plutôt un rôle personnalisé.',
    'Integrierte Rollen können nicht geändert werden. Legen Sie stattdessen eine eigene Rolle an.',
    'لا يمكن تغيير الأدوار المدمجة. أنشئ دورًا مخصصًا بدلًا من ذلك.',
  ],
  'You cannot change your own role.': [
    'No puedes cambiar tu propio rol.',
    'Vous ne pouvez pas modifier votre propre rôle.',
    'Sie können Ihre eigene Rolle nicht ändern.',
    'لا يمكنك تغيير دورك.',
  ],
  'Move the operators with this role to another role first.': [
    'Primero pasa a otro rol a los operadores que tienen este.',
    'Attribuez d’abord un autre rôle aux opérateurs qui ont celui-ci.',
    'Weisen Sie den Operatoren mit dieser Rolle zuerst eine andere Rolle zu.',
    'انقل المشغلين الذين لديهم هذا الدور إلى دور آخر أولًا.',
  ],
  'Operator not found.': ['Operador no encontrado.', 'Opérateur introuvable.', 'Operator nicht gefunden.', 'المشغل غير موجود.'],
  'An operator with this email already exists.': [
    'Ya existe un operador con este correo.',
    'Un opérateur avec cette adresse e-mail existe déjà.',
    'Es gibt bereits einen Operator mit dieser E-Mail-Adresse.',
    'يوجد مشغل بهذا البريد الإلكتروني بالفعل.',
  ],
  'This operator has already set a password.': [
    'Este operador ya ha elegido una contraseña.',
    'Cet opérateur a déjà choisi un mot de passe.',
    'Dieser Operator hat bereits ein Passwort festgelegt.',
    'عيّن هذا المشغل كلمة مرور بالفعل.',
  ],
  'You cannot change your own role or switch off your own account.': [
    'No puedes cambiar tu propio rol ni desactivar tu propia cuenta.',
    'Vous ne pouvez pas modifier votre propre rôle ni désactiver votre propre compte.',
    'Sie können weder Ihre eigene Rolle ändern noch Ihr eigenes Konto abschalten.',
    'لا يمكنك تغيير دورك أو إيقاف حسابك.',
  ],
  'This is the last active Super Admin. Make another operator a Super Admin first.': [
    'Es el último superadministrador activo. Primero haz superadministrador a otro operador.',
    'C’est le dernier super administrateur actif. Nommez d’abord un autre opérateur super administrateur.',
    'Dies ist der letzte aktive Super-Admin. Machen Sie zuerst einen anderen Operator zum Super-Admin.',
    'هذا آخر مسؤول أعلى نشط. اجعل مشغلًا آخر مسؤولًا أعلى أولًا.',
  ],
  'Switch the operator back on first.': [
    'Primero vuelve a activar al operador.',
    'Réactivez d’abord l’opérateur.',
    'Schalten Sie den Operator zuerst wieder ein.',
    'أعد تفعيل المشغل أولًا.',
  ],
  'Choose a password you have not used before.': [
    'Elige una contraseña que no hayas usado antes.',
    'Choisissez un mot de passe que vous n’avez jamais utilisé.',
    'Wählen Sie ein Passwort, das Sie noch nicht verwendet haben.',
    'اختر كلمة مرور لم تستخدمها من قبل.',
  ],
  'Give the role a name of at least 2 characters.': [
    'Dale al rol un nombre de al menos 2 caracteres.',
    'Donnez au rôle un nom d’au moins 2 caractères.',
    'Geben Sie der Rolle einen Namen mit mindestens 2 Zeichen.',
    'أعطِ الدور اسمًا من حرفين على الأقل.',
  ],
  'Choose at least one permission.': [
    'Elige al menos un permiso.',
    'Choisissez au moins une autorisation.',
    'Wählen Sie mindestens eine Berechtigung.',
    'اختر صلاحية واحدة على الأقل.',
  ],
  'Enter a name.': ['Introduce un nombre.', 'Saisissez un nom.', 'Geben Sie einen Namen ein.', 'أدخل اسمًا.'],
  'Use letters and at least one number or symbol.': [
    'Usa letras y al menos un número o símbolo.',
    'Utilisez des lettres et au moins un chiffre ou un symbole.',
    'Verwenden Sie Buchstaben und mindestens eine Zahl oder ein Sonderzeichen.',
    'استخدم أحرفًا ورقمًا أو رمزًا واحدًا على الأقل.',
  ],
  'Use at least 12 characters.': [
    'Usa al menos 12 caracteres.',
    'Utilisez au moins 12 caractères.',
    'Verwenden Sie mindestens 12 Zeichen.',
    'استخدم 12 حرفًا على الأقل.',
  ],
  'Turn on two-step verification to use the Console.': [
    'Activa la verificación en dos pasos para usar la consola.',
    'Activez la validation en deux étapes pour utiliser la console.',
    'Schalten Sie die Bestätigung in zwei Schritten ein, um die Konsole zu nutzen.',
    'فعّل التحقق بخطوتين لاستخدام وحدة التحكم.',
  ],
  'Session not found.': ['Sesión no encontrada.', 'Session introuvable.', 'Sitzung nicht gefunden.', 'الجلسة غير موجودة.'],
  'The Console’s security policy requires two-step verification.': [
    'La política de seguridad de la consola exige la verificación en dos pasos.',
    'La politique de sécurité de la console exige la validation en deux étapes.',
    'Die Sicherheitsrichtlinie der Konsole verlangt die Bestätigung in zwei Schritten.',
    'تتطلب سياسة أمان وحدة التحكم التحقق بخطوتين.',
  ],
  'Use your account page to change your own two-step verification.': [
    'Usa la página de tu cuenta para cambiar tu verificación en dos pasos.',
    'Utilisez la page de votre compte pour modifier votre validation en deux étapes.',
    'Ändern Sie Ihre Bestätigung in zwei Schritten auf Ihrer Kontoseite.',
    'استخدم صفحة حسابك لتغيير التحقق بخطوتين الخاص بك.',
  ],
  'That audit entry was not found.': ['No se encontró esa entrada de auditoría.', 'Cette entrée du journal d’audit est introuvable.', 'Dieser Protokolleintrag wurde nicht gefunden.', 'لم يتم العثور على إدخال التدقيق هذا.'],
} satisfies TextTable;
