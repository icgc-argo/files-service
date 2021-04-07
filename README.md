# Files service

Responsible to maintain an aggregated database of all genomic file ids and extra metadata from all RDPCs.

# API

a swagger UI is available `/api-docs`

# Code Structure

`server.ts` is the entry point for this service. It is responsible for:

- initializing the application config defined in `config.ts`
- starting the MongoDB connection based on the connection definition in `data/dbConnection.ts`
- starting the Express app defined in `app.ts`

## Data

`data/` provides configuration for MongoDB connection and definitions for the data types stored.

- `files` metadata about files from Argo RDPCs, and their registered File IDs. This does not include all data available from the repository where the file lives, just enough to allow searching for them via commonly used IDs (program, donor, analysis, etc.) and to track their progress through embargo and release.
- `release` details of previous releases and data on the files included in the next release. Details include files being made public and files being withdrawn from the public release.

## Routers

`routers/` provides all express routers and the definition of the endpoints available in this service:

- `admin` for actions DCC Admin might request, such as re-indexing a program, or RDPC.
- `debug` for developer debug and testing actions. All endpoints here can be disabled/enabled based on the environment variable: `ENABLE_DEBUG_ENDPOINTS`
- `files` CRUD actions for file data and their labels.
- `health` a health status check endpoint.

## External Dependencies

`external/` provides connections to external services used by this application.

- `kafka` managign Kafka topic subscriptions and message sending.
- `maestro` Overture tool typically used to index all documents from Song into ElasticSearch. In this service it is used to convert an Analysis message from Song into File documents.
- `rollcall` Overture tool used to manage index versioning and combining separate indices into an alias.
- `vault` provider of application configuration secrets. Optionally used based on the `VAULT_ENABLED` environment variable
