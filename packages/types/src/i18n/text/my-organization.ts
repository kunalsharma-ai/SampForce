import type { TextTable } from '../catalogue';

/** My Organization (ADR 0100): the organisation's own profile, documents, credentials and client shares. */
export const myOrganization = {
  'Send the document details as JSON': ['Envía los datos del documento como JSON', 'Envoyez les détails du document en JSON', 'Senden Sie die Dokumentangaben als JSON', 'أرسل بيانات المستند بصيغة JSON'],
  'Enter your company name': ['Escribe el nombre de tu empresa', 'Saisissez le nom de votre entreprise', 'Geben Sie den Namen Ihres Unternehmens ein', 'أدخل اسم شركتك'],
  'No logo yet.': ['Aún no hay logotipo.', 'Pas encore de logo.', 'Noch kein Logo.', 'لا يوجد شعار بعد.'],
  'Upload a PNG, JPEG, WebP or SVG logo.': ['Sube un logotipo PNG, JPEG, WebP o SVG.', 'Importez un logo PNG, JPEG, WebP ou SVG.', 'Laden Sie ein Logo als PNG, JPEG, WebP oder SVG hoch.', 'ارفع شعارًا بصيغة PNG أو JPEG أو WebP أو SVG.'],
  'Save the organization profile before adding a logo.': ['Guarda el perfil de la organización antes de añadir un logotipo.', 'Enregistrez le profil de l’organisation avant d’ajouter un logo.', 'Speichern Sie das Organisationsprofil, bevor Sie ein Logo hinzufügen.', 'احفظ ملف المؤسسة قبل إضافة شعار.'],
  'Documents can be up to 15 MB.': ['Los documentos pueden ocupar hasta 15 MB.', 'Les documents peuvent faire jusqu’à 15 Mo.', 'Dokumente dürfen bis zu 15 MB groß sein.', 'يمكن أن يصل حجم المستند إلى 15 ميغابايت.'],
  'Upload a PDF, image, text, CSV, Word, Excel, PowerPoint or ZIP file.': ['Sube un archivo PDF, de imagen, de texto, CSV, Word, Excel, PowerPoint o ZIP.', 'Importez un fichier PDF, image, texte, CSV, Word, Excel, PowerPoint ou ZIP.', 'Laden Sie eine PDF-, Bild-, Text-, CSV-, Word-, Excel-, PowerPoint- oder ZIP-Datei hoch.', 'ارفع ملف PDF أو صورة أو نص أو CSV أو Word أو Excel أو PowerPoint أو ZIP.'],
  'You can only keep a document for workspaces you are part of.': ['Solo puedes guardar un documento para los espacios de trabajo a los que perteneces.', 'Vous ne pouvez réserver un document qu’aux espaces de travail dont vous faites partie.', 'Sie können ein Dokument nur für Arbeitsbereiche freigeben, zu denen Sie gehören.', 'يمكنك حفظ المستند فقط لمساحات العمل التي تنتمي إليها.'],
  'You can only keep a credential for workspaces you are part of.': ['Solo puedes guardar una credencial para los espacios de trabajo a los que perteneces.', 'Vous ne pouvez réserver un identifiant qu’aux espaces de travail dont vous faites partie.', 'Sie können Zugangsdaten nur für Arbeitsbereiche freigeben, zu denen Sie gehören.', 'يمكنك حفظ بيانات الاعتماد فقط لمساحات العمل التي تنتمي إليها.'],
  'Credential not found.': ['No se encontró la credencial.', 'Identifiant introuvable.', 'Zugangsdaten nicht gefunden.', 'لم يتم العثور على بيانات الاعتماد.'],
  'Share not found.': ['No se encontró el enlace compartido.', 'Partage introuvable.', 'Freigabe nicht gefunden.', 'لم يتم العثور على المشاركة.'],
  'Only documents approved for client sharing can be shared. Ask a Super or Manager Workspace to approve them first.': [
    'Solo se pueden compartir los documentos aprobados para clientes. Pide primero a un espacio de trabajo Super o de gerente que los apruebe.',
    'Seuls les documents approuvés pour les clients peuvent être partagés. Demandez d’abord à un espace Super ou Manager de les approuver.',
    'Nur für Kunden freigegebene Dokumente können geteilt werden. Bitten Sie zuerst einen Super- oder Manager-Arbeitsbereich, sie freizugeben.',
    'لا يمكن مشاركة إلا المستندات المعتمدة للعملاء. اطلب أولًا من مساحة العمل الرئيسية أو مساحة المدير اعتمادها.',
  ],
  'Set up the organization profile before sharing it.': ['Configura el perfil de la organización antes de compartirlo.', 'Configurez le profil de l’organisation avant de le partager.', 'Richten Sie das Organisationsprofil ein, bevor Sie es teilen.', 'أعدّ ملف المؤسسة قبل مشاركته.'],
  'This link has expired or was stopped. Ask the person who sent it for a new one.': ['Este enlace ha caducado o se ha detenido. Pide uno nuevo a quien te lo envió.', 'Ce lien a expiré ou a été arrêté. Demandez-en un nouveau à la personne qui vous l’a envoyé.', 'Dieser Link ist abgelaufen oder wurde gestoppt. Bitten Sie die Person, die ihn gesendet hat, um einen neuen.', 'انتهت صلاحية هذا الرابط أو تم إيقافه. اطلب رابطًا جديدًا من الشخص الذي أرسله.'],
  'Your workspace may view My Organization but not change it. Ask the workspace above yours for Edit on Administration.': [
    'Tu espacio de trabajo puede ver Mi organización, pero no cambiarla. Pide al espacio superior el permiso Editar en Administración.',
    'Votre espace peut consulter Mon organisation sans la modifier. Demandez à l’espace au-dessus du vôtre le droit Modifier sur Administration.',
    'Ihr Arbeitsbereich darf Meine Organisation ansehen, aber nicht ändern. Bitten Sie den übergeordneten Arbeitsbereich um Bearbeiten in Verwaltung.',
    'يمكن لمساحة عملك عرض «مؤسستي» دون تغييرها. اطلب من مساحة العمل الأعلى صلاحية التعديل في الإدارة.',
  ],
  'Your workspace may not delete in My Organization. Ask the workspace above yours for Delete on Administration.': [
    'Tu espacio de trabajo no puede eliminar en Mi organización. Pide al espacio superior el permiso Eliminar en Administración.',
    'Votre espace ne peut rien supprimer dans Mon organisation. Demandez à l’espace au-dessus du vôtre le droit Supprimer sur Administration.',
    'Ihr Arbeitsbereich darf in Meine Organisation nichts löschen. Bitten Sie den übergeordneten Arbeitsbereich um Löschen in Verwaltung.',
    'لا يمكن لمساحة عملك الحذف في «مؤسستي». اطلب من مساحة العمل الأعلى صلاحية الحذف في الإدارة.',
  ],
  'Only the Super Workspace, and Manager Workspaces allowed to manage administration, can change credentials.': [
    'Solo el espacio de trabajo Super y los espacios de gerente autorizados a gestionar la administración pueden cambiar credenciales.',
    'Seuls l’espace Super et les espaces Manager autorisés à gérer l’administration peuvent modifier les identifiants.',
    'Nur der Super-Arbeitsbereich und Manager-Arbeitsbereiche, die die Verwaltung führen dürfen, können Zugangsdaten ändern.',
    'لا يمكن تغيير بيانات الاعتماد إلا لمساحة العمل الرئيسية ومساحات المديرين المسموح لها بإدارة الإدارة.',
  ],
  // Validation of the forms
  'Enter a web address': ['Escribe una dirección web', 'Saisissez une adresse web', 'Geben Sie eine Webadresse ein', 'أدخل عنوان موقع'],
  'Name it': ['Ponle un nombre', 'Donnez-lui un nom', 'Geben Sie einen Namen ein', 'أعطه اسمًا'],
  'Name the link': ['Ponle nombre al enlace', 'Nommez le lien', 'Benennen Sie den Link', 'أعطِ الرابط اسمًا'],
  'Enter a year up to 2100': ['Escribe un año hasta 2100', 'Saisissez une année jusqu’à 2100', 'Geben Sie ein Jahr bis 2100 ein', 'أدخل سنة حتى 2100'],
  'Enter a year from 1800': ['Escribe un año desde 1800', 'Saisissez une année à partir de 1800', 'Geben Sie ein Jahr ab 1800 ein', 'أدخل سنة من 1800'],
  'Use a colour like #E8590C': ['Usa un color como #E8590C', 'Utilisez une couleur comme #E8590C', 'Verwenden Sie eine Farbe wie #E8590C', 'استخدم لونًا مثل ‎#E8590C'],
  'The expiry date must be after the issue date': ['La fecha de caducidad debe ser posterior a la de emisión', 'La date d’expiration doit suivre la date d’émission', 'Das Ablaufdatum muss nach dem Ausstellungsdatum liegen', 'يجب أن يكون تاريخ الانتهاء بعد تاريخ الإصدار'],
  'Give the document a title': ['Ponle un título al documento', 'Donnez un titre au document', 'Geben Sie dem Dokument einen Titel', 'أعطِ المستند عنوانًا'],
  'Name the credential': ['Ponle nombre a la credencial', 'Nommez l’identifiant', 'Benennen Sie die Zugangsdaten', 'أعطِ بيانات الاعتماد اسمًا'],
  'Choose the profile or at least one document to share': ['Elige el perfil o al menos un documento para compartir', 'Choisissez le profil ou au moins un document à partager', 'Wählen Sie das Profil oder mindestens ein Dokument zum Teilen', 'اختر الملف أو مستندًا واحدًا على الأقل للمشاركة'],
} as const satisfies TextTable;

