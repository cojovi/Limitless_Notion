# Limitless Starred → Notion Sync

A service that automatically syncs starred lifelogs from your Limitless.ai pendant to a Notion database using AI-powered intelligent mapping.

## Features

- **AI-Powered Mapping**: Uses ChatGPT to intelligently map Limitless lifelog data to your Notion database properties
- **Automatic Schema Detection**: Fetches and analyzes your Notion database schema to understand available properties and options
- **Smart Property Mapping**: AI determines the best way to map lifelog data based on property names, types, and available options
- Polls Limitless API for starred lifelogs at configurable intervals
- Only processes new items (tracks last seen timestamp)
- Automatically creates pages in your Notion database
- Handles errors gracefully and continues processing

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   - Copy `.env.example` to `.env`
   - Fill in your API keys and database ID:
     - `LIMITLESS_API_KEY`: Your Limitless API key
     - `NOTION_API_KEY`: Your Notion integration API key
     - `NOTION_DATABASE_ID`: The ID of your Notion database
     - `OPENAI_API_KEY`: Your OpenAI API key (for ChatGPT)
     - `POLL_INTERVAL_MS`: (Optional) Poll interval in milliseconds (default: 30000)

3. **Configure your Notion database:**
   
   The service automatically detects your database schema! No manual configuration needed.
   
   The AI will intelligently map lifelog data to your existing properties. Supported property types:
   - `title` - For main titles
   - `rich_text` - For content/descriptions
   - `date` - For timestamps
   - `select` - For single-choice categories/tags
   - `multi_select` - For multiple tags/categories
   - `status` - For status fields
   - `number` - For numeric data
   - `checkbox` - For boolean flags
   - `url` - For links
   - `email` - For email addresses
   - `phone_number` - For phone numbers
   
   The AI analyzes property names and content to make intelligent mapping decisions.

4. **Start the service:**
   ```bash
   npm start
   ```
   
   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

## How It Works

1. **On startup:**
   - Fetches your Notion database schema (cached for 1 hour to reduce API calls)
   - Sets `lastSeenTime` to the current time (or loads it from `.last-seen-state.json` if it exists)

2. **Every X seconds** (configurable via `POLL_INTERVAL_MS`):
   - Fetches starred lifelogs from Limitless API since `lastSeenTime`
   - For each new lifelog:
     - Uses ChatGPT to analyze the lifelog data and database schema
     - AI generates intelligent property mappings based on:
       - Property names (e.g., "Tags", "Category", "Priority")
       - Property types and available options
       - Content from the lifelog (title, markdown, timestamps, etc.)
     - Creates a Notion page with the AI-generated mappings
   - Updates `lastSeenTime` to the maximum `updatedAt` timestamp of processed items

3. **State persistence:**
   - Last seen timestamp persisted in `.last-seen-state.json`
   - Database schema cached in `.notion-schema-cache.json` (refreshed hourly)

## Important Notes

- **API Key Security:** The Notion API key mentioned in the original document should be regenerated as it was exposed in chat
- **AI Mapping:** The service uses GPT-4o-mini to intelligently map data. It analyzes property names and content to make smart decisions (e.g., if you have a "Tags" property, it might extract relevant tags from the lifelog content)
- **Database Schema:** The service automatically detects your database schema - no manual configuration needed!
- **Select/Status Options:** The AI will match values to existing select/status options when possible
- **First Run:** On the first run, it will only process items created after the service starts. To sync historical items, you'd need to manually adjust the state file or modify the code
- **AI Costs:** Uses GPT-4o-mini which is cost-effective. Each lifelog requires one API call to generate mappings

## Troubleshooting

- **"Notion API error"**: Check that your API key is valid and your integration has access to the database
- **"Limitless API error"**: Verify your Limitless API key is correct
- **"OpenAI API error"**: Verify your OpenAI API key is correct and you have credits available
- **"AI mapping failed"**: The service will fall back to basic title mapping if AI fails. Check your OpenAI API key and credits
- **Property errors**: The AI should handle most property types automatically. If you see errors, check that select/status options match what the AI is trying to use

