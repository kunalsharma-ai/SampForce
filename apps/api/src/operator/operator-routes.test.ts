import 'reflect-metadata';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { OPERATOR_PERMISSIONS } from '@dealflow/types';
import { describe, expect, it } from 'vitest';
import { OperatorChatController } from '../chat/chat.controller';
import { OperatorMobileController } from '../mobile/mobile.controller';
import { OperatorHelpController } from '../support/help-content.controller';
import { OperatorSupportController } from '../support/support.controller';
import { OperatorAdminController } from './operator-admin.controller';
import { OPERATOR_ROUTE_METADATA, OperatorGuard } from './operator-auth';
import { OperatorController } from './operator.controller';

const CONTROLLERS = [OperatorController, OperatorAdminController, OperatorChatController, OperatorSupportController, OperatorHelpController, OperatorMobileController];

/** Every Console route says what it needs (ADR 0074): a permission, any signed-in operator, or no session at all. */
describe('operator routes', () => {
  const routes = CONTROLLERS.flatMap((c) =>
    Object.getOwnPropertyNames(c.prototype)
      .filter((m) => m !== 'constructor' && Reflect.getMetadata(METHOD_METADATA, (c.prototype as unknown as Record<string, object>)[m]!) !== undefined)
      .map((m) => {
        const fn = (c.prototype as unknown as Record<string, object>)[m]!;
        const read = (key: string) => Reflect.getMetadata(key, fn) ?? Reflect.getMetadata(key, c);
        return { route: `${c.name}.${m} ${Reflect.getMetadata(PATH_METADATA, fn)}`, permission: read(OPERATOR_ROUTE_METADATA.permission) as string[] | undefined, any: read(OPERATOR_ROUTE_METADATA.any), public: read(OPERATOR_ROUTE_METADATA.public) };
      }),
  );

  it('finds the routes', () => {
    expect(routes.length).toBeGreaterThan(80);
    for (const c of CONTROLLERS) expect(Reflect.getMetadata(GUARDS_METADATA, c), c.name).toContain(OperatorGuard);
  });

  it('gives every route a permission, or marks it open to any operator or signed out', () => {
    const missing = routes.filter((r) => !r.permission?.length && !r.any && !r.public).map((r) => r.route);
    expect(missing).toEqual([]);
  });

  it('only names permissions that exist', () => {
    const unknown = routes.flatMap((r) => (r.permission ?? []).filter((p) => !(OPERATOR_PERMISSIONS as readonly string[]).includes(p)).map((p) => `${r.route}: ${p}`));
    expect(unknown).toEqual([]);
  });

  it('keeps the signed-out routes to sign-in and password links', () => {
    expect(routes.filter((r) => r.public).map((r) => r.route.split(' ')[0]).sort()).toEqual(
      ['OperatorAdminController.forgot', 'OperatorAdminController.linkInfo', 'OperatorAdminController.setPassword', 'OperatorController.login', 'OperatorController.logout'].sort(),
    );
  });
});
