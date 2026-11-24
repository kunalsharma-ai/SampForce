import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type SampbidxFixture, SBX, startSampbidxFixture } from '../../test/fixtures/sampbidx-fixture';
import type { ApiEnv } from '../common/env';
import { SampbidxClient, SampbidxError } from './sampbidx';

// Production settings: private targets refused unless the operator approved them (ADR 0068).
const env = (trusted?: string) => ({ ALLOW_PRIVATE_NETWORK_TARGETS: false, TRUSTED_PRIVATE_HOSTS: trusted }) as unknown as ApiEnv;

describe('SampBidx on the same server or private network', () => {
  let sbx: SampbidxFixture;
  beforeAll(async () => {
    sbx = await startSampbidxFixture();
  });
  afterAll(async () => {
    await sbx.close();
  });

  it('is refused until the operator approves its host, with a sentence saying where to approve it', async () => {
    const err = await new SampbidxClient(env()).check({ baseUrl: `${sbx.url}/api`, apiKey: SBX.key }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SampbidxError);
    expect((err as SampbidxError).code).toBe('address');
    expect((err as SampbidxError).message).toMatch(/private or internal address.*Workspace servers/);
  });

  it('is reached over plain http once the operator lists it in Approved private hosts', async () => {
    await expect(new SampbidxClient(env('127.0.0.1')).check({ baseUrl: `${sbx.url}/api`, apiKey: SBX.key })).resolves.toEqual({ accountName: SBX.account });
    await expect(new SampbidxClient(env('127.0.0.0/8')).check({ baseUrl: `${sbx.url}/api`, apiKey: SBX.key })).resolves.toEqual({ accountName: SBX.account });
  });

  it('still refuses plain http to a public address, so the key never crosses the internet unencrypted', async () => {
    const err = await new SampbidxClient(env('127.0.0.1')).check({ baseUrl: 'http://8.8.8.8/api', apiKey: SBX.key }).catch((e: unknown) => e);
    expect((err as SampbidxError).code).toBe('address');
    expect((err as SampbidxError).message).toMatch(/Use an https:\/\/ address/);
  });
});
