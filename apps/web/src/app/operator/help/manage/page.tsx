'use client';

import { allGuides, CONSOLE_FAQS, HELP_CATEGORIES, HELP_FAQS, type HelpText } from '@dealflow/help';
import {
  FEATURES,
  HELP_ARTICLE_KINDS,
  HELP_ARTICLE_STATUSES,
  HELP_AUDIENCES,
  HELP_BODY_MAX,
  HELP_LEVELS,
  HELP_SUMMARY_MAX,
  HELP_TITLE_MAX,
  type HelpArticleDetail,
  type HelpArticleInput,
  type HelpArticleKind,
  type HelpArticleRow,
  type HelpArticleStatus,
  type HelpCategoryEntryRow,
  type HelpContentAudience,
  type HelpLocalText,
  type OperatorTenantRow,
  SYSTEM_ROLES,
} from '@dealflow/types';
import { Badge, Button, Card, Input, Label, Skeleton } from '@dealflow/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Copy, Eye, FilePlus2, Pencil, Upload } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useMemo, useRef, useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { ArticleBody, formatHelpDate } from '@/components/help/article';
import { HELP_ICON_NAMES, ToneIcon } from '@/components/help/help-ui';
import { PageHeader } from '@/components/page-header';
import { api } from '@/lib/api';
import {
  useArchiveHelpCategory,
  useHelpArticle,
  useHelpArticleAction,
  useHelpArticles,
  useHelpCategories,
  useHelpFeedbackList,
  useHelpMedia,
  useReviewHelpFeedback,
  useSaveHelpArticle,
  useSaveHelpCategory,
  useUploadHelpMedia,
} from '@/lib/help-admin';
import { useOperator } from '../../operator-shell';

/*
 * Help management in the Console (ADR 0073): write and publish answers, guides and announcements, edit or hide the
 * built-in help, sort it into topics, add pictures and files, and read what readers said. Every operator reads;
 * only administrators change anything (the API enforces it too). Staff-only, so in English like the other Console
 * settings pages.
 */
export default function HelpManagePage() {
  return (
    <Suspense>
      <HelpManager />
    </Suspense>
  );
}

