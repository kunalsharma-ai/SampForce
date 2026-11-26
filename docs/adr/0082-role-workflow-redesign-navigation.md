# ADR 0082: Role and workflow redesign, part 2: navigation

Date: 2026-11-26. Status: accepted.

## Context

The redesign spec (plan: project files `sampforce/redesign/PLAN.md`, R2) asks for three navigation changes:

- Rename the Command Center to Dashboard.
- Hide the Leads module completely, and the separate Accounts page with it. Companies and their contacts are where
  leads are worked now, and the Super Admin must be able to switch the pages back on.
- Give the menu less clutter.

The sidebar listed 36 modules in five open groups.

## Decision

**Dashboard.** The home page, its sidebar entry, the page title, the `g h` shortcut, "Back to the Dashboard" links,
the help topic and the logo link now say Dashboard in all five languages:

| Language | Name |
| --- | --- |
| Spanish | Panel |
| French | Tableau de bord |
| German | Dashboard |
| Arabic | لوحة المعلومات |

Internal names (`command-center` files, `page.commandCenter` help id) are unchanged.

**Leads and Accounts pages are opt-in features.** There are two new catalogue features, both `optIn`, so they are in
no plan by default and a stored plan list never gains them on upgrade:

- `leads_section`: the Leads list, at the exact path `/app/leads`. Its parent is `lead_management`.
- `accounts_section`: `/app/accounts`. Its parent is `account_management`.

The Console Admin switches them on for an organisation on its client page, or for a whole plan. They then run down
the workspace hierarchy like every other feature. Manager and Executive Workspaces created afterwards inherit them,
and the Super Workspace can hand them to existing ones.

- `FeatureDef.exactPaths` is new. It gates only the list page. A lead's own page (`/app/leads/:id`) stays under
  `lead_management`, so links from notifications, the inbox, sequences and deals keep working for records that
  already exist.
- While a section is off it is left out of the sidebar, the customise dialog, search, keyboard shortcuts and the
  phone bar, instead of being shown with a lock. "New lead" is left out of quick create for the same reason.
- Opening the address shows "Leads page is switched off" with no upgrade button, because it is not a plan matter.
- Lead APIs are unchanged. Inbound enquiries and imports still create leads.

**Shorter sidebar.** The sidebar opens with the daily sales work, in this order:

1. Dashboard
2. Companies
3. Contacts
4. Deals
5. Pipelines
6. Follow-ups
7. Tasks
8. Targets
9. RFQs
10. Team chat
11. Team status
12. Leads and Accounts (only when switched on)

Settings is always shown below that list. Everything else (Engage, Intelligence, Revenue and the other Organisation
pages) sits under **More**:

- More is a disclosure button, and whether it is open is remembered on the device.
- It opens by itself on a page inside it.
- While closed, it shows the total of unread notifications from the sections inside it.
- People's own order and hidden modules (Customise menu) still apply.

## Consequences

- Existing organisations lose the Leads and Accounts pages from their menu until the Console Admin switches them on.
  No data is touched.
- E2E: `signUp()` switches both pages on by default (fixture action `featureOverrides`), so specs written for them
  keep working. `{ sections: false }` starts as a real new organisation does.
  `redesign-navigation.spec.ts` covers the new behaviour.
