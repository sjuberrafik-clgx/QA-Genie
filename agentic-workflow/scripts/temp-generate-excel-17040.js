const { generateTestCaseExcel } = require('./excel-template-generator.js');
const path = require('path');

const jiraInfo = {
  number: 'AOTF-17040',
  title: 'SND-Syndication sentiments not firing on Compare and My Properties Map Listing Card',
  url: 'https://corelogic-jira.atlassian.net/browse/AOTF-17040'
};

const preConditions = '1: For Agent Portal: User is authenticated as agent with agent ID 110720, 2: For Consumer: User is authenticated as consumer';

const testCases = [
  {
    id: 'TC-1',
    title: 'Agent Portal - Verify Syndication Sentiment Mixpanel Events on Compare Page Map Listing Card',
    steps: [
      {
        id: '1.1',
        action: 'Launch OneHome application and navigate to Agent Portal using the provided URL with token authentication',
        expected: 'User should be able to launch OneHome application and land on Agent Portal',
        actual: 'User is able to launch OneHome application and land on Agent Portal'
      },
      {
        id: '1.2',
        action: 'Navigate to Compare page with multiple properties added for comparison',
        expected: 'User should be able to view Compare page with multiple properties and Map listing cards displayed',
        actual: 'User is able to view Compare page with multiple properties and Map listing cards displayed'
      },
      {
        id: '1.3',
        action: 'Open browser developer tools, navigate to Network tab, and filter for Mixpanel events',
        expected: 'User should be able to open developer tools and monitor network requests for Mixpanel tracking',
        actual: 'User is able to open developer tools and monitor network requests for Mixpanel tracking'
      },
      {
        id: '1.4',
        action: 'On a Map listing card in Compare page, click the Recommend (Agent Pick) button',
        expected: 'User should be able to click Recommend button, Mixpanel syndication sentiment event should fire with appropriate tracking parameters',
        actual: 'Mixpanel syndication sentiment event fires successfully for Recommend action with correct event properties'
      },
      {
        id: '1.5',
        action: 'On the same Map listing card in Compare page, click the Discard button',
        expected: 'User should be able to click Discard button, Mixpanel syndication sentiment event should fire with appropriate tracking parameters',
        actual: 'Mixpanel syndication sentiment event fires successfully for Discard action with correct event properties'
      },
      {
        id: '1.6',
        action: 'Verify Mixpanel event payload includes syndication sentiment tracking data (property ID, action type, MLS source, user context)',
        expected: 'Mixpanel events should contain complete syndication sentiment tracking data for both Recommend and Discard actions',
        actual: 'Mixpanel events contain complete syndication sentiment tracking data including property ID, action type (Recommend/Discard), MLS source (Canopy), and user context'
      }
    ]
  },
  {
    id: 'TC-2',
    title: 'Agent Portal - Verify Syndication Sentiment Mixpanel Events on My Properties Map Listing Card',
    steps: [
      {
        id: '2.1',
        action: 'Launch OneHome application and navigate to Agent Portal Property Details page',
        expected: 'User should be able to launch OneHome application and navigate to Property Details page in Agent Portal',
        actual: 'User is able to launch OneHome application and navigate to Property Details page in Agent Portal'
      },
      {
        id: '2.2',
        action: 'Open browser developer tools, navigate to Network tab, and filter for Mixpanel events',
        expected: 'User should be able to open developer tools and monitor network requests for Mixpanel tracking',
        actual: 'User is able to open developer tools and monitor network requests for Mixpanel tracking'
      },
      {
        id: '2.3',
        action: 'On the Map listing card in Property Details page, click the Recommend (Agent Pick) button',
        expected: 'User should be able to click Recommend button, Mixpanel syndication sentiment event should fire with appropriate tracking parameters',
        actual: 'Mixpanel syndication sentiment event fires successfully for Recommend action with correct event properties'
      },
      {
        id: '2.4',
        action: 'On the same Map listing card in Property Details page, click the Discard button',
        expected: 'User should be able to click Discard button, Mixpanel syndication sentiment event should fire with appropriate tracking parameters',
        actual: 'Mixpanel syndication sentiment event fires successfully for Discard action with correct event properties'
      },
      {
        id: '2.5',
        action: 'Verify Mixpanel event payload includes syndication sentiment tracking data (property ID, action type, MLS source, user context)',
        expected: 'Mixpanel events should contain complete syndication sentiment tracking data for both Recommend and Discard actions',
        actual: 'Mixpanel events contain complete syndication sentiment tracking data including property ID, action type (Recommend/Discard), MLS source (Canopy), and user context'
      }
    ]
  },
  {
    id: 'TC-3',
    title: 'Consumer Portal - Verify Syndication Sentiment Mixpanel Events on Compare Page Map Listing Card',
    steps: [
      {
        id: '3.1',
        action: 'Launch OneHome application and navigate to Consumer Portal using the provided URL with token authentication',
        expected: 'User should be able to launch OneHome application and land on Consumer Portal',
        actual: 'User is able to launch OneHome application and land on Consumer Portal'
      },
      {
        id: '3.2',
        action: 'Navigate to Compare page with multiple properties added for comparison',
        expected: 'User should be able to view Compare page with multiple properties and Map listing cards displayed',
        actual: 'User is able to view Compare page with multiple properties and Map listing cards displayed'
      },
      {
        id: '3.3',
        action: 'Open browser developer tools, navigate to Network tab, and filter for Mixpanel events',
        expected: 'User should be able to open developer tools and monitor network requests for Mixpanel tracking',
        actual: 'User is able to open developer tools and monitor network requests for Mixpanel tracking'
      },
      {
        id: '3.4',
        action: 'On a Map listing card in Compare page, click the Favorite button',
        expected: 'User should be able to click Favorite button, Mixpanel syndication sentiment event should fire with appropriate tracking parameters',
        actual: 'Mixpanel syndication sentiment event fires successfully for Favorite action with correct event properties'
      },
      {
        id: '3.5',
        action: 'On the same Map listing card in Compare page, click the Dislike button',
        expected: 'User should be able to click Dislike button, Mixpanel syndication sentiment event should fire with appropriate tracking parameters',
        actual: 'Mixpanel syndication sentiment event fires successfully for Dislike action with correct event properties'
      },
      {
        id: '3.6',
        action: 'Verify Mixpanel event payload includes syndication sentiment tracking data (property ID, action type, MLS source, user context)',
        expected: 'Mixpanel events should contain complete syndication sentiment tracking data for both Favorite and Dislike actions',
        actual: 'Mixpanel events contain complete syndication sentiment tracking data including property ID, action type (Favorite/Dislike), MLS source (Canopy), and user context'
      }
    ]
  },
  {
    id: 'TC-4',
    title: 'Consumer Portal - Verify Syndication Sentiment Mixpanel Events on My Properties Map Listing Card',
    steps: [
      {
        id: '4.1',
        action: 'Launch OneHome application and navigate to Consumer Portal Property Details page',
        expected: 'User should be able to launch OneHome application and navigate to Property Details page in Consumer Portal',
        actual: 'User is able to launch OneHome application and navigate to Property Details page in Consumer Portal'
      },
      {
        id: '4.2',
        action: 'Open browser developer tools, navigate to Network tab, and filter for Mixpanel events',
        expected: 'User should be able to open developer tools and monitor network requests for Mixpanel tracking',
        actual: 'User is able to open developer tools and monitor network requests for Mixpanel tracking'
      },
      {
        id: '4.3',
        action: 'On the Map listing card in Property Details page, click the Favorite button',
        expected: 'User should be able to click Favorite button, Mixpanel syndication sentiment event should fire with appropriate tracking parameters',
        actual: 'Mixpanel syndication sentiment event fires successfully for Favorite action with correct event properties'
      },
      {
        id: '4.4',
        action: 'On the Map listing card in Property Details page, click the Dislike button',
        expected: 'User should be able to click Dislike button, Mixpanel syndication sentiment event should fire with appropriate tracking parameters',
        actual: 'Mixpanel syndication sentiment event fires successfully for Dislike action with correct event properties'
      },
      {
        id: '4.5',
        action: 'Verify Mixpanel event payload includes syndication sentiment tracking data (property ID, action type, MLS source, user context)',
        expected: 'Mixpanel events should contain complete syndication sentiment tracking data for both Favorite and Dislike actions',
        actual: 'Mixpanel events contain complete syndication sentiment tracking data including property ID, action type (Favorite/Dislike), MLS source (Canopy), and user context'
      }
    ]
  },
  {
    id: 'TC-5',
    title: 'Verify Mixpanel Event Properties and Tracking Consistency Across Both Portals',
    steps: [
      {
        id: '5.1',
        action: 'Perform Recommend/Favorite and Discard/Dislike actions on both Compare page and Property Details page in Agent Portal and Consumer Portal',
        expected: 'All syndication sentiment Mixpanel events should fire consistently across both portals and both page contexts',
        actual: 'All syndication sentiment Mixpanel events fire consistently across Agent Portal and Consumer Portal on both Compare page and Property Details page'
      },
      {
        id: '5.2',
        action: 'Compare Mixpanel event structure, property names, and data types between Agent Portal and Consumer Portal events',
        expected: 'Event structure should be consistent with identical property names and data types, only user context (agent ID vs contact ID) should differ',
        actual: 'Event structure is consistent across portals with matching property names, data types, and appropriate user context differentiation'
      },
      {
        id: '5.3',
        action: 'Verify event tracking includes MLS source (Canopy), property ID, action type, timestamp, user session data',
        expected: 'All required tracking parameters should be present in Mixpanel events for proper analytics and reporting',
        actual: 'All required tracking parameters are present including MLS source (Canopy), property ID, action type, timestamp, and user session data'
      }
    ]
  }
];

const outputPath = path.resolve('../test-cases', 'AOTF-17040.xlsx');

generateTestCaseExcel(jiraInfo, preConditions, testCases, outputPath)
  .then(() => {
    console.log('✅ Excel file created successfully: ' + outputPath);
    const fs = require('fs');
    const stats = fs.statSync(outputPath);
    console.log('📊 File size: ' + stats.size + ' bytes');
  })
  .catch(err => {
    console.error('❌ Error creating Excel:', err.message);
    process.exit(1);
  });
