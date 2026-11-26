import type { PhraseTable } from './types';

/** Task progress, comment reactions and the new target periods and metrics (redesign R7, ADR 0091). */
export const tasksTargets = {
  'Blocked because': ['Bloqueada porque', 'Bloquée parce que', 'Blockiert, weil', 'متوقفة بسبب'],
  'Blocked: {reason}': ['Bloqueada: {reason}', 'Bloquée : {reason}', 'Blockiert: {reason}', 'متوقفة: {reason}'],
  'Where does it stand?': ['¿En qué punto está?', 'Où en est-elle ?', 'Wie ist der Stand?', 'ما وضعها الآن؟'],
  'Start working': ['Empezar a trabajar', 'Commencer', 'Mit der Arbeit beginnen', 'بدء العمل'],
  'I’m blocked': ['Estoy bloqueado', 'Je suis bloqué', 'Ich komme nicht weiter', 'أنا متوقف'],
  'What is blocking it?': ['¿Qué la bloquea?', 'Qu’est-ce qui la bloque ?', 'Was blockiert sie?', 'ما الذي يعيقها؟'],
  'Tell them': ['Avisar', 'Prévenir', 'Mitteilen', 'إبلاغهم'],
  'marked it {state}': ['la marcó como {state}', 'l’a marquée {state}', 'hat sie als {state} markiert', 'وضع عليها حالة {state}'],
  'Add a reaction': ['Añadir una reacción', 'Ajouter une réaction', 'Reaktion hinzufügen', 'إضافة تفاعل'],
  '{emoji} by {names}': ['{emoji} de {names}', '{emoji} par {names}', '{emoji} von {names}', '{emoji} من {names}'],
  'Follow-ups completed': ['Seguimientos completados', 'Relances effectuées', 'Erledigte Nachfassaktionen', 'المتابعات المكتملة'],
  Conversions: ['Conversiones', 'Conversions', 'Konversionen', 'التحويلات'],
  'Half-yearly': ['Semestral', 'Semestriel', 'Halbjährlich', 'نصف سنوي'],
  Yearly: ['Anual', 'Annuel', 'Jährlich', 'سنوي'],
} as const satisfies PhraseTable;
