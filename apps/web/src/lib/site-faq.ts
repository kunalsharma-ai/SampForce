/**
 * Help & Support on the public website (ADR 0078): the questions people ask before they have an account or while
 * they cannot get in. Answers describe what SampForce does today; links go to real pages.
 */
/** How each topic of a website message is named. */
export const TOPIC_LABELS: Record<SiteFaq['topic'], string> = {
  SIGN_IN: 'Signing in',
  SIGN_UP: 'Creating a workspace',
  BILLING: 'Plans and billing',
  SALES: 'Talking to sales',
  OTHER: 'Something else',
};

export interface SiteFaq {
  id: string;
  topic: 'SIGN_IN' | 'SIGN_UP' | 'BILLING' | 'SALES' | 'OTHER';
  question: string;
  answer: string;
  /** A page that solves it, with the button's label. */
  action?: { href: string; label: string };
  /** Extra words people search with. */
  keywords: string;
}

export const SITE_FAQS: SiteFaq[] = [
  {
    id: 'forgot-password',
    topic: 'SIGN_IN',
    question: 'I forgot my password. How do I get back in?',
    answer: 'Ask for a reset link with your work email. The link works once and expires after a short time. If you do not see the email, check your spam folder.',
    action: { href: '/forgot-password', label: 'Reset my password' },
    keywords: 'reset password lost locked out email link',
  },
  {
    id: 'sso',
    topic: 'SIGN_IN',
    question: 'My company uses single sign-on. How do I sign in?',
    answer: 'Choose Sign in with SSO and enter your work email or your company’s sign-in name. Your administrator sets single sign-on up in the workspace settings.',
    action: { href: '/login/sso', label: 'Sign in with SSO' },
    keywords: 'sso single sign-on okta azure google openid oidc',
  },
  {
    id: 'two-step',
    topic: 'SIGN_IN',
    question: 'I lost the phone with my authenticator app.',
    answer: 'Sign in with one of the recovery codes you saved when you turned on two-step verification. Each code works once. If you have none left, an administrator of your workspace can reset two-step verification for you.',
    keywords: '2fa mfa two-step verification authenticator recovery code phone',
  },
  {
    id: 'invite',
    topic: 'SIGN_IN',
    question: 'I was invited to a workspace. Where do I start?',
    answer: 'Open the invitation link in the email you received. It lets you choose a password and takes you straight into the right workspace. Invitations expire, so ask for a new one if yours is old.',
    keywords: 'invite invitation join team workspace link expired',
  },
  {
    id: 'free-plan',
    topic: 'SIGN_UP',
    question: 'Is there a free plan?',
    answer: 'Yes. The Free plan covers 2 users with no card required. You can move to a paid plan from Billing whenever you need more.',
    action: { href: '/pricing', label: 'See pricing' },
    keywords: 'free trial price cost card credit',
  },
  {
    id: 'what-you-need',
    topic: 'SIGN_UP',
    question: 'What do I need to create a workspace?',
    answer: 'Your name, your work email, a password of at least 10 characters with a letter and a number, and your organization’s name. It takes under a minute.',
    keywords: 'create account sign up register start workspace organization',
  },
  {
    id: 'ai-credits',
    topic: 'BILLING',
    question: 'How are AI features charged?',
    answer: 'AI features draw on each plan’s monthly AI credit allowance. When it is used up they pause until the next month; nothing is charged automatically.',
    keywords: 'ai credits copilot usage charge cost limit',
  },
  {
    id: 'data-safety',
    topic: 'OTHER',
    question: 'How is my data kept safe?',
    answer: 'Every workspace is isolated in the database, actions are recorded in an append-only audit log, and roles and permissions decide who sees what. The AI stays inside each person’s permissions and asks before it acts.',
    keywords: 'security privacy data safe isolation audit permissions gdpr',
  },
  {
    id: 'languages',
    topic: 'OTHER',
    question: 'Which languages does SampForce speak?',
    answer: 'English, Spanish, French, German and Arabic. Pick yours from the language menu at the top of the page; it is kept when you sign in.',
    keywords: 'language translate arabic spanish french german',
  },
  {
    id: 'talk-to-us',
    topic: 'SALES',
    question: 'Can I talk to someone about a larger team?',
    answer: 'Yes. Send us a message from the Message us tab with your team’s size and what you need, and we will write back by email.',
    keywords: 'sales enterprise demo contact talk team larger quote',
  },
];

/** Lower-case, without accents, so "réinitialiser" finds "reinitialiser". */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * The questions matching what was typed, best first. Each word must appear in the question, the answer or the
 * keywords (in English or in the reader's language); a match in the question counts most.
 */
export function searchSiteFaqs(query: string, translate: (s: string) => string = (s) => s): SiteFaq[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return SITE_FAQS;
  const scored = SITE_FAQS.map((f) => {
    const q = fold(`${f.question} ${translate(f.question)}`);
    const rest = fold(`${f.answer} ${translate(f.answer)} ${f.keywords}`);
    let score = 0;
    for (const w of words) {
      if (q.includes(w)) score += 3;
      else if (rest.includes(w)) score += 1;
      else return { f, score: -1 };
    }
    return { f, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.f);
}