/** Notifications about organisation documents, translated when someone opens them. */
export const myOrganizationNotifications = {
  'Document expired: {title}': ['Documento caducado: {title}', 'Document expiré : {title}', 'Dokument abgelaufen: {title}', 'انتهت صلاحية المستند: {title}'],
  'Document expires within a week: {title}': ['El documento caduca en menos de una semana: {title}', 'Le document expire dans moins d’une semaine : {title}', 'Dokument läuft innerhalb einer Woche ab: {title}', 'تنتهي صلاحية المستند خلال أسبوع: {title}'],
  'Document expires within 30 days: {title}': ['El documento caduca en menos de 30 días: {title}', 'Le document expire dans moins de 30 jours : {title}', 'Dokument läuft innerhalb von 30 Tagen ab: {title}', 'تنتهي صلاحية المستند خلال 30 يومًا: {title}'],
  'Expiry date {date}. Upload the renewed document in My Organization.': ['Fecha de caducidad {date}. Sube el documento renovado en Mi organización.', 'Date d’expiration {date}. Importez le document renouvelé dans Mon organisation.', 'Ablaufdatum {date}. Laden Sie das erneuerte Dokument in Meine Organisation hoch.', 'تاريخ الانتهاء {date}. ارفع المستند المجدَّد في «مؤسستي».'],
} as const satisfies TextTable;
