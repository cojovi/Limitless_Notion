import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const LIMITLESS_API_KEY = process.env.LIMITLESS_API_KEY;
const LIMITLESS_API_URL = 'https://api.limitless.ai/v1/lifelogs';
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000', 10); // Default 30 seconds
const STATE_FILE = path.join(__dirname, '.last-seen-state.json');
const SCHEMA_CACHE_FILE = path.join(__dirname, '.notion-schema-cache.json');

// Initialize OpenAI client
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// Validate required environment variables
if (!LIMITLESS_API_KEY) {
  console.error('Error: LIMITLESS_API_KEY environment variable is required');
  process.exit(1);
}
if (!NOTION_API_KEY) {
  console.error('Error: NOTION_API_KEY environment variable is required');
  process.exit(1);
}
if (!NOTION_DATABASE_ID) {
  console.error('Error: NOTION_DATABASE_ID environment variable is required');
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

/**
 * Load the last seen timestamp from state file
 */
async function loadLastSeenTime() {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf-8');
    const state = JSON.parse(data);
    return state.lastSeenTime || new Date().toISOString();
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, start from now
      const now = new Date().toISOString();
      await saveLastSeenTime(now);
      return now;
    }
    throw error;
  }
}

/**
 * Save the last seen timestamp to state file
 */
async function saveLastSeenTime(timestamp) {
  const state = { lastSeenTime: timestamp };
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Fetch starred lifelogs from Limitless API
 */
async function fetchStarredLifelogs(startTime) {
  const url = new URL(LIMITLESS_API_URL);
  url.searchParams.set('isStarred', 'true');
  url.searchParams.set('start', startTime);
  url.searchParams.set('direction', 'asc');
  url.searchParams.set('limit', '10');

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'X-API-Key': LIMITLESS_API_KEY,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Limitless API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    
    // Debug: Log response structure (first time only)
    if (!global._limitlessApiResponseLogged) {
      console.log('Limitless API response structure:', {
        isArray: Array.isArray(data),
        keys: data && typeof data === 'object' ? Object.keys(data) : 'N/A',
        type: typeof data,
        sample: JSON.stringify(data).substring(0, 200)
      });
      global._limitlessApiResponseLogged = true;
    }
    
    // Handle different possible response structures
    let lifelogs = [];
    
    if (Array.isArray(data)) {
      // Response is directly an array
      lifelogs = data;
    } else if (data && typeof data === 'object') {
      // Check for nested data.lifelogs structure (Limitless API format)
      if (data.data && data.data.lifelogs && Array.isArray(data.data.lifelogs)) {
        lifelogs = data.data.lifelogs;
      } else if (data.lifelogs && Array.isArray(data.lifelogs)) {
        // Response has a 'lifelogs' property that is an array
        lifelogs = data.lifelogs;
      } else if (data.data && Array.isArray(data.data)) {
        // Response has a 'data' property that is an array
        lifelogs = data.data;
      } else if (data.results && Array.isArray(data.results)) {
        // Response has a 'results' property that is an array
        lifelogs = data.results;
      } else if (data.items && Array.isArray(data.items)) {
        // Response has an 'items' property that is an array
        lifelogs = data.items;
      } else {
        // Log the actual response structure for debugging (only once per session)
        if (!global._limitlessApiWarningShown) {
          console.warn('Unexpected API response structure. Response keys:', Object.keys(data));
          if (data.data) {
            console.warn('data.data keys:', Object.keys(data.data));
          }
          console.warn('Full response (first 1000 chars):', JSON.stringify(data, null, 2).substring(0, 1000));
          global._limitlessApiWarningShown = true;
        }
        lifelogs = [];
      }
    } else {
      console.warn('Unexpected API response type:', typeof data, data);
      lifelogs = [];
    }
    
    return lifelogs;
  } catch (error) {
    console.error('Error fetching lifelogs:', error.message);
    throw error;
  }
}

/**
 * Fetch Notion database schema
 */
