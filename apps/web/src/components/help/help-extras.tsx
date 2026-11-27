'use client';

import { HELP_CATEGORY_BY_ID, type HelpReader, restrictedGuides } from '@dealflow/help';
import { FEATURE_BY_KEY, type HelpSettingsView } from '@dealflow/types';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Label } from '@dealflow/ui';
import { Info, Lock, Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Textarea } from '@/components/crm/select';
import { useSaveHelpSettings } from '@/lib/help-content';
import { useT } from '@/lib/i18n';
import { ToneIcon } from './help-ui';

/** The Super Workspace's own note in Help, such as who to ask inside the company first. */
export function SupportNote({ note }: { note: string | null }) {
  const t = useT();
  if (!note) return null;
  return (
    <aside
      className="flex gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm"
      data-help-support-note
      aria-label={t('A note from your organisation')}
    >
      <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <div>
        <p className="font-semibold">{t('A note from your organisation')}</p>
        <p className="mt-1 whitespace-pre-line text-muted-foreground">{note}</p>
      </div>
    </aside>
  );
}

/**
 * Features the reader cannot use, and why: not in the plan or not handed to this workspace, not in their role, or
 * not used at their workspace level. They are never offered as available; this only says who can grant them.
 */
export function RestrictedFeatures({ reader }: { reader: HelpReader }) {
  const t = useT();
  const list = useMemo(() => restrictedGuides(reader), [reader]);
  if (!list.length) return null;
  const why = (r: (typeof list)[number]) =>
    r.reason === 'feature'
      ? t(
          '{feature} is not in your plan, or not given to this workspace. Your Super Workspace administrator can ask SampForce for it.',
          { feature: t.maybe(FEATURE_BY_KEY[r.feature!].label) },
        )
      : r.reason === 'permission'
        ? t(
            'Your role does not include it. A workspace administrator can change your role in Team.',
          )
        : t('It is used in another workspace level, such as the Super Workspace.');
  return (
    <section aria-labelledby="help-restricted" data-help-restricted>
      <details className="group rounded-2xl border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-4 marker:hidden [&::-webkit-details-marker]:hidden">
          <span
            className="grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground"
            aria-hidden
          >
            <Lock className="size-4" />
          </span>
          <span className="flex-1">
            <span id="help-restricted" className="block font-semibold">
              {t('Not available to you ({count})', { count: list.length })}
            </span>
            <span className="text-sm text-muted-foreground">
              {t('Why some features are missing, and who can give you access.')}
            </span>
          </span>
        </summary>
        <ul className="grid gap-2 border-t border-border p-4 sm:grid-cols-2">
          {list.map((r) => {
            const c = HELP_CATEGORY_BY_ID[r.guide.category];
            return (
              <li
                key={r.guide.id}
                className="flex gap-3 rounded-xl border border-border p-3"
                data-restricted={r.guide.id}
                data-reason={r.reason}
              >
                <ToneIcon icon={c.icon} tone={c.tone} size="sm" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t.maybe(r.guide.topic.title)}</span>
                  <span className="block text-xs text-muted-foreground">{why(r)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}

/** The Super Workspace's Help options: the Help icon, the "not available" list and a note. Support always stays on. */
export function HelpSettingsButton({ settings }: { settings: HelpSettingsView }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [menuVisible, setMenuVisible] = useState(settings.menuVisible);
  const [explainRestricted, setExplainRestricted] = useState(settings.explainRestricted);
  const [note, setNote] = useState(settings.supportNote ?? '');
  const save = useSaveHelpSettings();
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setMenuVisible(settings.menuVisible);
          setExplainRestricted(settings.explainRestricted);
          setNote(settings.supportNote ?? '');
          setOpen(true);
        }}
        data-help-settings
      >
        <Settings2 aria-hidden /> {t('Help settings')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto p-6" data-help-settings-dialog>
          <DialogTitle>{t('Help settings')}</DialogTitle>
          <DialogDescription>
            {t(
              'For everyone in your organisation. Raising and following queries always stays available.',
            )}
          </DialogDescription>
          <form
            className="mt-2 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(
                { menuVisible, explainRestricted, supportNote: note.trim() || null },
                { onSuccess: () => setOpen(false) },
              );
            }}
          >
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={menuVisible}
                onChange={(e) => setMenuVisible(e.target.checked)}
                data-setting="menuVisible"
              />
              <span>
                <span className="block font-medium">{t('Show the Help icon in the top bar')}</span>
                <span className="text-muted-foreground">
                  {t('When hidden, Help & support stays in the account menu.')}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={explainRestricted}
                onChange={(e) => setExplainRestricted(e.target.checked)}
                data-setting="explainRestricted"
              />
              <span>
                <span className="block font-medium">{t('Explain features people cannot use')}</span>
                <span className="text-muted-foreground">
                  {t('Lists them in Help with the reason and who can give access.')}
                </span>
              </span>
            </label>
            <div>
              <Label htmlFor="help-support-note">{t('Note for everyone in Help (optional)')}</Label>
              <Textarea
                id="help-support-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder={t('For example: for password resets, ask IT first.')}
              />
            </div>
            {save.error && (
              <p role="alert" className="text-sm text-critical">
                {(save.error as Error).message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={save.isPending} data-save-help-settings>
                {t('Save')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
