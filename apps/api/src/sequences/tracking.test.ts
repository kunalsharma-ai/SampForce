import { describe, expect, it } from 'vitest';
import { buildSequenceEmail, TrackingSigner } from './tracking';

const signer = new TrackingSigner('a-test-secret-that-is-long-enough-123', 'https://t.example.com');
const tenant = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const message = 'f0e1d2c3-b4a5-4968-8776-655443322110';

describe('TrackingSigner', () => {
  it('round-trips tenant and message ids and rejects tampering', () => {
    const t = signer.token(tenant, message);
    expect(signer.verify(t)).toEqual({ tenantId: tenant, messageId: message });
    const [raw, sig] = t.split('.');
    const flip = (x: string) => x.slice(0, -2) + (x.at(-2) === 'Q' ? 'R' : 'Q') + x.at(-1);
    expect(signer.verify(`${raw}.${flip(sig!)}`)).toBeNull();
    expect(signer.verify(`${flip(raw!)}.${sig}`)).toBeNull();
    expect(new TrackingSigner('another-secret-that-is-long-enough-456', 'x').verify(t)).toBeNull();
    expect(signer.verify('garbage')).toBeNull();
  });

  it('binds click signatures to the destination', () => {
    const t = signer.token(tenant, message);
    const sig = signer.urlSignature(t, 'https://a.test/x');
    expect(signer.verifyUrl(t, 'https://a.test/x', sig)).toBe(true);
    expect(signer.verifyUrl(t, 'https://b.test/x', sig)).toBe(false);
  });
});

describe('buildSequenceEmail', () => {
  const t = signer.token(tenant, message);

  it('escapes text, wraps links and adds the pixel and unsubscribe footer', () => {
    const out = buildSequenceEmail('Hi <b>Ana</b> & co,\n\nSee https://example.com/a?b=1.\nThanks', { signer, token: t, trackOpens: true, trackClicks: true });
    expect(out.body).toContain(`unsubscribe here: https://t.example.com/unsubscribe/${t}`);
    expect(out.html).toContain('Hi &lt;b&gt;Ana&lt;/b&gt; &amp; co,');
    expect(out.html).toContain(`href="https://t.example.com/api/v1/t/c/${t}?u=${encodeURIComponent('https://example.com/a?b=1')}&amp;s=`);
    expect(out.html).toContain('>https://example.com/a?b=1</a>.<br>Thanks');
    expect(out.html).toContain(`/api/v1/t/o/${t}.gif`);
    expect(out.headers['List-Unsubscribe']).toBe(`<https://t.example.com/api/v1/t/u/${t}>`);
  });

  it('sends plain text only when tracking is off', () => {
    const out = buildSequenceEmail('Hello https://example.com', { signer, token: t, trackOpens: false, trackClicks: false });
    expect(out.html).toBeUndefined();
    expect(out.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});
