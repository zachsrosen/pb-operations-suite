import dotenv from 'dotenv';

// Load .env file
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const { Client } = await import('@hubspot/api-client');

const token = process.env.HUBSPOT_ACCESS_TOKEN;
if (!token) {
  console.error('ERROR: HUBSPOT_ACCESS_TOKEN not found in environment');
  console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('HUB')));
  process.exit(1);
}

console.log('Using HUBSPOT_ACCESS_TOKEN:', token.substring(0, 20) + '...');

const client = new Client({
  accessToken: token
});

try {
  console.log('\nSearching HubSpot for PROJ-9472 Randolph...\n');
  
  const result = await client.crm.deals.searchApi.doSearch({
    query: 'PROJ-9472',
    properties: [
      'dealname',
      'amount',
      'dealstage',
      'pb_location',
      'address_line_1',
      'city',
      'state',
      'project_type',
      'hubspot_owner_id',
      'hs_object_id',
    ],
    limit: 10,
  });

  if (result.results && result.results.length > 0) {
    console.log(`Found ${result.results.length} result(s):\n`);
    result.results.forEach((deal, i) => {
      const props = deal.properties || {};
      console.log(`Result ${i + 1}:`);
      console.log(`  Deal Name: ${props.dealname}`);
      console.log(`  HubSpot ID: ${props.hs_object_id || deal.id}`);
      console.log(`  Amount: $${props.amount || '0'}`);
      console.log(`  Stage: ${props.dealstage}`);
      console.log(`  Location: ${props.pb_location || 'N/A'}`);
      console.log(`  Address: ${props.address_line_1 || ''} ${props.city || ''}, ${props.state || ''}`);
      console.log(`  Type: ${props.project_type || 'Unknown'}`);
      console.log(`  Owner ID: ${props.hubspot_owner_id || 'N/A'}`);
      console.log('');
    });
  } else {
    console.log('No results found for PROJ-9472');
  }
} catch (error) {
  console.error('Error searching HubSpot:', error.message);
  if (error.body) {
    console.error('Details:', JSON.stringify(error.body, null, 2));
  }
  process.exit(1);
}
