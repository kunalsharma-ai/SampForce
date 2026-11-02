'use client';

import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Button, cn, Input } from '@dealflow/ui';
import {
  EMAIL_BLOCK_LABELS,
  EMAIL_BLOCK_TYPES,
  renderEmailDesign,
  SOCIAL_NETWORKS,
  type EmailBlock,
  type EmailBlockType,
  type EmailDesign,
  type EmailTheme,
  type SocialNetwork,
} from '@dealflow/types';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  Heading,
  Image as ImageIcon,
  Minus,
  Monitor,
  MousePointerClick,
  Package,
  PanelBottom,
  PanelTop,
  PenLine,
  Plus,
  Share2,
  Smartphone,
  Table2,
  Trash2,
  Type,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { insertAt, MergeFieldBar } from '@/app/app/sequences/merge-fields';
import { Select, Textarea } from '@/components/crm/select';
import { Field } from '@/components/revenue/tabs';
import { inSentence, type Translator, useT } from '@/lib/i18n';
import {
  addBlock,
  applyDrop,
  blockSummary,
  duplicateBlock,
  moveBlock,
  removeBlock,
  updateBlock,
  type DropTarget,
} from './design-model';

const ICONS: Record<EmailBlockType, LucideIcon> = {
  header: PanelTop,
  heading: Heading,
  text: Type,
  image: ImageIcon,
  button: MousePointerClick,
  divider: Minus,
  social: Share2,
  signature: PenLine,
  product: Package,
  pricing: Table2,
  footer: PanelBottom,
};

/**
 * Pointer drops go to the gap under the pointer; keyboard drags fall back to overlap. A dragged block is never its own
 * target: it moves with the pointer, so it would always be under it.
 */
/** A block type's name in the reader's language. */
const blockName = (t: Translator, type: EmailBlockType) => t.maybe(EMAIL_BLOCK_LABELS[type]);

const collision: CollisionDetection = (args) => {
  const own = `before:${String(args.active.id).replace(/^block:/, '')}`;
  const others = { ...args, droppableContainers: args.droppableContainers.filter((c) => c.id !== own) };
  const hits = pointerWithin(others);
  return hits.length ? hits : rectIntersection(others);
};

/**
 * The email template designer (ADR 0050): a palette of blocks, the email's outline (drag to reorder, or use the
 * move buttons), settings for the selected block and the theme, and a live preview at desktop and phone width.
 * The preview is the same HTML a sequence sends, with merge fields shown as typed.
 */
