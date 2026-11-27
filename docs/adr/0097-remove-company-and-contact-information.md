# 0097: Removing unwanted company and contact information

Status: accepted (2026-11-27)

## Context

Kunal asked for a way to delete any unwanted information from the company and contact sections, such as employee
details. Before this, a value could only be cleared by opening the edit dialog, a list item (a service, an email, an
office) could not be removed without retyping the list, and the Employees list could only take a person off the company,
never delete them.

## Decision

- **Single values, only from Edit.** Nothing can be deleted from the page itself, so an important detail is never
  removed by a stray click (Kunal, 2026-11-28: a first version with a × beside every value was taken out). In the company's
  "Edit business information" window each filled field has a **Delete** button that empties it, list fields (services,
  emails, phones…) drop an item by removing its line, and offices and leaders have a bin per row. In the employee's Edit
  window each email or phone has a bin, and other fields are emptied. Nothing is deleted until Save.
- **It is an edit.** No new route: the existing PATCH runs, with its permission (`companies:write` /
  `contacts:write`), its audit entry, and the Super/Console field locks. A restricted record shows no ×.
- **Auto-fill is unchanged (ADR 0076).** How auto-fill finds data is not touched. The existing bookkeeping already does
  what is needed: a cleared field becomes the person's own and is never written again, and a list item auto-fill had
  added is remembered as rejected once removed. A tested case covers both.
- **Employees.** The company's Employees list gets a tick box per row and for all rows shown, "Delete selected (N)" and
  "Delete all employees" (or "Delete all N shown" while a search or status filter is on), each with a confirmation. One
  employee is deleted from its Edit window ("Delete employee"), not from a button on the row. Deleting
  removes the contact record itself; "Remove from company" stays for keeping the person. It uses the existing bulk route
  (`POST /records/bulk`, entity `contacts`), so the password is asked once and each deletion goes through the contact's
  own delete and audit. The bulk route now takes up to 1,000 ticked ids (was 100, one table page), since a company's
  employees are shown on one list.
- **Approvals.** Deletes go through the same routes the delete-approval rules guard, so an executive who must ask a
  manager sees that flow; "sent for approval" and a cancelled password are shown as notes, not errors.

## Consequences

- An item someone typed by hand and later removed is not remembered as rejected; auto-fill could add it again only if
  it finds it on the company's own sources. Changing that would change the auto-fill feature, which is out of scope.
