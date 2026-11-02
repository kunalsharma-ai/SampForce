import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * Finds the English text the API sends to people, read straight from the source so a new message cannot ship without
 * a translation (src/i18n/messages.test.ts): exception messages, `{ code, message }` error bodies, `{ path, message }`
 * field problems, the messages of shared Zod schemas, and the arguments of the error helpers below. A `${…}`
 * interpolation becomes the marker {·}, which matches any `{name}` placeholder of a catalogue phrase.
 */
export const SLOT = '{·}';

/** Helpers that build an exception from an argument: the argument's index and the sentence it ends up in. */
const HELPERS: Record<string, { arg: number; template?: string }> = {
  notFound: { arg: 0, template: `${SLOT} not found.` },
  off: { arg: 0, template: `${SLOT}: not available in this portal.` },
  duplicate: { arg: 0, template: `${SLOT} already exists.` },
  notConfigured: { arg: 0, template: `${SLOT} is not configured for this deployment.` },
  forbid: { arg: 0 },
  unusable: { arg: 0 },
  fail: { arg: 0 },
  planLimit: { arg: 0 },
  invalid: { arg: 1 },
  badRef: { arg: 1 },
};

/**
 * Errors the services raise in their own words and the controllers pass on as API messages. ScimError (answers to
 * identity providers' SCIM clients) and ActionError (kept in automation run history) are not shown this way.
 */
const PASSED_ON_ERRORS: Record<string, number> = {
  AppError: 0, AgentOutputError: 0, ProviderError: 0, BillingProviderError: 0, UnsafeTargetError: 0, TranscriptionError: 0,
  UnsafeZipError: 0, ReauthRequiredError: 0, InvalidSignatureError: 0, TransientProviderError: 0,
  // These take a machine-readable code first, then the message.
  OidcError: 1, CardPaymentError: 1, DocusignError: 1, ZoomError: 1, TeamsError: 1, SlackError: 1, TwilioError: 1, WhatsappError: 1,
};

/** Functions that return a sentence for people (a failure reason, a provider error explained). */
const RETURNS_TEXT = new Set(['describeTwilioError', 'describeError', 'payReason', 'smsNumber', 'waNumber']);

/** Zod checks whose message is the first argument, and those whose message follows a limit or pattern. */
const ZOD_FIRST = new Set(['email', 'url', 'uuid', 'cuid', 'int', 'positive', 'nonnegative', 'negative', 'nonpositive', 'nonempty', 'datetime', 'date', 'time', 'ip', 'finite']);
const ZOD_SECOND = new Set(['min', 'max', 'length', 'regex', 'startsWith', 'endsWith', 'includes', 'gte', 'lte', 'gt', 'lt', 'multipleOf', 'refine']);
const ZOD_OPTIONS = new Set(['required_error', 'invalid_type_error', 'message']);

export interface SourceText {
  text: string;
  file: string;
}

function texts(node: ts.Expression | undefined): string[] {
  if (!node) return [];
  if (ts.isParenthesizedExpression(node)) return texts(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) return [node.head.text + node.templateSpans.map((s) => SLOT + s.literal.text).join('')];
  if (ts.isConditionalExpression(node)) return [...texts(node.whenTrue), ...texts(node.whenFalse)];
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) return texts(node.right);
  return [];
}

function prop(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties) if (ts.isPropertyAssignment(p) && p.name.getText() === name) return p.initializer;
  return undefined;
}

function messageOf(arg: ts.Expression | undefined): string[] {
  if (arg && ts.isObjectLiteralExpression(arg)) return texts(prop(arg, 'message'));
  return texts(arg);
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name) && !/source-text\.ts$/.test(name) ? [path] : [];
  });
}

export function sourceTexts(dirs: string[], root: string): SourceText[] {
  const out: SourceText[] = [];
  for (const file of dirs.flatMap(files)) {
    const code = readFileSync(file, 'utf8');
    const usesZod = /from 'zod'|from '@dealflow\/types'/.test(code);
    const src = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
    const add = (list: string[]) => list.forEach((text) => /\p{L}/u.test(text) && out.push({ text, file: relative(root, file) }));
    const visit = (n: ts.Node): void => {
      if (ts.isNewExpression(n)) {
        const name = n.expression.getText();
        if (/Exception$/.test(name)) for (const a of n.arguments ?? []) add(texts(a));
        const index = PASSED_ON_ERRORS[name];
        if (index !== undefined) add(texts(n.arguments?.[index]));
      }
      if (ts.isReturnStatement(n) && n.expression) {
        let fn: ts.Node | undefined = n.parent;
        while (fn && !ts.isFunctionDeclaration(fn)) fn = fn.parent;
        if (fn && ts.isFunctionDeclaration(fn) && fn.name && RETURNS_TEXT.has(fn.name.text)) {
          const e = n.expression;
          add(ts.isObjectLiteralExpression(e) ? texts(prop(e, 'problem')) : texts(e));
        }
      }
      if (ts.isObjectLiteralExpression(n)) {
        const message = prop(n, 'message');
        if (message && (prop(n, 'code') || prop(n, 'path'))) add(texts(message));
      }
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        const name = ts.isIdentifier(callee) ? callee.text : undefined;
        const helper = name ? HELPERS[name] : undefined;
        if (helper) {
          const values = texts(n.arguments[helper.arg]);
          add(helper.template ? values.map((v) => helper.template!.replace(SLOT, v)) : values);
        }
        if (usesZod && ts.isPropertyAccessExpression(callee)) {
          const method = callee.name.text;
          if (ZOD_FIRST.has(method)) add(messageOf(n.arguments[0]));
          if (ZOD_SECOND.has(method)) add(messageOf(n.arguments[1]));
          if (/addIssue$/.test(callee.getText())) add(messageOf(n.arguments[0]));
          for (const a of n.arguments) {
            if (!ts.isObjectLiteralExpression(a)) continue;
            for (const key of ZOD_OPTIONS) if (key !== 'message') add(texts(prop(a, key)));
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  return out;
}

/** A phrase's shape for comparison: every `{name}` placeholder becomes {·}. */
export const shape = (text: string) => text.replace(/\{\w+\}/g, SLOT);
