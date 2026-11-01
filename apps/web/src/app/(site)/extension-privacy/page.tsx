import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Browser extension privacy',
  description: 'What the DealFlow lead capture extension reads, where it sends it, what it keeps in your browser and how to remove it.',
};

/**
 * Privacy notice for the DealFlow browser extension, linked from its Chrome Web Store listing. It describes what
 * the code in apps/extension does; keep the two in step when the extension changes.
 */
export default function ExtensionPrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:ps-5">
      <h1 className="text-4xl font-semibold tracking-tight">DealFlow lead capture: privacy</h1>
      <p className="text-muted-foreground">Last updated 1 November 2026</p>
      <p>
        The DealFlow lead capture extension for Chrome and Edge finds email addresses on the web page you are reading and saves the people as leads in your
        DealFlow workspace. It can also show people who work at the company whose website you are on, from your workspace&apos;s data provider, and save
        them to a prospect list or as leads. It works only after you connect it to your workspace, by signing in with your DealFlow email and password or
        with a connection code you create in DealFlow. Sampledge makes DealFlow and the extension.
      </p>

      <h2>What it reads</h2>
      <ul>
        <li>When you open the panel or press Scan, the page you are on: its address and title, the company name it publishes, and the email addresses written on it with the names shown next to them.</li>
        <li>Only if you turn on automatic capture: the same details from pages as they finish loading, so it can save new people without you opening the panel.</li>
        <li>It reads pages only on sites you have allowed in the browser&apos;s site access prompt. It does not read form fields you type into, passwords, cookies or your browsing history.</li>
      </ul>

      <h2>Where it sends it</h2>
      <ul>
        <li>Only to the DealFlow address you entered when connecting, which is your own workspace.</li>
        <li>To check who is already in DealFlow, it sends the addresses found and the site&apos;s address. When you save people, it sends their addresses and the names you kept, the company name and the page address, which DealFlow records as the lead&apos;s source.</li>
        <li>When you press &quot;Find more people&quot;, it sends the site&apos;s domain. DealFlow&apos;s servers then read that company&apos;s public website, and, if your workspace has added its own key, ask the data provider Hunter.io. The extension itself contacts no one but your workspace.</li>
        <li>When you press &quot;Find prospects&quot;, it sends the site&apos;s domain and any job titles you typed. DealFlow&apos;s servers ask the data provider Apollo.io for people at that company, if your workspace has added its own key; without one, DealFlow shows labelled sample people and nothing is sent to Apollo. Finding email addresses for the people you import also goes through DealFlow&apos;s servers. The extension never reads people from the page or from social networks for this.</li>
        <li>When you sign in, it sends your email and password to your workspace only, once, to create the extension&apos;s own connection. The password is not stored.</li>
        <li>With automatic capture, it saves only addresses at the website&apos;s own domain, never personal mailboxes such as Gmail, at most 100 a day.</li>
      </ul>

      <h2>What it keeps in your browser</h2>
      <ul>
        <li>Your DealFlow address, the connection token (from signing in or a connection code) and your name and workspace name, so it stays signed in. Never your password.</li>
        <li>Whether automatic capture is on, how many people it saved today, the last 30 automatic saves, and the pages it already checked in the last 24 hours, so it does not check them again.</li>
        <li>This is stored with the browser&apos;s extension storage on your device and is not synced to other devices.</li>
      </ul>

      <h2>What it does not do</h2>
      <ul>
        <li>No advertising, analytics or tracking code, and no data sent to Sampledge or anyone else except your workspace.</li>
        <li>It does not sell or share data, and it does not use what it reads for anything other than finding and saving leads for you.</li>
        <li>It does not read LinkedIn or other social network profiles on your behalf.</li>
      </ul>

      <h2>How your workspace handles it</h2>
      <p>
        Leads saved through the extension are stored in your DealFlow workspace like any other lead, under your workspace&apos;s own settings and agreements
        with Sampledge. Your workspace administrators can see and delete them. People on your workspace&apos;s do-not-email list are flagged and never
        added to a sequence.
      </p>

      <h2>Removing it</h2>
      <ul>
        <li>Press Disconnect in the extension to sign it out and clear the connection code and automatic capture settings from your browser.</li>
        <li>In DealFlow, Integrations, Browser extension lists every connection; Remove ends one immediately. Connections also end after 90 days.</li>
        <li>Uninstalling the extension removes everything it stored in your browser.</li>
      </ul>

      <h2>Questions</h2>
      <p>Ask your DealFlow workspace administrator, or contact Sampledge through the details your workspace was given when it signed up.</p>
    </article>
  );
}
