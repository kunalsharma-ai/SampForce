import type { PhraseTable } from './types';

/** Company logos (ADR 0070): the logo on the company profile and in the companies list. */
export const companyLogos = {
  'Finding the logo from the website…': ['Buscando el logotipo en el sitio web…', 'Recherche du logo sur le site web…', 'Logo wird auf der Website gesucht…', 'جارٍ البحث عن الشعار في الموقع الإلكتروني…'],
  'Uploaded logo': ['Logotipo subido', 'Logo importé', 'Hochgeladenes Logo', 'شعار مرفوع'],
  'Logo from the company’s website': ['Logotipo del sitio web de la empresa', 'Logo du site web de l’entreprise', 'Logo von der Website des Unternehmens', 'شعار من الموقع الإلكتروني للشركة'],
  'No logo found on the website': ['No se encontró un logotipo en el sitio web', 'Aucun logo trouvé sur le site web', 'Kein Logo auf der Website gefunden', 'لم يُعثر على شعار في الموقع الإلكتروني'],
  'Change logo': ['Cambiar logotipo', 'Changer le logo', 'Logo ändern', 'تغيير الشعار'],
  'Upload logo': ['Subir logotipo', 'Importer un logo', 'Logo hochladen', 'رفع شعار'],
  'Find the logo on the website again': ['Volver a buscar el logotipo en el sitio web', 'Rechercher à nouveau le logo sur le site web', 'Logo erneut auf der Website suchen', 'البحث عن الشعار في الموقع الإلكتروني مجددًا'],
  'Use the website’s logo instead': ['Usar el logotipo del sitio web', 'Utiliser plutôt le logo du site web', 'Stattdessen das Logo der Website verwenden', 'استخدام شعار الموقع الإلكتروني بدلًا منه'],
} as const satisfies PhraseTable;
