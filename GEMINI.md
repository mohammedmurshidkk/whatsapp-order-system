# GEMINI.md

## Project Overview

This project is an AI-powered WhatsApp ordering system for cafes and bakeries. It uses Node.js, Express, and TypeScript on the backend, with Supabase for the database and the Gemini API for natural language processing.

The system is designed to handle the entire ordering process through WhatsApp, from taking the initial order to handling modifications, checkout, and confirmation. It uses a state machine to manage the conversation flow and a detailed system prompt to guide the Gemini AI in its responses.

## Building and Running

### Prerequisites

*   Node.js and npm
*   A Supabase account and project
*   A Google Gemini API key

### Setup

1.  **Install dependencies:**
    ```bash
    npm install
    ```

2.  **Configure environment variables:**
    Copy the `.env.example` file to `.env` and fill in your Supabase and Gemini API credentials.
    ```bash
    cp .env.example .env
    ```

### Running in Development

To run the application in development mode with hot-reloading:

```bash
npm run dev
```

The server will start on port 3000 by default.

### Building for Production

To build the TypeScript code for production:

```bash
npm run build
```

This will create a `dist` directory with the compiled JavaScript files.

### Running in Production

To start the application in production:

```bash
npm start
```

## Development Conventions

*   **Language:** The project is written in TypeScript.
*   **Linting/Formatting:** (TODO: Add linting and formatting commands if they exist, e.g., `npm run lint`, `npm run format`)
*   **Testing:** The `package.json` file includes a `test` script, but it is currently a placeholder.
    ```bash
    npm test
    ```
*   **Contribution Guidelines:** (TODO: Add any contribution guidelines if they exist)
