/* eslint-disable @typescript-eslint/no-require-imports */
const { Client } = require('@hubspot/api-client');

const client = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN
});

async function fetchSchema() {
  try {
    // Get deal properties
    console.log('Fetching deal properties...\n');
    const props = await client.crm.properties.coreApi.getAll('deals');

    // Filter to custom properties (not HubSpot default)
    const customProps = props.results.filter(p => {
      const isHubspotInternal = p.name.startsWith('hs_');
      const isStandard = ['dealname', 'amount', 'dealstage', 'closedate', 'pipeline', 'dealtype', 'description', 'createdate', 'num_associated_contacts'].includes(p.name);
      return !isHubspotInternal && !isStandard;
    });

    console.log('=== CUSTOM DEAL PROPERTIES (' + customProps.length + ' total) ===\n');
    console.log('Internal Name | Label | Type');
    console.log('-'.repeat(80));
    customProps.forEach(p => {
      console.log(p.name + ' | ' + p.label + ' | ' + p.type);
    });

    // Get deal stages
    console.log('\n=== DEAL PIPELINES & STAGES ===\n');
    const pipelines = await client.crm.pipelines.pipelinesApi.getAll('deals');
    pipelines.results.forEach(pipeline => {
      console.log('Pipeline: ' + pipeline.label + ' (id: ' + pipeline.id + ')');
      pipeline.stages.forEach(stage => {
        console.log('  ' + stage.id + ' | ' + stage.label + ' | displayOrder: ' + stage.displayOrder);
      });
      console.log('');
    });

    // Get line item properties
    console.log('\n=== LINE ITEM PROPERTIES ===\n');
    const lineItemProps = await client.crm.properties.coreApi.getAll('line_items');
    const customLineItemProps = lineItemProps.results.filter(p => {
      const isHubspotInternal = p.name.startsWith('hs_');
      return !isHubspotInternal;
    });

    console.log('Internal Name | Label | Type');
    console.log('-'.repeat(80));
    customLineItemProps.slice(0, 30).forEach(p => {
      console.log(p.name + ' | ' + p.label + ' | ' + p.type);
    });

    // Fetch tags/labels if available
    console.log('\n=== CHECKING FOR TAGS PROPERTY ===\n');
    const tagProps = props.results.filter(p =>
      p.name.includes('tag') ||
      p.name.includes('label') ||
      p.label.toLowerCase().includes('tag') ||
      p.label.toLowerCase().includes('participate')
    );
    tagProps.forEach(p => {
      console.log(p.name + ' | ' + p.label + ' | ' + p.type);
      if (p.options && p.options.length > 0) {
        console.log('  Options: ' + p.options.map(o => o.label).join(', '));
      }
    });

  } catch (err) {
    console.error('Error:', err.message);
    if (err.body) {
      console.error('Details:', JSON.stringify(err.body, null, 2));
    }
  }
}

fetchSchema();