async function fetchNotionDatabaseSchema() {
  try {
    // Check cache first
    try {
      const cached = await fs.readFile(SCHEMA_CACHE_FILE, 'utf-8');
      const cacheData = JSON.parse(cached);
      // Use cache if less than 1 hour old
      if (Date.now() - cacheData.timestamp < 3600000) {
        console.log('Using cached Notion database schema');
        return cacheData.schema;
      }
    } catch (error) {
      // Cache doesn't exist or is invalid, fetch fresh
    }

    const response = await fetch(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}`, {
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Notion API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const database = await response.json();
    const schema = database.properties || {};

    // Cache the schema
    await fs.writeFile(
      SCHEMA_CACHE_FILE,
      JSON.stringify({ schema, timestamp: Date.now() }, null, 2),
      'utf-8'
    );

    console.log('Fetched and cached Notion database schema');
    return schema;
  } catch (error) {
    console.error('Error fetching Notion database schema:', error.message);
    throw error;
  }
}

/**
 * Use AI to map lifelog data to Notion properties
 */
async function generatePropertyMapping(lifelog, databaseSchema) {
  if (!openai) {
    throw new Error('OpenAI client not initialized');
  }

  // Format schema information for AI
  const schemaInfo = Object.entries(databaseSchema).map(([name, prop]) => {
    const info = {
      name,
      type: prop.type,
    };

    // Add type-specific options
    if (prop.type === 'select' && prop.select?.options) {
      info.options = prop.select.options.map(opt => opt.name);
    }
    if (prop.type === 'multi_select' && prop.multi_select?.options) {
      info.options = prop.multi_select.options.map(opt => opt.name);
    }
    if (prop.type === 'status' && prop.status?.options) {
      info.options = prop.status.options.map(opt => opt.name);
    }

    return info;
  });

  const prompt = `You are a data mapping assistant. Your task is to map data from a Limitless lifelog to a Notion database.

NOTION DATABASE SCHEMA:
${JSON.stringify(schemaInfo, null, 2)}

LIMITLESS LIFELOG DATA:
${JSON.stringify(lifelog, null, 2)}

Analyze the lifelog data and the available Notion properties. Determine the best way to map the lifelog data to the Notion properties.

Return a JSON object where each key is a Notion property name, and the value is the properly formatted Notion property value object according to the Notion API format.

IMPORTANT RULES:
1. Only include properties that exist in the schema
2. Use the correct Notion API format for each property type:
   - title: {"title": [{"text": {"content": "value"}}]}
   - rich_text: {"rich_text": [{"text": {"content": "value"}}]}
   - date: {"date": {"start": "ISO8601-string"}} or null
   - select: {"select": {"name": "option-name"}} or null (must match existing option)
   - multi_select: {"multi_select": [{"name": "option1"}, {"name": "option2"}]} (must match existing options)
   - status: {"status": {"name": "option-name"}} or null (must match existing option)
   - number: {"number": 123.45} or null
   - checkbox: {"checkbox": true/false}
   - url: {"url": "https://..."} or null
   - email: {"email": "email@example.com"} or null
   - phone_number: {"phone_number": "+1234567890"} or null
3. For select/multi_select/status, you can intelligently match values or create appropriate mappings
4. Extract meaningful information from the lifelog (title, markdown content, timestamps, etc.)
5. Be smart about mapping - if a property name suggests a purpose (e.g., "Tags", "Category", "Priority"), try to infer appropriate values from the lifelog content

Return ONLY valid JSON, no markdown, no explanation.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that maps data between different formats. Always return valid JSON only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0].message.content.trim();
    const properties = JSON.parse(responseText);

    return properties;
  } catch (error) {
    console.error('Error generating AI property mapping:', error.message);
    throw error;
  }
}

/**
 * Create a page in Notion database from a lifelog using AI mapping
 */
