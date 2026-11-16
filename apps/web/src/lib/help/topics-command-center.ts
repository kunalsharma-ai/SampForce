import type { HelpTable } from './types';

/** Help for the Command Center dashboards (ADR 0063): executive, manager and senior management. */
export const commandCenterHelp = {
  'cc.execKpis': {
    title: 'Key metrics',
    what: [
      'Your numbers for the period, counted from real records: leads, contacts, emails, responses, follow-ups, RFQs, clients and revenue.',
      'Tus cifras del periodo, contadas a partir de registros reales: leads, contactos, correos, respuestas, seguimientos, RFQs, clientes e ingresos.',
      'Vos chiffres de la période, comptés à partir des vrais enregistrements : prospects, contacts, e-mails, réponses, relances, RFQ, clients et revenu.',
      'Ihre Zahlen für den Zeitraum, aus echten Datensätzen gezählt: Leads, Kontakte, E-Mails, Antworten, Nachverfolgungen, RFQs, Kunden und Umsatz.',
      'أرقامك للفترة، محسوبة من السجلات الفعلية: العملاء المحتملون والتواصل والبريد والردود والمتابعات وطلبات عروض الأسعار والعملاء والإيرادات.',
    ],
    how: [
      'Choose a period at the top. Select a number to see the records behind it; the "i" next to each card says how it is counted.',
      'Elige un periodo arriba. Selecciona una cifra para ver sus registros; la «i» de cada tarjeta explica cómo se cuenta.',
      'Choisissez une période en haut. Sélectionnez un chiffre pour voir ses enregistrements ; le « i » de chaque carte explique le calcul.',
      'Wählen Sie oben einen Zeitraum. Wählen Sie eine Zahl, um die Datensätze dahinter zu sehen; das „i“ jeder Karte erklärt die Zählung.',
      'اختر فترة في الأعلى. اختر رقمًا لترى السجلات التي خلفه؛ وتشرح «i» في كل بطاقة طريقة الحساب.',
    ],
    where: [
      'Start your day here. Managers can open the dashboard of anyone who reports to them.',
      'Empieza aquí tu jornada. Los gerentes pueden abrir el panel de cualquiera que dependa de ellos.',
      'Commencez votre journée ici. Les managers peuvent ouvrir le tableau de bord de toute personne qui leur est rattachée.',
      'Beginnen Sie hier Ihren Tag. Führungskräfte können das Dashboard jeder Person öffnen, die an sie berichtet.',
      'ابدأ يومك من هنا. ويمكن للمديرين فتح لوحة أي شخص يتبعهم.',
    ],
  },
  'cc.myWork': {
    title: 'My work',
    what: [
      'What needs you now: follow-ups due today and overdue, calls and meetings, RFQ deadlines, concerns and work handed to you.',
      'Lo que te necesita ahora: seguimientos de hoy y vencidos, llamadas y reuniones, plazos de RFQ, inquietudes y trabajo que te han pasado.',
      'Ce qui vous attend : relances du jour et en retard, appels et rendez-vous, échéances des RFQ, préoccupations et travail qui vous est confié.',
      'Was jetzt ansteht: heutige und überfällige Nachverfolgungen, Anrufe und Meetings, RFQ-Fristen, Anliegen und Ihnen übergebene Arbeit.',
      'ما يحتاجك الآن: متابعات اليوم والمتأخرة والمكالمات والاجتماعات ومواعيد طلبات عروض الأسعار والمخاوف والعمل المُسند إليك.',
    ],
    how: [
      'Open an item to work on it. Customise reorders or hides the sections and adds your own categories by follow-up type or priority.',
      'Abre un elemento para trabajar en él. Personalizar reordena u oculta secciones y añade tus categorías por tipo o prioridad.',
      'Ouvrez un élément pour le traiter. Personnaliser réordonne ou masque les sections et ajoute vos catégories par type ou priorité.',
      'Öffnen Sie einen Eintrag, um ihn zu bearbeiten. Anpassen ordnet Bereiche neu, blendet sie aus und fügt eigene Kategorien nach Typ oder Priorität hinzu.',
      'افتح عنصرًا للعمل عليه. ويتيح «تخصيص» إعادة ترتيب الأقسام أو إخفاءها وإضافة فئاتك حسب نوع المتابعة أو أولويتها.',
    ],
    where: [
      'Your arrangement is yours alone; it changes what you see, never the numbers.',
      'Tu disposición es solo tuya; cambia lo que ves, nunca las cifras.',
      'Votre disposition n’appartient qu’à vous ; elle change l’affichage, jamais les chiffres.',
      'Ihre Anordnung gilt nur für Sie; sie ändert die Ansicht, nie die Zahlen.',
      'ترتيبك خاص بك وحدك؛ يغيّر ما تراه ولا يغيّر الأرقام أبدًا.',
    ],
  },
  'cc.funnel': {
    title: 'My pipeline',
    what: [
      'Your company leads at each stage from new to won or lost, with open opportunities, their potential value and conversion.',
      'Tus leads de empresa en cada etapa, de nuevo a ganado o perdido, con las oportunidades abiertas, su valor potencial y la conversión.',
      'Vos prospects d’entreprise à chaque étape, du nouveau au gagné ou perdu, avec les opportunités ouvertes, leur valeur potentielle et la conversion.',
      'Ihre Unternehmens-Leads in jeder Stufe von neu bis gewonnen oder verloren, mit offenen Verkaufschancen, potenziellem Wert und Konversion.',
      'عملاؤك المحتملون من الشركات في كل مرحلة من جديد إلى رابح أو خاسر، مع الفرص المفتوحة وقيمتها المحتملة ونسبة التحويل.',
    ],
    how: [
      'Select a stage to list its companies. A company sits at the furthest stage its status, RFQs and deals show.',
      'Selecciona una etapa para ver sus empresas. Cada empresa está en la etapa más avanzada que muestran su estado, RFQs y ventas.',
      'Sélectionnez une étape pour lister ses entreprises. Une entreprise se place à l’étape la plus avancée que montrent son statut, ses RFQ et ses affaires.',
      'Wählen Sie eine Stufe, um ihre Unternehmen zu sehen. Ein Unternehmen steht in der weitesten Stufe, die Status, RFQs und Verkaufschancen zeigen.',
      'اختر مرحلة لعرض شركاتها. تقع الشركة في أبعد مرحلة تدل عليها حالتها وطلبات عروض الأسعار والصفقات.',
    ],
    where: [
      'Potential value counts open deals and open RFQ quotations without a deal, in the workspace currency.',
      'El valor potencial cuenta las ventas abiertas y las cotizaciones de RFQ abiertas sin venta, en la moneda del espacio de trabajo.',
      'La valeur potentielle compte les affaires ouvertes et les devis de RFQ ouverts sans affaire, dans la devise de l’espace de travail.',
      'Der potenzielle Wert zählt offene Verkaufschancen und offene RFQ-Angebote ohne Verkaufschance, in der Währung des Arbeitsbereichs.',
      'تحتسب القيمة المحتملة الصفقات المفتوحة وعروض أسعار الطلبات المفتوحة بلا صفقة، بعملة مساحة العمل.',
    ],
  },
  'cc.performance': {
    title: 'Business performance',
    what: [
      'Leads by month, quarter, half-year and year, RFQs and their win rate, revenue against your target, lead conversion and average deal value.',
      'Leads por mes, trimestre, semestre y año, RFQs y su tasa de éxito, ingresos frente a tu objetivo, conversión de leads y valor medio por venta.',
      'Prospects par mois, trimestre, semestre et année, RFQ et taux de réussite, revenu face à votre objectif, conversion et valeur moyenne des affaires.',
      'Leads nach Monat, Quartal, Halbjahr und Jahr, RFQs und Erfolgsquote, Umsatz gegen Ihr Ziel, Lead-Konversion und durchschnittlicher Abschlusswert.',
      'العملاء المحتملون حسب الشهر والربع والنصف والسنة، وطلبات عروض الأسعار ونسبة الفوز، والإيرادات مقابل هدفك، وتحويل العملاء ومتوسط قيمة الصفقة.',
    ],
    how: [
      'The win rate is RFQs won out of RFQs won or lost in the period. Your manager sets your monthly target.',
      'La tasa de éxito es RFQs ganadas entre ganadas o perdidas en el periodo. Tu gerente fija tu objetivo mensual.',
      'Le taux de réussite rapporte les RFQ gagnées aux RFQ gagnées ou perdues sur la période. Votre manager fixe votre objectif mensuel.',
      'Die Erfolgsquote ist gewonnene RFQs geteilt durch gewonnene oder verlorene im Zeitraum. Ihre Führungskraft legt Ihr Monatsziel fest.',
      'نسبة الفوز هي الطلبات الرابحة من الطلبات الرابحة أو الخاسرة في الفترة. ويحدد مديرك هدفك الشهري.',
    ],
    where: [
      'Receiving an RFQ is not won business: only won deals and won RFQs count as revenue.',
      'Recibir una RFQ no es negocio ganado: solo cuentan como ingresos las ventas y RFQs ganadas.',
      'Recevoir une RFQ n’est pas une affaire gagnée : seules les affaires et RFQ gagnées comptent comme revenu.',
      'Eine eingegangene RFQ ist kein gewonnenes Geschäft: Nur gewonnene Verkaufschancen und RFQs zählen als Umsatz.',
      'استلام طلب عرض سعر ليس عملًا رابحًا: لا تُحتسب إيرادات إلا الصفقات والطلبات الرابحة.',
    ],
  },
  'cc.revenue': {
    title: 'Revenue attribution',
    what: [
      'Your share of each won deal and won RFQ, by period. Each record is split between the people who won it, adding up to 100%.',
      'Tu parte de cada venta y RFQ ganada, por periodo. Cada registro se reparte entre quienes lo ganaron y suma el 100 %.',
      'Votre part de chaque affaire et RFQ gagnée, par période. Chaque enregistrement est réparti entre ceux qui l’ont gagné, pour 100 % au total.',
      'Ihr Anteil an jeder gewonnenen Verkaufschance und RFQ, nach Zeitraum. Jeder Datensatz wird auf die Gewinner aufgeteilt, zusammen 100 %.',
      'حصتك من كل صفقة وطلب عرض سعر رابح، حسب الفترة. يُوزَّع كل سجل على من ربحوه ويبلغ مجموعه 100%.',
    ],
    how: [
      'Open a record to see who holds which share. Someone who manages pipelines can set a split by hand or put it back on the workspace rule.',
      'Abre un registro para ver quién tiene cada parte. Quien gestiona los embudos puede fijar un reparto a mano o volver a la regla del espacio.',
      'Ouvrez un enregistrement pour voir qui détient quelle part. Un gestionnaire des pipelines peut fixer une répartition à la main ou revenir à la règle.',
      'Öffnen Sie einen Datensatz, um die Anteile zu sehen. Wer Pipelines verwaltet, kann eine Aufteilung von Hand festlegen oder zur Regel zurückkehren.',
      'افتح سجلًا لترى حصة كل شخص. ويمكن لمن يدير مسارات المبيعات تحديد توزيع يدويًا أو إعادته إلى قاعدة مساحة العمل.',
    ],
    where: [
      'Team and company totals count each record once, so revenue is never counted twice.',
      'Los totales del equipo y de la empresa cuentan cada registro una sola vez, así los ingresos nunca se cuentan dos veces.',
      'Les totaux de l’équipe et de l’entreprise comptent chaque enregistrement une fois : le revenu n’est jamais compté deux fois.',
      'Team- und Unternehmenssummen zählen jeden Datensatz einmal, Umsatz wird also nie doppelt gezählt.',
      'تحتسب إجماليات الفريق والشركة كل سجل مرة واحدة، فلا تُحتسب الإيرادات مرتين أبدًا.',
    ],
  },
  'cc.transfers': {
    title: 'Lead transfer requests',
    what: [
      'Requests to move a lead to a manager or senior person: the ones you sent and the ones waiting for your decision.',
      'Solicitudes para pasar un lead a un gerente o superior: las que enviaste y las que esperan tu decisión.',
      'Les demandes de transfert d’un prospect à un manager ou un cadre : celles que vous avez envoyées et celles qui attendent votre décision.',
      'Anfragen, einen Lead an eine Führungskraft zu übergeben: Ihre gesendeten und die, die auf Ihre Entscheidung warten.',
      'طلبات نقل عميل محتمل إلى مدير أو مسؤول أعلى: ما أرسلته وما ينتظر قرارك.',
    ],
    how: [
      'Ask from a company page with Request transfer. Someone above you approves, rejects or gives the lead to someone else, with instructions.',
      'Pídelo desde la página de la empresa con Solicitar traspaso. Alguien por encima de ti aprueba, rechaza o da el lead a otra persona, con instrucciones.',
      'Demandez depuis la page de l’entreprise avec Demander un transfert. Un supérieur approuve, refuse ou confie le prospect à quelqu’un d’autre, avec des consignes.',
      'Fragen Sie auf der Unternehmensseite mit Übergabe anfragen an. Eine vorgesetzte Person genehmigt, lehnt ab oder gibt den Lead mit Anweisungen weiter.',
      'اطلبه من صفحة الشركة عبر «طلب نقل». ويوافق من هو أعلى منك أو يرفض أو يسند العميل المحتمل إلى شخص آخر مع تعليمات.',
    ],
    where: [
      'The person who created the lead stays its creator whatever happens to ownership.',
      'Quien creó el lead sigue siendo su creador pase lo que pase con el responsable.',
      'La personne qui a créé le prospect en reste le créateur, quel que soit le responsable.',
      'Wer den Lead angelegt hat, bleibt sein Ersteller, egal wer ihn betreut.',
      'يبقى من أنشأ العميل المحتمل منشئه مهما تغيّر المسؤول عنه.',
    ],
  },
} as const satisfies HelpTable;
