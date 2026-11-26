/**
 * Company to Deal (redesign R4, ADR 0084). When a company becomes a client, SampForce makes its deal (or closes its
 * open one as won) from the company, its contact and its RFQs; a deal marked won makes its company a client.
 */
export interface CompanyWonDeal {
  id: string;
  name: string;
  dealNumber: string | null;
  status: 'OPEN' | 'WON' | 'LOST';
  amount: number;
  currency: string;
}

export interface CompanyWonResult {
  companyId: string;
  /** The deal this win made or closed; null when the workspace has no deal pipeline with a won stage. */
  deal: CompanyWonDeal | null;
  /** True when a new deal was made, false when an existing deal was used. */
  created: boolean;
  /** RFQs linked to the deal by this win. */
  linkedRfqs: number;
}
