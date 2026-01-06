# Nosana Deployment Manager

A deployment manager service for managing Nosana job deployments with MongoDB persistence and a RESTful API.

## Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development)
- npm

## Quick Start

### 1. Create the Docker Network

The compose file requires an external network. Create it first:

```bash
docker network create deployments_network
```

### 2. Configure Environment Variables

The service uses environment variables defined in `compose.yaml`. Key variables:

- `NETWORK`: Solana network (`mainnet` or `devnet`, default: `devnet`)
- `VAULT_KEY`: Vault encryption key (change from default `change_me` in production!)
- `TASKS_BATCH_SIZE`: Number of tasks to process in batch (default: `10`)
- `CONFIDENTIAL_BY_DEFAULT`: Whether deployments are confidential by default (default: `true`)
- `DEPLOYMENT_MANAGER_PORT`: Internal port (default: `3000`, mapped to `3001` externally)
- `DOCDB_HOST`: MongoDB hostname (default: `host.docker.internal`)
- `DOCDB_PORT`: MongoDB port (default: `27017`)
- `DOCDB_USERNAME`: MongoDB username (optional)
- `DOCDB_PASSWORD`: MongoDB password (optional)

### 3. Start the Services

```bash
docker compose up -d
```

This will:
- Start MongoDB 7.0 with replica set configuration
- Build and start the deployment manager service
- Expose the API on port `3001` (mapped from internal port 3000)
- Expose MongoDB on port `27017`

### 4. Verify It's Running

Check the services:

```bash
docker compose ps
```

Check the logs:

```bash
docker compose logs -f deployment_manager
```

The API should be available at `http://localhost:3001`

## API Documentation

Once running, access the interactive Swagger documentation at:

- **Swagger UI**: http://localhost:3001/documentation/swagger
- **OpenAPI JSON**: http://localhost:3001/documentation/json

## API Usage

### Base URL

All API endpoints are prefixed with `/api/deployments`

### Authentication

Most endpoints require authentication headers:

- `x-user-id`: Your user ID (Solana address)
- `authorization`: Authorization token (either `nos_*` API key or signed message)

Example:

```bash
curl -X GET http://localhost:3001/api/deployments \
  -H "x-user-id: YOUR_SOLANA_ADDRESS" \
  -H "authorization: YOUR_AUTH_TOKEN"
```

### Main Endpoints

#### Deployments

- `GET /api/deployments` - List all deployments
- `GET /api/deployments/:deployment` - Get deployment by ID
- `POST /api/deployments/create` - Create a new deployment
- `POST /api/deployments/:deployment/start` - Start a deployment
- `POST /api/deployments/:deployment/stop` - Stop a deployment
- `POST /api/deployments/:deployment/create-revision` - Create a new revision
- `PATCH /api/deployments/:deployment/update-active-revision` - Update active revision
- `PATCH /api/deployments/:deployment/update-replica-count` - Update replica count
- `PATCH /api/deployments/:deployment/update-schedule` - Update schedule
- `PATCH /api/deployments/:deployment/update-timeout` - Update timeout
- `POST /api/deployments/:deployment/archive` - Archive a deployment
- `GET /api/deployments/:deployment/tasks` - Get scheduled tasks
- `GET /api/deployments/:deployment/jobs/:job` - Get job by ID

#### Jobs

- See `/api/jobs` routes in Swagger documentation

#### Stats

- See `/api/stats` routes in Swagger documentation

#### Vault

- See `/api/vault` routes in Swagger documentation

## Local Development

### Without Docker

1. Install dependencies:

```bash
npm ci
```

2. Ensure MongoDB is running locally on port 27017

3. Set environment variables (create a `.env` file or export them):

```bash
export NETWORK=devnet
export VAULT_KEY=your_vault_key
export TASKS_BATCH_SIZE=10
export CONFIDENTIAL_BY_DEFAULT=true
export DEPLOYMENT_MANAGER_PORT=3001
export DOCDB_HOST=localhost
export DOCDB_PORT=27017
```

4. Build the project:

```bash
npm run build
```

5. Run the application:

```bash
node dist/src/index.js
```

### With Docker (Development Mode)

The compose file includes watch mode for development:

```bash
docker compose up
```

This will:
- Watch for file changes and sync them to the container
- Automatically restart on changes
- Rebuild when `package.json` changes

## Testing

The project uses [Vitest](https://vitest.dev/) for testing. To run tests:

### Run all tests once

```bash
npm test
```

### Run tests in watch mode

```bash
npm run test:watch
```

This will watch for file changes and re-run tests automatically.

### Run tests with coverage

```bash
npm run test:coverage
```

This will generate a coverage report showing which parts of your code are covered by tests. Coverage reports are generated in multiple formats (text, JSON, HTML) and can be found in the `coverage` directory.

## Database

MongoDB is configured with:
- Replica set: `rs0`
- Port: `27017`
- Data persisted in Docker volume: `deploymentsdbdata`

To access MongoDB directly:

```bash
docker compose exec deployments_db mongosh
```

## Stopping the Services

```bash
docker compose down
```

To also remove volumes (⚠️ deletes data):

```bash
docker compose down -v
```

## Troubleshooting

### Network Error

If you see network-related errors, ensure the network exists:

```bash
docker network create deployments_network
```

### MongoDB Replica Set

The MongoDB container automatically initializes a replica set. If you see errors, check the healthcheck logs:

```bash
docker compose logs deployments_db
```

### Port Already in Use

If port 3001 or 27017 is already in use, either:
- Stop the conflicting service
- Modify the port mappings in `compose.yaml`

## Project Structure

- `src/` - Source code
  - `index.ts` - Application entry point
  - `router/` - API routes and middleware
  - `tasks/` - Task processing logic
  - `config/` - Configuration management
  - `connection/` - Database connections
  - `listeners/` - Event listeners
- `compose.yaml` - Docker Compose configuration
- `Dockerfile` - Production Docker image
- `Dockerfile.dev` - Development Docker image



