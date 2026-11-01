import { describe, expect, it } from 'vitest';
import type { ApiEnv } from '../common/env';
import { TeamsClient, teamsEscape } from './teams';

const client = new TeamsClient({ ALLOW_PRIVATE_NETWORK_TARGETS: false } as ApiEnv);

describe('TeamsClient.checkUrl', () => {
  it.each([
    ['http://prod-12.westus.logic.azure.com/workflows/x', 'Paste the URL from the Teams Workflows app'],
    ['https://acme.webhook.office.com/webhookb2/abc', 'Office 365 connector URLs are being retired'],
    ['https://evil.example.com/logic.azure.com', 'Paste the URL'],
    ['https://logic.azure.com.evil.example/x', 'Paste the URL'],
    ['not a url', 'Not a valid URL'],
  ])('refuses %s', async (url, message) => {
    await expect(client.checkUrl(url)).rejects.toThrow(message);
  });
});

describe('teamsEscape', () => {
  it('breaks markdown links in record values', () => {
    expect(teamsEscape('Click [here](https://evil.example) now')).toBe('Click [here] (https://evil.example) now');
    expect(teamsEscape('Plain text & <b>tags</b>')).toBe('Plain text & <b>tags</b>');
  });
});
