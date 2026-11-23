import type { PhraseTable } from './types';

/** Password confirmation before destructive actions (workspace redesign W1). */
export const security = {
  'Confirm deletion': ['Confirmar eliminación', 'Confirmer la suppression', 'Löschen bestätigen', 'تأكيد الحذف'],
  'This action will permanently delete the selected data.': ['Esta acción eliminará de forma permanente los datos seleccionados.', 'Cette action supprimera définitivement les données sélectionnées.', 'Diese Aktion löscht die ausgewählten Daten dauerhaft.', 'سيؤدي هذا الإجراء إلى حذف البيانات المحددة نهائيًا.'],
  'Please enter your password to continue.': ['Introduce tu contraseña para continuar.', 'Saisissez votre mot de passe pour continuer.', 'Geben Sie Ihr Passwort ein, um fortzufahren.', 'أدخل كلمة المرور للمتابعة.'],
  'Type {name} to confirm': ['Escribe {name} para confirmar', 'Saisissez {name} pour confirmer', 'Geben Sie {name} zur Bestätigung ein', 'اكتب {name} للتأكيد'],
  'Two-step code': ['Código de dos pasos', 'Code en deux étapes', 'Zwei-Schritt-Code', 'رمز الخطوتين'],
  'Use my password instead': ['Usar mi contraseña', 'Utiliser plutôt mon mot de passe', 'Stattdessen mein Passwort verwenden', 'استخدام كلمة المرور بدلًا من ذلك'],
  'I sign in with single sign-on: use a two-step code': ['Inicio sesión con inicio de sesión único: usar un código de dos pasos', 'Je me connecte par authentification unique : utiliser un code en deux étapes', 'Ich melde mich per Single Sign-on an: Zwei-Schritt-Code verwenden', 'أسجّل الدخول بالدخول الموحّد: استخدام رمز الخطوتين'],
  'Your password check has expired. Enter your password again.': ['La verificación de tu contraseña ha caducado. Vuelve a introducir tu contraseña.', 'La vérification de votre mot de passe a expiré. Saisissez à nouveau votre mot de passe.', 'Die Passwortprüfung ist abgelaufen. Geben Sie Ihr Passwort erneut ein.', 'انتهت صلاحية التحقق من كلمة المرور. أدخل كلمة المرور مرة أخرى.'],
} as const satisfies PhraseTable;