const TABS = ['articles', 'topics', 'files', 'feedback'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  articles: 'Articles',
  topics: 'Topics',
  files: 'Pictures & files',
  feedback: 'Feedback',
};
const LANGS = [
  ['en', 'English'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['ar', 'العربية'],
] as const;
type Lang = (typeof LANGS)[number][0];
const KIND_LABEL: Record<HelpArticleKind, string> = {
  FAQ: 'Question & answer',
  GUIDE: 'Guide',
  ANNOUNCEMENT: 'Announcement',
};
const STATUS_TONE: Record<HelpArticleStatus, 'warning' | 'success' | 'neutral'> = {
  DRAFT: 'warning',
  PUBLISHED: 'success',
  ARCHIVED: 'neutral',
};
const LEVEL_LABEL: Record<(typeof HELP_LEVELS)[number], string> = {
  SUPER: 'Super',
  MANAGER: 'Manager',
  EXECUTIVE: 'Executive',
};

function HelpManager() {
  const me = useOperator();
  const [tab, setTab] = useState<Tab>('articles');
  const admin = me.data?.role === 'ADMIN';
  if (!me.data) return <Skeleton className="h-96" />;
  return (
    <div data-help-manage>
      <PageHeader
        title="Manage Help"
        description="Write and publish answers, guides and announcements, edit or hide the built-in help, and read what readers said."
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Help management"
          className="flex flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1"
        >
          {TABS.map((x) => (
            <button
              key={x}
              type="button"
              role="tab"
              aria-selected={tab === x}
              onClick={() => setTab(x)}
              className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground aria-selected:bg-surface aria-selected:font-semibold aria-selected:text-foreground aria-selected:shadow-sm"
              data-manage-tab={x}
            >
              {TAB_LABEL[x]}
            </button>
          ))}
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/operator/help">
            <ArrowLeft className="rtl:rotate-180" aria-hidden /> Console Help
          </Link>
        </Button>
      </div>
      {!admin && (
        <p className="mb-4 rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Only Console administrators can change Help. You can read everything here.
        </p>
      )}
      {tab === 'articles' && <Articles admin={admin} />}
      {tab === 'topics' && <Topics admin={admin} />}
      {tab === 'files' && <Files admin={admin} />}
      {tab === 'feedback' && <Feedback />}
    </div>
  );
}

/* ───────────────────────── Articles ───────────────────────── */

/** The built-in answers and guides a Console article may edit or hide, with their text to start from. */
interface Builtin {
  key: string;
  audience: HelpContentAudience;
  kind: HelpArticleKind;
  categoryId: string;
  title: HelpLocalText;
  summary: HelpLocalText;
}

const local = (t: HelpText): HelpLocalText => ({
  en: t[0],
  es: t[1],
  fr: t[2],
  de: t[3],
  ar: t[4],
});
const CATEGORY_AUDIENCE = new Map(HELP_CATEGORIES.map((c) => [c.id as string, c.audience]));

function builtins(): Builtin[] {
  const faqs = [...HELP_FAQS, ...CONSOLE_FAQS].map((f) => ({
    key: `faq:${f.id}`,
    audience: CATEGORY_AUDIENCE.get(f.category) ?? 'workspace',
    kind: 'FAQ' as const,
    categoryId: f.category,
    title: local(f.q),
    summary: local(f.a),
  }));
  const guides = allGuides().map((g) => ({
    key: `guide:${g.id}`,
    audience: CATEGORY_AUDIENCE.get(g.category) ?? 'workspace',
    kind: 'GUIDE' as const,
    categoryId: g.category,
    title: { en: g.topic.title },
    summary: local(g.topic.what),
  }));
  return [...faqs, ...guides];
}

function Articles({ admin }: { admin: boolean }) {
  const [status, setStatus] = useState<HelpArticleStatus | ''>('');
  const [audience, setAudience] = useState<HelpContentAudience | ''>('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; from?: Builtin } | null>(null);
  const [builtinKey, setBuiltinKey] = useState('');
  const list = useHelpArticles(
    { status: status || undefined, audience: audience || undefined, q: q.trim() || undefined },
    true,
  );
  const all = useMemo(builtins, []);
  // A built-in answer already edited opens its article instead of starting a second one.
  const edited = new Map(
    (list.data ?? []).filter((a) => a.builtinKey).map((a) => [a.builtinKey!, a.id]),
  );

  if (editing)
    return (
      <Editor
        id={editing.id}
        from={editing.from}
        admin={admin}
        onClose={() => setEditing(null)}
        onCreated={(id) => setEditing({ id })}
      />
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <Label htmlFor="article-status">Status</Label>
          <Select
            id="article-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as HelpArticleStatus | '')}
          >
            <option value="">All</option>
            {HELP_ARTICLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0] + s.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Label htmlFor="article-audience">For</Label>
          <Select
            id="article-audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value as HelpContentAudience | '')}
          >
            <option value="">Everyone</option>
            <option value="workspace">Workspaces</option>
            <option value="console">The Console</option>
          </Select>
        </div>
        <div className="min-w-48 flex-1">
          <Label htmlFor="article-search">Search</Label>
          <Input
            id="article-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Title"
          />
        </div>
        {admin && (
          <Button onClick={() => setEditing({ id: null })} data-new-article>
            <FilePlus2 aria-hidden /> New article
          </Button>
        )}
      </div>
      {admin && (
        <Card className="flex flex-wrap items-end gap-2 p-4">
          <div className="min-w-64 flex-1">
            <Label htmlFor="builtin-pick">Edit or hide a built-in answer or guide</Label>
            <Select
              id="builtin-pick"
              value={builtinKey}
              onChange={(e) => setBuiltinKey(e.target.value)}
            >
              <option value="">Choose one…</option>
              {all.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.kind === 'FAQ' ? 'Q&A' : 'Guide'} ·{' '}
                  {b.audience === 'console' ? 'Console' : 'Workspaces'} · {b.title.en}
                  {edited.has(b.key) ? ' (edited)' : ''}
                </option>
              ))}
            </Select>
          </div>
          <Button
            variant="outline"
            disabled={!builtinKey}
            onClick={() =>
              setEditing(
                edited.has(builtinKey)
                  ? { id: edited.get(builtinKey)! }
                  : { id: null, from: all.find((b) => b.key === builtinKey) },
              )
            }
            data-edit-builtin
          >
            <Pencil aria-hidden /> Start editing
          </Button>
        </Card>
      )}
      <Card className="overflow-hidden">
        {list.isLoading ? (
          <Skeleton className="m-4 h-24" />
        ) : !list.data?.length ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No articles yet. Built-in help shows until you write or edit one.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {list.data.map((a) => (
              <ArticleRow key={a.id} a={a} onOpen={() => setEditing({ id: a.id })} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ArticleRow({ a, onOpen }: { a: HelpArticleRow; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-start hover:bg-muted/40"
        data-article-row={a.title.en}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{a.title.en}</span>
          <span className="text-xs text-muted-foreground">
            {KIND_LABEL[a.kind]} · {a.audience === 'console' ? 'Console' : 'Workspaces'} ·{' '}
            {a.builtinKey ? `Edits ${a.builtinKey}` : 'New'} · version {a.version} · updated{' '}
            {formatHelpDate(a.updatedAt)}
            {a.updatedBy ? ` by ${a.updatedBy}` : ''}
          </span>
        </span>
        <span className="text-xs text-muted-foreground" title="Views · helpful · not helpful">
          {a.stats.views} views · 👍 {a.stats.helpful} · 👎 {a.stats.notHelpful}
        </span>
        <Badge tone={STATUS_TONE[a.status]} data-article-status={a.status}>
          {a.status[0] + a.status.slice(1).toLowerCase()}
        </Badge>
      </button>
    </li>
  );
}

type Draft = {
  kind: HelpArticleKind;
  audience: HelpContentAudience;
  builtinKey: string | null;
  categoryId: string;
  title: HelpLocalText;
  summary: HelpLocalText;
  body: HelpLocalText;
  featureKey: string;
  levels: (typeof HELP_LEVELS)[number][];
  roleKeys: string;
  tenantIds: string[];
  videoUrl: string;
  pinned: boolean;
  note: string;
};

function draftFrom(a: HelpArticleDetail | undefined, from: Builtin | undefined): Draft {
  if (a)
    return {
      kind: a.kind,
      audience: a.audience,
      builtinKey: a.builtinKey,
      categoryId: a.categoryId,
      title: a.title,
      summary: a.summary,
      body: a.body,
      featureKey: a.featureKey ?? '',
      levels: a.levels as Draft['levels'],
      roleKeys: a.roleKeys.join(', '),
      tenantIds: a.tenantIds,
      videoUrl: a.videoUrl ?? '',
      pinned: a.pinned,
      note: '',
    };
  return {
    kind: from?.kind ?? 'FAQ',
    audience: from?.audience ?? 'workspace',
    builtinKey: from?.key ?? null,
    categoryId: from?.categoryId ?? '',
    title: from?.title ?? { en: '' },
    summary: from?.summary ?? { en: '' },
    body: { en: '' },
    featureKey: '',
    levels: [],
    roleKeys: '',
    tenantIds: [],
    videoUrl: '',
    pinned: false,
    note: '',
  };
}

function Editor({
  id,
  from,
  admin,
  onClose,
  onCreated,
}: {
  id: string | null;
  from?: Builtin;
  admin: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const article = useHelpArticle(id);
  // Kept here, so the message survives the form starting again from each new saved version.
  const [saved, setSaved] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  if (id && !article.data) return <Skeleton className="h-96" />;
  return (
    <EditorForm
      key={`${id}-${article.data?.version}`}
      article={article.data}
      from={from}
      admin={admin}
      onClose={onClose}
      onCreated={onCreated}
      saved={saved}
      setSaved={setSaved}
      preview={preview}
      setPreview={setPreview}
    />
  );
}

function EditorForm({
  article,
  from,
  admin,
  onClose,
  onCreated,
  saved,
  setSaved,
  preview,
  setPreview,
}: {
  article?: HelpArticleDetail;
  from?: Builtin;
  admin: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  saved: string | null;
  setSaved: (s: string | null) => void;
  preview: boolean;
  setPreview: (fn: (p: boolean) => boolean) => void;
}) {
  const [d, setD] = useState<Draft>(() => draftFrom(article, from));
  const [lang, setLang] = useState<Lang>('en');
  const body = useRef<HTMLTextAreaElement>(null);
  const save = useSaveHelpArticle();
  const act = useHelpArticleAction();
  const categories = useHelpCategories(true);
  const media = useHelpMedia(admin);
  const tenants = useQuery({
    queryKey: ['operator', 'tenants', ''],
    queryFn: () => api<OperatorTenantRow[]>('/operator/tenants'),
  });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setText = (field: 'title' | 'summary' | 'body', v: string) =>
    setD((x) => ({ ...x, [field]: { ...x[field], [lang]: v } }));
  const topics = [
    ...HELP_CATEGORIES.filter((c) => c.audience === d.audience).map((c) => ({
      id: c.id as string,
      title: c.title[0],
    })),
    ...(categories.data ?? [])
      .filter((c) => c.audience === d.audience && !c.archivedAt)
      .map((c) => ({ id: c.id, title: `${c.parentId ? '↳ ' : ''}${c.title.en}` })),
  ];
  const error = (save.error ?? act.error) as Error | null;
  const readOnly = !admin;

  const input = (): HelpArticleInput => ({
    kind: d.kind,
    audience: d.audience,
    builtinKey: d.builtinKey,
    categoryId: d.categoryId,
    title: d.title as HelpArticleInput['title'],
    summary: d.summary as HelpArticleInput['summary'],
    body: d.body as HelpArticleInput['body'],
    featureKey: (d.featureKey || null) as HelpArticleInput['featureKey'],
    levels: d.levels,
    roleKeys: d.roleKeys
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    tenantIds: d.tenantIds,
    videoUrl: d.videoUrl.trim() || null,
    pinned: d.pinned,
    note: d.note.trim() || undefined,
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(
      { id: article?.id ?? null, input: input() },
      {
        onSuccess: (a) => {
          setSaved(article ? `Saved as version ${a.version}.` : 'Draft saved.');
          if (!article) onCreated(a.id);
        },
      },
    );
  };
  const insertPicture = (markdown: string) => {
    const el = body.current;
    const current = d.body[lang] ?? '';
    const at = el?.selectionStart ?? current.length;
    setText(
      'body',
      `${current.slice(0, at)}${at && current[at - 1] !== '\n' ? '\n' : ''}${markdown}\n${current.slice(at)}`,
    );
  };

  return (
    <form
      onSubmit={submit}
      className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
      data-article-editor={article?.id ?? 'new'}
    >
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <ArrowLeft className="rtl:rotate-180" aria-hidden /> All articles
          </Button>
          <div className="flex items-center gap-2">
            {article && (
              <Badge tone={STATUS_TONE[article.status]} data-editor-status={article.status}>
                {article.status[0] + article.status.slice(1).toLowerCase()} · version{' '}
                {article.version}
              </Badge>
            )}
            <Button
              type="button"
              variant={preview ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPreview((p) => !p)}
              aria-pressed={preview}
              data-preview-toggle
            >
              <Eye aria-hidden /> Preview
            </Button>
          </div>
        </div>
        {d.builtinKey && (
          <p className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
            This replaces the built-in {d.builtinKey} once published. Archive it to hide the
            built-in one from readers.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="article-kind">Type</Label>
            <Select
              id="article-kind"
              value={d.kind}
              onChange={(e) => set('kind', e.target.value as HelpArticleKind)}
              disabled={readOnly || !!d.builtinKey}
            >
              {HELP_ARTICLE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="article-for">For</Label>
            <Select
              id="article-for"
              value={d.audience}
              onChange={(e) => (
                set('audience', e.target.value as HelpContentAudience),
                set('categoryId', '')
              )}
              disabled={readOnly || !!d.builtinKey}
            >
              {HELP_AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {a === 'console' ? 'The Console' : 'Workspaces'}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="article-topic">Topic</Label>
            <Select
              id="article-topic"
              value={d.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
              disabled={readOnly}
              required
            >
              <option value="">Choose a topic…</option>
              {topics.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <div role="tablist" aria-label="Language" className="mb-3 flex flex-wrap gap-1">
            {LANGS.map(([code, name]) => (
              <button
                key={code}
                type="button"
                role="tab"
                aria-selected={lang === code}
                onClick={() => setLang(code)}
                className="rounded-full border border-border px-3 py-1 text-xs aria-selected:border-primary aria-selected:bg-primary aria-selected:text-primary-foreground"
                data-lang-tab={code}
              >
                {name}
                {code !== 'en' && !d.title[code]?.trim() ? ' (uses English)' : ''}
              </button>
            ))}
          </div>
          <div className="space-y-3" dir={lang === 'ar' ? 'rtl' : undefined}>
            <div>
              <Label htmlFor="article-title">{d.kind === 'FAQ' ? 'Question' : 'Title'}</Label>
              <Input
                id="article-title"
                value={d.title[lang] ?? ''}
                onChange={(e) => setText('title', e.target.value)}
                maxLength={HELP_TITLE_MAX}
                required={lang === 'en'}
                readOnly={readOnly}
              />
            </div>
            <div>
              <Label htmlFor="article-summary">
                {d.kind === 'FAQ' ? 'Short answer' : 'Summary'}
              </Label>
              <Textarea
                id="article-summary"
                value={d.summary[lang] ?? ''}
                onChange={(e) => setText('summary', e.target.value)}
                maxLength={HELP_SUMMARY_MAX}
                rows={3}
                required={lang === 'en'}
                readOnly={readOnly}
              />
            </div>
            <div>
              <Label htmlFor="article-body">Full text (optional)</Label>
              <Textarea
                id="article-body"
                ref={body}
                value={d.body[lang] ?? ''}
                onChange={(e) => setText('body', e.target.value)}
                maxLength={HELP_BODY_MAX}
                rows={10}
                readOnly={readOnly}
                className="font-mono text-xs"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                “## ” starts a heading, “1. ” a numbered step, “- ” a bullet and “&gt; ” a tip. Add
                pictures from the list on the right.
              </p>
            </div>
          </div>
        </div>

        <fieldset className="space-y-3 rounded-xl border border-border p-4" disabled={readOnly}>
          <legend className="px-1 text-sm font-semibold">Who sees it</legend>
          <p className="text-xs text-muted-foreground">
            Leave a choice empty for everyone. Readers see an article only if they match every
            choice.
          </p>
          {d.audience === 'workspace' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="article-feature">Only with the feature</Label>
                  <Select
                    id="article-feature"
                    value={d.featureKey}
                    onChange={(e) => set('featureKey', e.target.value)}
                  >
                    <option value="">Any plan</option>
                    {FEATURES.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="article-roles">Only for roles</Label>
                  <Input
                    id="article-roles"
                    value={d.roleKeys}
                    onChange={(e) => set('roleKeys', e.target.value)}
                    placeholder={SYSTEM_ROLES.join(', ')}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-4" role="group" aria-label="Workspace levels">
                {HELP_LEVELS.map((l) => (
                  <label key={l} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={d.levels.includes(l)}
                      onChange={(e) =>
                        set(
                          'levels',
                          e.target.checked ? [...d.levels, l] : d.levels.filter((x) => x !== l),
                        )
                      }
                      data-level={l}
                    />
                    {LEVEL_LABEL[l]} Workspaces
                  </label>
                ))}
              </div>
              <div>
                <Label htmlFor="article-clients">Only for clients</Label>
                <Select
                  id="article-clients"
                  multiple
                  value={d.tenantIds}
                  onChange={(e) =>
                    set(
                      'tenantIds',
                      Array.from(e.target.selectedOptions).map((o) => o.value),
                    )
                  }
                  className="h-28 py-1"
                >
                  {(tenants.data ?? []).map((tn) => (
                    <option key={tn.id} value={tn.id}>
                      {tn.name}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Hold Ctrl or ⌘ to choose more than one.{' '}
                  {d.tenantIds.length
                    ? `${d.tenantIds.length} chosen.`
                    : 'None chosen: every client.'}
                </p>
              </div>
            </>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="article-video">Video link (https)</Label>
              <Input
                id="article-video"
                type="url"
                value={d.videoUrl}
                onChange={(e) => set('videoUrl', e.target.value)}
                placeholder="https://"
              />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                checked={d.pinned}
                onChange={(e) => set('pinned', e.target.checked)}
                data-pinned
              />{' '}
              Pin to the top of its topic
            </label>
          </div>
        </fieldset>

        {admin && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="article-note">What changed (kept with the version)</Label>
              <Input
                id="article-note"
                value={d.note}
                onChange={(e) => set('note', e.target.value)}
                maxLength={300}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-critical">
                {error.message}
              </p>
            )}
            {saved && !error && (
              <p role="status" className="text-sm text-success" data-article-saved>
                {saved}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={save.isPending} data-save-article>
                {article ? 'Save changes' : 'Save draft'}
              </Button>
              {article && article.status !== 'PUBLISHED' && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={act.isPending}
                  onClick={() =>
                    act.mutate(
                      { id: article.id, action: 'publish' },
                      { onSuccess: () => setSaved('Published. Readers see it now.') },
                    )
                  }
                  data-publish-article
                >
                  Publish
                </Button>
              )}
              {article?.status === 'PUBLISHED' && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={act.isPending}
                  onClick={() =>
                    act.mutate(
                      { id: article.id, action: 'unpublish' },
                      { onSuccess: () => setSaved('Back to draft. Readers no longer see it.') },
                    )
                  }
                >
                  Unpublish
                </Button>
              )}
              {article && article.status !== 'ARCHIVED' && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={act.isPending}
                  onClick={() =>
                    act.mutate(
                      { id: article.id, action: 'archive' },
                      {
                        onSuccess: () =>
                          setSaved(
                            article.builtinKey
                              ? 'Archived. The built-in one is hidden too.'
                              : 'Archived.',
                          ),
                      },
                    )
                  }
                  data-archive-article
                >
                  Archive{article.builtinKey ? ' and hide the built-in' : ''}
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      <div className="space-y-4">
        {preview && <Preview d={d} lang={lang} />}
        {admin && (
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">Add a picture</h3>
            {!media.data?.length ? (
              <p className="text-xs text-muted-foreground">
                Upload pictures in “Pictures & files” first.
              </p>
            ) : (
              <ul className="grid grid-cols-3 gap-2">
                {media.data
                  .filter((m) => m.contentType.startsWith('image/'))
                  .map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => insertPicture(m.markdown)}
                        className="block w-full overflow-hidden rounded-lg border border-border hover:border-primary"
                        title={m.name}
                        data-insert-media={m.name}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- Console's own upload */}
                        <img
                          src={`/api/v1/operator/help/media/${m.id}`}
                          alt={m.name}
                          className="aspect-video w-full object-cover"
                        />
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        )}
        {article && (
          <Card className="p-4" data-article-versions>
            <h3 className="mb-2 text-sm font-semibold">Version history</h3>
            <ol className="space-y-2">
              {article.versions.map((v) => (
                <li
                  key={v.version}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm"
                  data-version={v.version}
                >
                  <span>
                    <span className="font-medium">Version {v.version}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatHelpDate(v.createdAt)}
                      {v.operator ? ` · ${v.operator}` : ''}
                      {v.note ? ` · ${v.note}` : ''}
                    </span>
                  </span>
                  {admin && v.version !== article.version && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={act.isPending}
                      onClick={() =>
                        act.mutate(
                          { id: article.id, action: 'restore', version: v.version },
                          {
                            onSuccess: (a) =>
                              setSaved(`Restored version ${v.version} as version ${a.version}.`),
                          },
                        )
                      }
                      data-restore-version={v.version}
                    >
                      Restore
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
    </form>
  );
}

/** How readers will see it, in the chosen language (English where that language is empty). */
function Preview({ d, lang }: { d: Draft; lang: Lang }) {
  const text = (t: HelpLocalText) => (t[lang]?.trim() ? t[lang]! : t.en);
  return (
    <Card className="overflow-hidden" data-article-preview>
      <div className="border-b border-border bg-gradient-to-br from-primary/15 to-transparent p-4">
        <Badge tone="primary">{KIND_LABEL[d.kind]} preview</Badge>
        <h3 className="mt-2 text-lg font-semibold">{text(d.title) || 'Untitled'}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{text(d.summary)}</p>
      </div>
      <div className="space-y-3 p-4" dir={lang === 'ar' ? 'rtl' : undefined}>
        <ArticleBody body={text(d.body)} audience="console" />
        {d.videoUrl && <p className="text-sm text-primary">▶ {d.videoUrl}</p>}
      </div>
    </Card>
  );
}

/* ───────────────────────── Topics ───────────────────────── */

type TopicDraft = {
  id: string;
  parentId: string;
  audience: HelpContentAudience;
  title: string;
  description: string;
  icon: string;
  tone: number;
  sortOrder: number;
};
const EMPTY_TOPIC: TopicDraft = {
  id: '',
  parentId: '',
  audience: 'workspace',
  title: '',
  description: '',
  icon: 'book-open',
  tone: 1,
  sortOrder: 100,
};

function Topics({ admin }: { admin: boolean }) {
  const list = useHelpCategories(true);
  const save = useSaveHelpCategory();
  const archive = useArchiveHelpCategory();
  const [d, setD] = useState<TopicDraft>(EMPTY_TOPIC);
  const [existing, setExisting] = useState<HelpCategoryEntryRow | null>(null);
  const set = <K extends keyof TopicDraft>(k: K, v: TopicDraft[K]) =>
    setD((x) => ({ ...x, [k]: v }));
  const parents = [
    ...HELP_CATEGORIES.filter((c) => c.audience === d.audience).map((c) => ({
      id: c.id as string,
      title: c.title[0],
    })),
    ...(list.data ?? [])
      .filter((c) => c.audience === d.audience && !c.parentId && c.id !== d.id)
      .map((c) => ({ id: c.id, title: c.title.en })),
  ];
  const edit = (c: HelpCategoryEntryRow) => {
    setExisting(c);
    setD({
      id: c.id,
      parentId: c.parentId ?? '',
      audience: c.audience,
      title: c.title.en,
      description: c.description.en,
      icon: c.icon,
      tone: c.tone,
      sortOrder: c.sortOrder,
    });
  };
  const error = (save.error ?? archive.error) as Error | null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="overflow-hidden">
        <p className="border-b border-border p-4 text-sm text-muted-foreground">
          Built-in topics always show when they have help in them. Add your own topics, or subtopics
          under any topic.
        </p>
        {!list.data?.length ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No topics of your own yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {list.data.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
                data-topic-row={c.id}
              >
                <ToneIcon icon={c.icon} tone={c.tone} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {c.parentId ? `${c.parentId} › ` : ''}
                    {c.title.en}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {c.id} · {c.audience === 'console' ? 'Console' : 'Workspaces'} · order{' '}
                    {c.sortOrder}
                  </span>
                </span>
                {c.archivedAt && <Badge tone="neutral">Archived</Badge>}
                {admin && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => edit(c)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={archive.isPending}
                      onClick={() => archive.mutate({ id: c.id, archived: !c.archivedAt })}
                      data-topic-archive={c.id}
                    >
                      {c.archivedAt ? 'Restore' : 'Archive'}
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {admin && (
        <Card className="p-4">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const keep = existing && existing.id === d.id ? existing : null;
              save.mutate(
                {
                  id: d.id,
                  parentId: d.parentId || null,
                  audience: d.audience,
                  title: { ...(keep?.title ?? {}), en: d.title },
                  description: { ...(keep?.description ?? {}), en: d.description },
                  icon: d.icon,
                  tone: d.tone,
                  sortOrder: d.sortOrder,
                },
                { onSuccess: () => (setD(EMPTY_TOPIC), setExisting(null)) },
              );
            }}
            data-topic-form
          >
            <h3 className="text-sm font-semibold">
              {existing ? `Edit ${existing.id}` : 'New topic'}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="topic-id">Short name (letters, numbers, dashes)</Label>
                <Input
                  id="topic-id"
                  value={d.id}
                  onChange={(e) => set('id', e.target.value.toLowerCase())}
                  pattern="[a-z][a-z0-9-]{1,39}"
                  required
                  readOnly={!!existing}
                />
              </div>
              <div>
                <Label htmlFor="topic-for">For</Label>
                <Select
                  id="topic-for"
                  value={d.audience}
                  onChange={(e) => (
                    set('audience', e.target.value as HelpContentAudience),
                    set('parentId', '')
                  )}
                >
                  <option value="workspace">Workspaces</option>
                  <option value="console">The Console</option>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="topic-title">Title</Label>
              <Input
                id="topic-title"
                value={d.title}
                onChange={(e) => set('title', e.target.value)}
                maxLength={80}
                required
              />
            </div>
            <div>
              <Label htmlFor="topic-description">Description</Label>
              <Input
                id="topic-description"
                value={d.description}
                onChange={(e) => set('description', e.target.value)}
                maxLength={300}
              />
            </div>
            <div>
              <Label htmlFor="topic-parent">Under topic (makes it a subtopic)</Label>
              <Select
                id="topic-parent"
                value={d.parentId}
                onChange={(e) => set('parentId', e.target.value)}
              >
                <option value="">None: a topic of its own</option>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="topic-icon">Icon</Label>
                <Select
                  id="topic-icon"
                  value={d.icon}
                  onChange={(e) => set('icon', e.target.value)}
                >
                  {HELP_ICON_NAMES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="topic-tone">Colour</Label>
                <Select
                  id="topic-tone"
                  value={d.tone}
                  onChange={(e) => set('tone', Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="topic-order">Order</Label>
                <Input
                  id="topic-order"
                  type="number"
                  min={0}
                  max={10000}
                  value={d.sortOrder}
                  onChange={(e) => set('sortOrder', Number(e.target.value))}
                />
              </div>
            </div>
            {error && (
              <p role="alert" className="text-sm text-critical">
                {error.message}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={save.isPending} data-save-topic>
                Save topic
              </Button>
              {existing && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => (setD(EMPTY_TOPIC), setExisting(null))}
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

/* ───────────────────────── Files ───────────────────────── */

function Files({ admin }: { admin: boolean }) {
  const list = useHelpMedia(true);
  const upload = useUploadHelpMedia();
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {admin && (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,application/pdf"
            className="sr-only"
            aria-label="Upload a picture, video or PDF"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = '';
            }}
            data-help-media-input
          />
          <Button type="button" onClick={() => input.current?.click()} disabled={upload.isPending}>
            <Upload aria-hidden /> Upload
          </Button>
          <span className="text-xs text-muted-foreground">
            Pictures (PNG, JPEG, GIF, WebP), videos (MP4, WebM) or PDFs, up to 10 MB.
          </span>
          {upload.error && (
            <p role="alert" className="w-full text-sm text-critical">
              {(upload.error as Error).message}
            </p>
          )}
        </Card>
      )}
      <Card className="overflow-hidden">
        {!list.data?.length ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Nothing uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.data.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
                data-help-media={m.name}
              >
                {m.contentType.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Console's own upload
                  <img
                    src={`/api/v1/operator/help/media/${m.id}`}
                    alt=""
                    className="size-12 rounded-md border border-border object-cover"
                  />
                ) : (
                  <span className="grid size-12 place-items-center rounded-md border border-border text-xs text-muted-foreground">
                    {m.contentType.split('/')[1]}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <a
                    href={`/api/v1/operator/help/media/${m.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate font-medium hover:underline"
                  >
                    {m.name}
                  </a>
                  <code className="text-xs text-muted-foreground">{m.markdown}</code>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard?.writeText(m.markdown).catch(() => undefined);
                    setCopied(m.id);
                  }}
                >
                  <Copy aria-hidden /> {copied === m.id ? 'Copied' : 'Copy for an article'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ───────────────────────── Feedback ───────────────────────── */

function Feedback() {
  const [show, setShow] = useState<'open' | 'unhelpful' | 'all'>('open');
  const list = useHelpFeedbackList(
    show === 'open' ? { open: true } : show === 'unhelpful' ? { helpful: false } : {},
    true,
  );
  const review = useReviewHelpFeedback();
  const titles = useMemo(() => new Map(builtins().map((b) => [b.key, b.title.en])), []);
  const articles = useHelpArticles({}, true);
  const titleOf = (key: string) =>
    titles.get(key) ?? articles.data?.find((a) => a.key === key)?.title.en ?? key;
  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Feedback filter"
        className="flex w-fit gap-1 rounded-xl border border-border bg-muted/40 p-1"
      >
        {(
          [
            ['open', 'To review'],
            ['unhelpful', 'Not helpful'],
            ['all', 'All'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={show === k}
            onClick={() => setShow(k)}
            className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground aria-selected:bg-surface aria-selected:font-semibold aria-selected:text-foreground"
            data-feedback-filter={k}
          >
            {label}
          </button>
        ))}
      </div>
      <Card className="overflow-hidden">
        {list.isLoading ? (
          <Skeleton className="m-4 h-24" />
        ) : !list.data?.length ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No feedback here.</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.data.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-start gap-3 px-4 py-3"
                data-feedback-row={f.articleKey}
              >
                <Badge tone={f.helpful ? 'success' : 'critical'}>
                  {f.helpful ? 'Helpful' : 'Not helpful'}
                </Badge>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{titleOf(f.articleKey)}</span>
                  {f.comment && <span className="mt-1 block text-sm">“{f.comment}”</span>}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {f.person} · {f.tenant.name} · {formatHelpDate(f.createdAt)}
                    {f.reviewedAt ? ` · reviewed ${formatHelpDate(f.reviewedAt)}` : ''}
                  </span>
                </span>
                {!f.reviewedAt && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={review.isPending}
                    onClick={() => review.mutate(f.id)}
                    data-review-feedback
                  >
                    Mark as reviewed
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
