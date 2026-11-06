# ADR 0035: DocuSign e-signature for contracts

- Status: Accepted
- Date: 2026-11-01
- Part of: Enhancement programme, integrations (builds on ADR 0032)

## Context

Until now, contracts were marked signed by hand, with the methods "on paper", "by email" or "external e-signature".
Teams want to send the contract out for signature from SampForce and have it become Active when the customer signs,
without typing the result back in.

## Decisions

1. **Connection.** The workspace connects one DocuSign account through Authorization Code Grant with the
   `signature extended` scopes. The account id and its `base_uri` come from userinfo. Only DocuSign hosts are
   accepted, which prevents an SSRF through a forged base URI.
2. **The document.** SampForce renders the contract to PDF with anchor strings, rather than using DocuSign templates.
   That way what is signed is exactly the contract record. It is one signer, one envelope, and one open envelope per
   contract at a time.
3. **Explicit confirmation.** Sending emails the customer, so the API requires `confirm: true` and the page requires
   ticking a confirmation naming the recipient. It is never a workflow step, and agents cannot call it.
4. **Status.** Status comes from per-envelope Connect (`eventNotification` with `includeHMAC`), verified with the
   account's HMAC key. This avoids making admins configure account-wide Connect. "Check status" reads the envelope
   directly, for installations without the HMAC key or for a missed message. Transitions only move forward.
5. **Signing reuses the manual path.** A completed envelope calls the same `applyContractSignature` as manual
   signing, so a renewal still closes its predecessor. The audit entry has no human actor and records the source.
6. **Signed PDFs stay in DocuSign.** They are fetched when someone downloads them. Storing signed documents is a
   later decision.

## Consequences

- DocuSign is tested only against a local stand-in of its documented API until real keys are added. Production use
  also needs DocuSign's go-live review.
- Several signers, signing order and templates are not supported yet.
