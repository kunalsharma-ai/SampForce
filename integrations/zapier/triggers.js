'use strict';
const { api, flatten } = require('./lib');

/** REST-hook triggers. SampForce posts the event id; the trigger then reads the event with the record as it is now. */
const EVENTS = [
  ['lead_created', 'lead.created', 'New Lead', 'Triggers when a lead is created.'],
  ['lead_updated', 'lead.updated', 'Updated Lead', 'Triggers when a lead is changed.'],
  ['lead_converted', 'lead.converted', 'Converted Lead', 'Triggers when a lead is converted to a contact and deal.'],
  ['contact_created', 'contact.created', 'New Contact', 'Triggers when a contact is created.'],
  ['contact_updated', 'contact.updated', 'Updated Contact', 'Triggers when a contact is changed.'],
  ['company_created', 'company.created', 'New Company', 'Triggers when a company is created.'],
  ['deal_created', 'deal.created', 'New Deal', 'Triggers when a deal is created.'],
  ['deal_stage_changed', 'deal.stage_changed', 'Deal Changed Stage', 'Triggers when a deal moves to another stage.'],
  ['deal_won', 'deal.won', 'Deal Won', 'Triggers when a deal is marked won.'],
  ['deal_lost', 'deal.lost', 'Deal Lost', 'Triggers when a deal is marked lost.'],
  ['task_created', 'task.created', 'New Task', 'Triggers when a task is created.'],
  ['task_completed', 'task.completed', 'Task Completed', 'Triggers when a task is completed.'],
];

function trigger([key, event, label, description]) {
  return {
    key,
    noun: label.split(' ').slice(-1)[0],
    display: { label, description },
    operation: {
      type: 'hook',
      performSubscribe: async (z, bundle) => (await z.request({ url: api(bundle, '/zapier/hooks'), method: 'POST', json: { event, targetUrl: bundle.targetUrl } })).data,
      performUnsubscribe: async (z, bundle) => {
        await z.request({ url: api(bundle, `/zapier/hooks/${bundle.subscribeData.id}`), method: 'DELETE' });
        return {};
      },
      perform: async (z, bundle) => {
        const id = bundle.cleanedRequest && bundle.cleanedRequest.id;
        if (!id) return [];
        const r = await z.request({ url: api(bundle, `/zapier/events/${id}`) });
        return [flatten(r.data)];
      },
      performList: async (z, bundle) => (await z.request({ url: api(bundle, `/zapier/samples/${event}`) })).data.map(flatten),
      sample: { id: '00000000-0000-4000-8000-000000000000', event, occurred_at: '2026-11-01T09:00:00.000Z', entity_type: event.split('.')[0], entity_id: '00000000-0000-4000-8000-000000000001' },
    },
  };
}

module.exports = Object.fromEntries(EVENTS.map((e) => [e[0], trigger(e)]));
module.exports.EVENTS = EVENTS;