export function EmailDesigner({
  value,
  onChange,
  idBase = 'design',
  error,
}: {
  value: EmailDesign;
  onChange: (d: EmailDesign) => void;
  idBase?: string;
  error?: string | null;
}) {
  const t = useT();
  const name = (type: EmailBlockType) => inSentence(t, blockName(t, type));
  const [selected, setSelected] = useState<string | null>(value.blocks[0]?.id ?? null);
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop');
  const [notice, setNotice] = useState('');
  /** The text box the merge-field buttons insert into. */
  const lastField = useRef<{
    blockId: string;
    key: string;
    el: HTMLInputElement | HTMLTextAreaElement;
  } | null>(null);
  const block = value.blocks.find((b) => b.id === selected) ?? null;
  const html = useMemo(() => renderEmailDesign(value, { keepTags: true, draft: true }).html, [value]);
  const label = (id: string | number) => {
    const s = String(id);
    if (s.startsWith('new:')) return t('New {block} block', { block: name(s.slice(4) as EmailBlockType) });
    const b = value.blocks.find((x) => `block:${x.id}` === s);
    return b ? t('{block} block', { block: blockName(t, b.type) }) : t('Block');
  };
  const where = (id: string | number | undefined) => {
    const s = String(id ?? '');
    if (s === 'end') return t('the end of the email');
    const i = value.blocks.findIndex((b) => `before:${b.id}` === s);
    return i >= 0
      ? t('position {n}, before the {block}', { n: i + 1, block: name(value.blocks[i]!.type) })
      : t('nowhere');
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t('Picked up {block}. Use the arrow keys to move, space to drop, escape to cancel.', { block: label(active.id) }),
    onDragOver: ({ active, over }) => t('{block} is over {where}.', { block: label(active.id), where: where(over?.id) }),
    onDragEnd: ({ active, over }) =>
      over
        ? t('{block} dropped at {where}.', { block: label(active.id), where: where(over.id) })
        : t('{block} was not dropped.', { block: label(active.id) }),
    onDragCancel: ({ active }) => t('Moving {block} was cancelled.', { block: label(active.id) }),
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const select = (id: string, message?: string) => {
    setSelected(id);
    if (message) setNotice(message);
  };
  const add = (type: EmailBlockType) => {
    const at = selected
      ? value.blocks.findIndex((b) => b.id === selected) + 1
      : value.blocks.length;
    const r = addBlock(value, type, at, (english) => t.maybe(english));
    onChange(r.design);
    select(r.id, t('Added a {block} block at position {n}.', { block: name(type), n: at + 1 }));
  };
  const move = (id: string, by: -1 | 1) => {
    const i = value.blocks.findIndex((b) => b.id === id);
    const to = i + by;
    if (to < 0 || to >= value.blocks.length) return;
    onChange(moveBlock(value, i, to));
    setNotice(t('Moved the {block} block to position {n}.', { block: name(value.blocks[i]!.type), n: to + 1 }));
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const a = String(e.active.id);
    const o = String(e.over.id);
    const target: DropTarget = o === 'end' ? { end: true } : { before: o.slice('before:'.length) };
    const r = applyDrop(
      value,
      a.startsWith('new:')
        ? { type: a.slice(4) as EmailBlockType }
        : { block: a.slice('block:'.length) },
      target,
    );
    if (!r) return;
    onChange(r.design);
    select(r.id);
  };
  const patch = (p: Partial<EmailBlock>) => block && onChange(updateBlock(value, block.id, p));
  const insertTag = (tag: string) => {
    const f = lastField.current;
    const b = f && value.blocks.find((x) => x.id === f.blockId);
    if (!f || !b || !f.el.isConnected) {
      setNotice(t('Click into a text box in the block settings first, then choose a field.'));
      return;
    }
    const current = String((b as Record<string, unknown>)[f.key] ?? '');
    onChange(
      updateBlock(value, b.id, { [f.key]: insertAt(f.el, current, tag) } as Partial<EmailBlock>),
    );
  };
  const track = (key: string) => ({
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (block) lastField.current = { blockId: block.id, key, el: e.currentTarget };
    },
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <p className="sr-only" aria-live="polite">
          {notice}
        </p>
        <p id={`${idBase}-dnd-help`} className="sr-only">
          {t('Drag with the handle, or focus it and press space, use the arrow keys, then space to drop. Each block also has move up and move down buttons.')}
        </p>
        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          onDragEnd={onDragEnd}
          accessibility={{ announcements, screenReaderInstructions: { draggable: '' } }}
        >
          <section aria-labelledby={`${idBase}-palette`} className="space-y-2">
            <h3 id={`${idBase}-palette`} className="text-sm font-semibold">
              {t('Add a block')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('Drag a block into the email, or click it to add it after the selected block.')}
            </p>
            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" aria-label={t('Blocks you can add')}>
              {EMAIL_BLOCK_TYPES.map((type) => (
                <PaletteItem
                  key={type}
                  type={type}
                  onAdd={() => add(type)}
                  help={`${idBase}-dnd-help`}
                />
              ))}
            </ul>
          </section>
          <section aria-labelledby={`${idBase}-outline`} className="space-y-2">
            <h3 id={`${idBase}-outline`} className="text-sm font-semibold">
              {t('Email layout')}
            </h3>
            <ol className="space-y-1" aria-label={t('Email blocks')}>
              {value.blocks.map((b, i) => (
                <OutlineItem
                  key={b.id}
                  block={b}
                  index={i}
                  count={value.blocks.length}
                  selected={b.id === selected}
                  help={`${idBase}-dnd-help`}
                  onSelect={() => select(b.id)}
                  onMove={(by) => move(b.id, by)}
                  onDuplicate={() => {
                    const r = duplicateBlock(value, b.id);
                    onChange(r.design);
                    select(r.id, t('Duplicated the {block} block.', { block: name(b.type) }));
                  }}
                  onRemove={() => {
                    if (value.blocks.length === 1) {
                      setNotice(t('An email needs at least one block.'));
                      return;
                    }
                    const next = value.blocks[i + 1] ?? value.blocks[i - 1];
                    onChange(removeBlock(value, b.id));
                    select(next!.id, t('Removed the {block} block.', { block: name(b.type) }));
                  }}
                />
              ))}
              <EndZone />
            </ol>
          </section>
        </DndContext>
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        )}
        {block && (
          <section
            aria-labelledby={`${idBase}-settings`}
            className="space-y-3 rounded-lg border border-border p-3"
          >
            <h3 id={`${idBase}-settings`} className="text-sm font-semibold">
              {t('{block} settings', { block: blockName(t, block.type) })}
            </h3>
            <BlockSettings
              key={block.id}
              block={block}
              idBase={`${idBase}-${block.id}`}
              patch={patch}
              track={track}
            />
            {[
              'header',
              'heading',
              'text',
              'button',
              'signature',
              'product',
              'pricing',
              'footer',
              'image',
            ].includes(block.type) && (
              <MergeFieldBar idBase={`${idBase}-mf`} onInsert={insertTag} />
            )}
          </section>
        )}
        <ThemeSettings
          idBase={idBase}
          theme={value.theme}
          onChange={(theme) => onChange({ ...value, theme })}
        />
      </div>
      <section aria-labelledby={`${idBase}-preview`} className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${idBase}-preview`} className="text-sm font-semibold">
            {t('Preview')}
          </h3>
          <div
            className="inline-flex rounded-md border border-border p-0.5"
            role="group"
            aria-label={t('Preview width')}
          >
            {(
              [
                ['desktop', t('Desktop'), Monitor],
                ['mobile', t('Phone'), Smartphone],
              ] as const
            ).map(([key, name, Icon]) => (
              <button
                key={key}
                type="button"
                aria-pressed={width === key}
                onClick={() => setWidth(key)}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium',
                  width === key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <Icon className="size-3.5" aria-hidden /> {name}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('Merge fields show as typed here. Use “Preview for a lead” below to see them filled in.')}
        </p>
        <div className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-2">
          <iframe
            title={
              width === 'desktop'
                ? t('Email preview at desktop width')
                : t('Email preview at phone width')
            }
            srcDoc={html}
            sandbox=""
            className="mx-auto block h-[640px] rounded bg-white"
            style={{
              width: width === 'desktop' ? '100%' : 375,
              minWidth: width === 'desktop' ? 480 : 375,
              maxWidth: 680,
            }}
          />
        </div>
      </section>
    </div>
  );
}

function PaletteItem({
  type,
  onAdd,
  help,
}: {
  type: EmailBlockType;
  onAdd: () => void;
  help: string;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `new:${type}`,
  });
  const Icon = ICONS[type];
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        'flex items-stretch rounded-md border border-border bg-surface',
        isDragging && 'relative z-10 shadow-lg ring-2 ring-primary',
      )}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        aria-describedby={help}
        aria-label={t('Drag a {block} block into the email', { block: inSentence(t, blockName(t, type)) })}
        className="grid min-w-6 cursor-grab touch-none place-items-center rounded-s-md px-1.5 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onAdd}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-e-md px-2 py-1.5 text-start text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-3.5 shrink-0 text-primary" aria-hidden />
        <span className="truncate">{blockName(t, type)}</span>
        <Plus className="ms-auto size-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">{t('(add)')}</span>
      </button>
    </li>
  );
}

function OutlineItem({
  block,
  index,
  count,
  selected,
  help,
  onSelect,
  onMove,
  onDuplicate,
  onRemove,
}: {
  block: EmailBlock;
  index: number;
  count: number;
  selected: boolean;
  help: string;
  onSelect: () => void;
  onMove: (by: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const drag = useDraggable({ id: `block:${block.id}` });
  const drop = useDroppable({ id: `before:${block.id}` });
  const Icon = ICONS[block.type];
  const name = blockName(t, block.type);
  const pos = t('{block} block {n}', { block: name, n: index + 1 });
  return (
    <li
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      style={{ transform: CSS.Translate.toString(drag.transform) }}
      className={cn(
        'relative flex items-center gap-1 rounded-md border bg-surface p-1 text-sm',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border',
        drag.isDragging && 'z-10 shadow-lg ring-2 ring-primary',
        drop.isOver &&
          !drag.isDragging &&
          'before:absolute before:inset-x-0 before:-top-1 before:h-0.5 before:rounded before:bg-primary',
      )}
    >
      <button
        type="button"
        ref={drag.setActivatorNodeRef}
        {...drag.listeners}
        {...drag.attributes}
        aria-describedby={help}
        aria-label={t('Drag {block}', { block: pos })}
        className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="shrink-0 font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{blockSummary(block, (text, vars) => t(text, vars))}</span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        aria-label={t('Move {block} up', { block: pos })}
      >
        <ArrowUp aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
        aria-label={t('Move {block} down', { block: pos })}
      >
        <ArrowDown aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={onDuplicate}
        aria-label={t('Duplicate {block}', { block: pos })}
      >
        <Copy aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={count === 1}
        onClick={onRemove}
        aria-label={t('Remove {block}', { block: pos })}
      >
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}

function EndZone() {
  const t = useT();
  const { setNodeRef, isOver } = useDroppable({ id: 'end' });
  return (
    <li
      ref={setNodeRef}
      className={cn(
        'rounded-md border border-dashed px-2 py-2 text-center text-xs text-muted-foreground',
        isOver ? 'border-primary bg-primary/10 text-foreground' : 'border-border',
      )}
    >
      {t('Drop here to add at the end')}
    </li>
  );
}

type Track = (key: string) => {
  onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
};

function BlockSettings({
  block: b,
  idBase,
  patch,
  track,
}: {
  block: EmailBlock;
  idBase: string;
  patch: (p: Partial<EmailBlock>) => void;
  track: Track;
}) {
  const t = useT();
  const id = (k: string) => `${idBase}-${k}`;
  const text = (
    key: string,
    label: string,
    opts: { hint?: string; max?: number; area?: boolean; rows?: number; type?: string } = {},
  ) => {
    const value = String((b as Record<string, unknown>)[key] ?? '');
    const common = {
      id: id(key),
      value,
      maxLength: opts.max,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        patch({ [key]: e.target.value } as Partial<EmailBlock>),
      ...track(key),
    };
    return (
      <Field id={id(key)} label={label} hint={opts.hint}>
        {opts.area ? (
          <Textarea {...common} rows={opts.rows ?? 5} />
        ) : (
          <Input {...common} type={opts.type ?? 'text'} />
        )}
      </Field>
    );
  };
  const alignField = (
    options: readonly ('left' | 'center' | 'right')[] = ['left', 'center', 'right'],
  ) =>
    'align' in b ? (
      <Field id={id('align')} label={t('Alignment')}>
        <Select
          id={id('align')}
          value={b.align}
          onChange={(e) => patch({ align: e.target.value } as Partial<EmailBlock>)}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o === 'left' ? t('Left') : o === 'center' ? t('Centre') : t('Right')}
            </option>
          ))}
        </Select>
      </Field>
    ) : null;
  const LINK_HINT = t('A full link starting with https://, or a merge field such as {example}.', { example: '{{var.booking_link}}' });
  const IMAGE_HINT = t('A public image link starting with https://. Email apps do not show images from other places.');
  const optional = (hint: string) => t('Optional. {hint}', { hint });

  switch (b.type) {
    case 'header':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {text('title', t('Title'), { max: 120 })}
          {text('logoUrl', t('Logo image link'), { hint: IMAGE_HINT, max: 1000, type: 'url' })}
          {alignField()}
        </div>
      );
    case 'heading':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {text('text', t('Heading'), { max: 200 })}
          <Field id={id('level')} label={t('Size')}>
            <Select
              id={id('level')}
              value={String(b.level)}
              onChange={(e) => patch({ level: Number(e.target.value) as 1 | 2 })}
            >
              <option value="1">{t('Large')}</option>
              <option value="2">{t('Medium')}</option>
            </Select>
          </Field>
          {alignField()}
        </div>
      );
    case 'text':
      return (
        <div className="space-y-3">
          {text('text', t('Text'), {
            area: true,
            rows: 7,
            max: 5000,
            hint: t('A blank line starts a new paragraph. Links become clickable.'),
          })}
          {alignField()}
        </div>
      );
    case 'image':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {text('src', t('Image link'), { hint: IMAGE_HINT, max: 1000, type: 'url' })}
          {text('alt', t('Description'), {
            hint: t('Read aloud by screen readers and shown when images are off.'),
            max: 200,
          })}
          {text('href', t('Opens this link when clicked'), {
            hint: optional(LINK_HINT),
            max: 1000,
          })}
          <Field id={id('width')} label={t('Width: {width}%', { width: b.width })}>
            <input
              id={id('width')}
              type="range"
              min={20}
              max={100}
              step={5}
              value={b.width}
              onChange={(e) => patch({ width: Number(e.target.value) })}
              className="w-full accent-[hsl(var(--primary))]"
            />
          </Field>
          {alignField()}
        </div>
      );
    case 'button':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {text('label', t('Button text'), { max: 80 })}
          {text('url', t('Link'), { hint: LINK_HINT, max: 1000 })}
          {alignField()}
        </div>
      );
    case 'divider':
      return (
        <p className="text-sm text-muted-foreground">
          {t('A thin line between sections. It has no settings.')}
        </p>
      );
    case 'social':
      return <SocialSettings block={b} idBase={idBase} patch={patch} />;
    case 'signature':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {text('name', t('Name'), { max: 120 })}
          {text('title', t('Job title'), { max: 120 })}
          {text('phone', t('Phone'), { max: 60 })}
          {text('email', t('Email'), { max: 200 })}
          {text('website', t('Website'), {
            hint: optional(t('A full link starting with https://.')),
            max: 1000,
          })}
        </div>
      );
    case 'product':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {text('name', t('Product or service'), { max: 120 })}
          {text('price', t('Price'), {
            hint: t('As you want it shown, for example $8 per complete.'),
            max: 60,
          })}
          <div className="sm:col-span-2">
            {text('description', t('Description'), { area: true, rows: 3, max: 1000 })}
          </div>
          {text('imageUrl', t('Image link'), {
            hint: optional(IMAGE_HINT),
            max: 1000,
            type: 'url',
          })}
          {text('url', t('Link'), { hint: optional(LINK_HINT), max: 1000 })}
          {text('buttonLabel', t('Button text'), { max: 60 })}
        </div>
      );
    case 'pricing':
      return <PricingSettings block={b} idBase={idBase} patch={patch} track={track} />;
    case 'footer':
      return text('text', t('Footer text'), {
        area: true,
        rows: 3,
        max: 1000,
        hint: t('Your address or why people get this email. Sequence emails also add an unsubscribe line.'),
      });
  }
}

function SocialSettings({
  block,
  idBase,
  patch,
}: {
  block: Extract<EmailBlock, { type: 'social' }>;
  idBase: string;
  patch: (p: Partial<EmailBlock>) => void;
}) {
  const t = useT();
  const network = (n: SocialNetwork) => t.maybe(SOCIAL_NETWORKS[n]);
  const set = (links: typeof block.links) => patch({ links } as Partial<EmailBlock>);
  const unused = (Object.keys(SOCIAL_NETWORKS) as SocialNetwork[]).filter(
    (n) => !block.links.some((l) => l.network === n),
  );
  return (
    <div className="space-y-2">
      {block.links.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t('No links yet. Add the profiles you want people to find.')}
        </p>
      )}
      <ul className="space-y-2" aria-label={t('Social links')}>
        {block.links.map((l, i) => (
          <li key={l.network} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor={`${idBase}-social-${l.network}`} className="text-xs font-medium">
                {t('{network} link', { network: network(l.network) })}
              </label>
              <Input
                id={`${idBase}-social-${l.network}`}
                type="url"
                value={l.url}
                maxLength={1000}
                placeholder="https://"
                onChange={(e) =>
                  set(block.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                }
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => set(block.links.filter((_, j) => j !== i))}
              aria-label={t('Remove the {network} link', { network: network(l.network) })}
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      {unused.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">{t('Add:')}</span>
          {unused.map((n) => (
            <Button
              key={n}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => set([...block.links, { network: n, url: '' }])}
            >
              {network(n)}
            </Button>
          ))}
        </div>
      )}
      <Field id={`${idBase}-align`} label={t('Alignment')}>
        <Select
          id={`${idBase}-align`}
          value={block.align}
          onChange={(e) => patch({ align: e.target.value } as Partial<EmailBlock>)}
        >
          <option value="left">{t('Left')}</option>
          <option value="center">{t('Centre')}</option>
          <option value="right">{t('Right')}</option>
        </Select>
      </Field>
    </div>
  );
}

function PricingSettings({
  block,
  idBase,
  patch,
  track,
}: {
  block: Extract<EmailBlock, { type: 'pricing' }>;
  idBase: string;
  patch: (p: Partial<EmailBlock>) => void;
  track: Track;
}) {
  const t = useT();
  const setRows = (rows: typeof block.rows) => patch({ rows } as Partial<EmailBlock>);
  return (
    <div className="space-y-3">
      <Field id={`${idBase}-title`} label={t('Title')}>
        <Input
          id={`${idBase}-title`}
          value={block.title}
          maxLength={120}
          onChange={(e) => patch({ title: e.target.value } as Partial<EmailBlock>)}
          {...track('title')}
        />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('Rows')}</legend>
        {block.rows.map((r, i) => (
          <div
            key={i}
            className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_8rem_auto]"
          >
            <div>
              <label htmlFor={`${idBase}-row${i}-label`} className="text-xs font-medium">
                {t('Row {n} item', { n: i + 1 })}
              </label>
              <Input
                id={`${idBase}-row${i}-label`}
                value={r.label}
                maxLength={120}
                onChange={(e) =>
                  setRows(block.rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                }
              />
            </div>
            <div>
              <label htmlFor={`${idBase}-row${i}-price`} className="text-xs font-medium">
                {t('Row {n} price', { n: i + 1 })}
              </label>
              <Input
                id={`${idBase}-row${i}-price`}
                value={r.price}
                maxLength={60}
                onChange={(e) =>
                  setRows(block.rows.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))
                }
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="self-end"
              disabled={block.rows.length === 1}
              onClick={() => setRows(block.rows.filter((_, j) => j !== i))}
              aria-label={t('Remove row {n}', { n: i + 1 })}
            >
              <Trash2 aria-hidden />
            </Button>
            <div className="sm:col-span-3">
              <label htmlFor={`${idBase}-row${i}-note`} className="text-xs font-medium">
                {t('Row {n} note', { n: i + 1 })}
              </label>
              <Input
                id={`${idBase}-row${i}-note`}
                value={r.note}
                maxLength={200}
                placeholder={t('Optional')}
                onChange={(e) =>
                  setRows(block.rows.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))
                }
              />
            </div>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={block.rows.length >= 12}
          onClick={() => setRows([...block.rows, { label: '', price: '', note: '' }])}
        >
          <Plus aria-hidden /> {t('Add a row')}
        </Button>
      </fieldset>
      <Field id={`${idBase}-footnote`} label={t('Note under the table')}>
        <Input
          id={`${idBase}-footnote`}
          value={block.footnote}
          maxLength={500}
          placeholder={t('Optional, for example: Prices exclude tax.')}
          onChange={(e) => patch({ footnote: e.target.value } as Partial<EmailBlock>)}
          {...track('footnote')}
        />
      </Field>
    </div>
  );
}

function ThemeSettings({
  idBase,
  theme,
  onChange,
}: {
  idBase: string;
  theme: EmailTheme;
  onChange: (t: EmailTheme) => void;
}) {
  const t = useT();
  const colours = [
    ['accent', t('Accent (header, buttons, links)')],
    ['text', t('Text')],
    ['surface', t('Email background')],
    ['background', t('Page background')],
  ] as const;
  return (
    <section
      aria-labelledby={`${idBase}-theme`}
      className="space-y-3 rounded-lg border border-border p-3"
    >
      <h3 id={`${idBase}-theme`} className="text-sm font-semibold">
        {t('Look')}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {colours.map(([key, name]) => (
          <div key={key} className="flex items-center gap-2">
            <input
              id={`${idBase}-theme-${key}`}
              type="color"
              value={theme[key]}
              onChange={(e) => onChange({ ...theme, [key]: e.target.value })}
              className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
            />
            <label htmlFor={`${idBase}-theme-${key}`} className="text-sm">
              {name} <span className="font-mono text-xs text-muted-foreground">{theme[key]}</span>
            </label>
          </div>
        ))}
        <Field id={`${idBase}-theme-font`} label={t('Font')}>
          <Select
            id={`${idBase}-theme-font`}
            value={theme.font}
            onChange={(e) => onChange({ ...theme, font: e.target.value as EmailTheme['font'] })}
          >
            <option value="sans">{t('Clean (Arial)')}</option>
            <option value="serif">{t('Classic (Georgia)')}</option>
          </Select>
        </Field>
      </div>
    </section>
  );
}