async function createNotionPage(lifelog, databaseSchema) {
  // Use AI to generate property mappings
  let properties;
  try {
    properties = await generatePropertyMapping(lifelog, databaseSchema);
    console.log('AI generated property mappings');
  } catch (error) {
    console.error('AI mapping failed, using fallback:', error.message);
    // Fallback to basic mapping if AI fails
    properties = {
      Title: {
        title: [
          {
            text: {
              content: lifelog.title || 'Untitled',
            },
          },
        ],
      },
    };
    if (lifelog.markdown || lifelog.text) {
      const contentProp = Object.keys(databaseSchema).find(
        key => databaseSchema[key].type === 'rich_text'
      );
      if (contentProp) {
        properties[contentProp] = {
          rich_text: [
            {
              text: {
                content: lifelog.markdown || lifelog.text || '',
              },
            },
          ],
        };
      }
    }
  }

  const pageData = {
    parent: {
      database_id: NOTION_DATABASE_ID,
    },
    properties,
    children: lifelog.markdown
      ? [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [
                {
                  type: 'text',
                  text: {
                    content: lifelog.markdown,
                  },
                },
              ],
            },
          },
        ]
      : [],
  };

  try {
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify(pageData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Notion API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating Notion page:', error.message);
    throw error;
  }
}

/**
 * Process new starred lifelogs
 */
async function processNewLifelogs(databaseSchema) {
  try {
    const lastSeenTime = await loadLastSeenTime();
    console.log(`[${new Date().toISOString()}] Polling for starred lifelogs since ${lastSeenTime}`);

    let lifelogs;
    try {
      lifelogs = await fetchStarredLifelogs(lastSeenTime);
    } catch (error) {
      console.error('Error fetching lifelogs:', error.message);
      // Don't throw, just return early to continue polling
      return;
    }

    // Ensure lifelogs is an array
    if (!Array.isArray(lifelogs)) {
      console.error('Invalid response from Limitless API: expected array, got:', typeof lifelogs, lifelogs);
      return;
    }

    if (lifelogs.length === 0) {
      console.log('No new starred lifelogs found');
      return;
    }

    console.log(`Found ${lifelogs.length} new starred lifelog(s)`);

    let maxTimestamp = lastSeenTime;
    let processedCount = 0;

    for (const lifelog of lifelogs) {
      try {
        // Log lifelog info for debugging
        const lifelogTitle = lifelog.title || lifelog.contents?.[0]?.content || 'Untitled';
        const lifelogTime = lifelog.updatedAt || lifelog.endTime || lifelog.startTime || 'unknown';
        console.log(`Processing lifelog: "${lifelogTitle}" (time: ${lifelogTime})`);
        
        await createNotionPage(lifelog, databaseSchema);
        console.log(`✓ Created Notion page for: ${lifelogTitle}`);
        processedCount++;

        // Track the latest timestamp (prefer updatedAt, then endTime, then startTime)
        const lifelogTimestamp = lifelog.updatedAt || lifelog.endTime || lifelog.startTime;
        if (lifelogTimestamp && lifelogTimestamp > maxTimestamp) {
          maxTimestamp = lifelogTimestamp;
        }
      } catch (error) {
        console.error(`Failed to create Notion page for lifelog ${lifelog.id || 'unknown'}:`, error.message);
        // Continue processing other lifelogs even if one fails
      }
    }

    // Update last seen time to the maximum timestamp we processed
    if (processedCount > 0) {
      await saveLastSeenTime(maxTimestamp);
      console.log(`Updated last seen time to: ${maxTimestamp}`);
    } else if (lifelogs.length > 0) {
      console.warn(`Warning: Found ${lifelogs.length} lifelog(s) but none were processed. Check for errors above.`);
    }
  } catch (error) {
    console.error('Error processing lifelogs:', error.message);
  }
}

/**
 * Main polling loop
 */
async function startPolling() {
  console.log('Starting Limitless → Notion sync service with AI mapping...');
  console.log(`Poll interval: ${POLL_INTERVAL_MS / 1000} seconds`);
  console.log(`Notion Database ID: ${NOTION_DATABASE_ID}`);

  // Fetch database schema on startup
  let databaseSchema;
  try {
    console.log('Fetching Notion database schema...');
    databaseSchema = await fetchNotionDatabaseSchema();
    console.log(`Database schema loaded with ${Object.keys(databaseSchema).length} properties`);
  } catch (error) {
    console.error('Failed to fetch database schema:', error.message);
    console.error('Service cannot continue without schema. Exiting...');
    process.exit(1);
  }

  // Process immediately on start
  await processNewLifelogs(databaseSchema);

  // Then poll at intervals
  setInterval(async () => {
    await processNewLifelogs(databaseSchema);
  }, POLL_INTERVAL_MS);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
  });
}

// Start the service
startPolling().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

