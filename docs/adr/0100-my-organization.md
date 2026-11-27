# 0100. My Organization: the organisation's own profile, documents, credentials and client shares

Date: 2026-11-27. Status: accepted.

## Context

Every SampForce workspace keeps records of other companies, but there was nowhere to keep the organisation's own details: legal and brand name, logo, registration and tax IDs, offices, links, key contacts, and the certificates, memberships, presentations and service profiles that clients ask for during vendor registration and bids. People kept them in shared drives and chats, sent stale copies and pasted portal passwords into messages. ADR numbers 0095 to 0099 are taken on open branches, so this is 0100.

## Decision

A **My Organization** section at `/app/my-organization`, first in the Organization menu. One record per organisation (`tenantId`), the same for every workspace in the hierarchy.

- **Who does what.** Worked out on the server (`orgAccessOf`) from the workspace hierarchy (ADR 0071) and the Administration module's actions, so the Super Workspace's permission grid (PR 166) controls it:
  - The Super Workspace always edits, deletes and manages credentials.
  - A Manager Workspace edits with Administration **edit** (a default), deletes with **delete** (off by default, W2), and manages credentials with **manage**.
  - An Executive Workspace views and shares approved items. The Super Workspace can grant it edit or delete like any other action.
  - Every request is checked again on the server. Deletes and credential reveals need the password (`@ConfirmPassword`), so the delete approvals of PR 167 apply to them once it merges.
  - It is a core section, not a plan feature: child workspaces store their feature list, and a new feature key would be hidden from every existing one.
- **The profile** (`org_profiles`) reuses the Company profile's fields and parts: names, tagline, description, business activities, services, products, industries, certifications, company type and size, founding and incorporation, registration number and authority, tax IDs, registered office and other offices, phones and emails with labels, website and other links, social links, key contacts, other details, brand colours and an uploaded logo (PNG, JPEG, WebP or SVG, checked from its bytes, 2 MB). A completeness ring names the next field worth filling. Company auto-fill (ADR 0076, 0079) is not touched.
- **Documents** (`org_documents`, `org_document_versions`): title, category (registration, tax, ISO and quality, memberships, business credentials, presentations, service profiles, legal, financial, brand, other), description, issuer, reference number, issue and expiry dates, tags, who can see it (every workspace, Super and Manager, Super only) and whether it is approved for clients. Files up to 15 MB are stored in the database with their SHA-256 (each version is one MongoDB document, which holds at most 16 MB). Replacing a file adds a version and keeps every earlier one. PDFs, images and text preview inside the page in a same-origin frame; other files download. Search covers title, description, issuer, number, tags and file name, with category, expiry and approved filters.
- **Expiry reminders.** The worker sweeps every 10 minutes and notifies the Super Workspace and the Manager Workspaces with Administration edit 30 days and 7 days before a document expires and once when it has expired, each stage once per expiry date.
- **Credentials** (`org_credentials`): portal logins, tax and government portals, membership IDs, licence numbers, bank details. The secret and notes are sealed with the secret box (AES-256-GCM). Each one is for the Super Workspace only or for Super and Manager Workspaces; executives never see them, not even in the history. Revealing asks for the password and is logged. Credentials are never part of a share.
- **Sharing with clients** (`org_shares`): anyone with access makes a link holding the profile sections the editors chose under "What clients may see" and any documents approved for clients, for a named client, with a note, for 1 to 30 days. The link is a signed token shown once; the stored share is checked on every view, so a link stops when it expires or someone stops it, and a document withdrawn from clients drops out of every link. The client page at `/shared/organization/<token>` needs no sign-in. The person can copy the link, email it from their connected mailbox (the existing compose dialog), from their email app, or on WhatsApp.
- **Activity history** uses the audit log (`entityType: organization`): profile and logo changes, uploads, edits, replacements, approvals, downloads, deletions, credential changes and reveals, shares, first views by the client and stopped links.

## Consequences

- Files live in MongoDB like the other uploads, which keeps backups in one place. The 15 MB limit per file comes from MongoDB's 16 MB document limit; larger media would need a file store later.
- The share token is not stored, only the share it names, so a lost link cannot be shown again: make a new one.
- Delete approvals (PR 167) treat these deletes as approval requests from executives generically; adding the paths to its record map gives the approval a readable name.
- Company auto-fill could prefill the profile from the organisation's website; it was left out so the auto-fill feature stays unchanged.
