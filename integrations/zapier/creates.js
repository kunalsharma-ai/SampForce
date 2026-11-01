'use strict';
const { api } = require('./lib');

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/** Actions: each is one record created through the same API and checks as the DealFlow web app. */
module.exports = {
  create_lead: {
    key: 'create_lead',
    noun: 'Lead',
    display: { label: 'Create Lead', description: 'Creates a lead. DealFlow flags a likely duplicate instead of creating a second one silently.' },
    operation: {
      inputFields: [
        { key: 'fullName', label: 'Full name', required: true },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone', helpText: 'With the country code, for example +44 20 7946 0000.' },
        { key: 'companyName', label: 'Company' },
        { key: 'jobTitle', label: 'Job title' },
        { key: 'source', label: 'Source', helpText: 'For example "Zapier: Typeform demo request".' },
      ],
      perform: async (z, bundle) => {
        const r = await z.request({ url: api(bundle, '/leads'), method: 'POST', json: clean(bundle.inputData) });
        return r.data.lead || r.data;
      },
      sample: { id: '00000000-0000-4000-8000-000000000002', fullName: 'Ada Lovelace', email: 'ada@example.com', status: 'NEW' },
    },
  },
  create_contact: {
    key: 'create_contact',
    noun: 'Contact',
    display: { label: 'Create Contact', description: 'Creates a contact.' },
    operation: {
      inputFields: [
        { key: 'firstName', label: 'First name', required: true },
        { key: 'lastName', label: 'Last name' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone', helpText: 'With the country code.' },
        { key: 'jobTitle', label: 'Job title' },
      ],
      perform: async (z, bundle) => (await z.request({ url: api(bundle, '/contacts'), method: 'POST', json: clean(bundle.inputData) })).data,
      sample: { id: '00000000-0000-4000-8000-000000000003', firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com' },
    },
  },
  create_task: {
    key: 'create_task',
    noun: 'Task',
    display: { label: 'Create Task', description: 'Creates a task, assigned to the person who made the API key unless the key’s owner reassigns it.' },
    operation: {
      inputFields: [
        { key: 'title', label: 'Title', required: true },
        { key: 'description', label: 'Description', type: 'text' },
        { key: 'dueAt', label: 'Due', type: 'datetime' },
        { key: 'priority', label: 'Priority', choices: { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High' } },
      ],
      perform: async (z, bundle) => {
        const input = clean(bundle.inputData);
        if (input.dueAt) input.dueAt = new Date(input.dueAt).toISOString();
        return (await z.request({ url: api(bundle, '/tasks'), method: 'POST', json: input })).data;
      },
      sample: { id: '00000000-0000-4000-8000-000000000004', title: 'Call back', status: 'OPEN' },
    },
  },
};
