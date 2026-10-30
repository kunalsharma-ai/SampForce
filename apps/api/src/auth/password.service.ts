import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended argon2id baseline: 19 MiB memory, 2 iterations, 1 lane.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    // Verify against a throwaway hash when the user does not exist so response timing does
    // not reveal which email addresses are registered.
    const target = passwordHash ?? (await (this.dummyHash ??= this.hash('dealflow-timing-equaliser-1')));
    const ok = await verify(target, password).catch(() => false);
    return ok && passwordHash !== null;
  }
}
