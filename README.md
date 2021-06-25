# Files Manager

Responsible to maintain an aggregated database of all genomic file ids and extra metadata from all RDPCs, and the indexing of this data to Elasticsearch/

# API Reference

A swagger UI is available `/api-docs`

# Developer Quick Start

Before running the server, you will need to copy the `.env.example` file to `.env` . There are some sensible defaults in the example configuration, but modify these values as needed.

A makefile is provided with several tools to quickly get working locally. Run `make debug` to start the docker-compose of all service dependencies, and then run the File Manager service in dev/debug mode (watching for changes and restarting after file changes).

The docker-compose configuration is provided in the `/compose` path. To run the docker setup without starting the service, you can run `make dcompose`.

## ES Snapshot Setup

When building release indices, the service can optionally create ElasticSearch snapshots for the new indices. To do this, a snapshot repository is required. The .env variable `ES_SNAPSHOT_REPOSITORY` defines the name of this repository, if no value is provided then no snapshot will be created.

To create a snapshot repository named `backups` in your local elasticsearch cluster, you can use the following command:

```
curl -X PUT "http://localhost:9200/_snapshot/backups" -H 'Content-Type: application/json' -d'
{
  "type": "fs",
  "settings": {
    "location": "backups"
  }
}
'
```

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

- `admin` for actions DCC Admin might request, such as initiating data fetch from RDPC, or enforcing changes to the embargo stage of a file
- `files` CRUD actions for files
- `release` prepare and publish PUBLIC file indices
- `health` a health status check endpoint.
- `debug` for developer debug and testing actions. All endpoints here can be disabled/enabled based on the environment variable: `ENABLE_DEBUG_ENDPOINTS`

## External Dependencies

`external/` provides connections to external services used by this application.

- `analysesConverter` Convert analysis data into file-centric data. In practice, this is the Overture application `Maestro`. Typically it is used to index all documents from Song into ElasticSearch. In this service it is used to convert an Analysis message from Song into File documents.
- `dataCenterRegistry` api which maintains a list of data centers available that can provide analysis-data, used to fetch URLs for `Song` services.
- `elasticsearch` configuration of the Node Elasticsearch client
- `kafka` manages Kafka topic subscriptions and message sending.
- `rollcall` Overture application used to manage index versioning and combining separate indices into an alias.
- `song` Overture application for storing Analysis metadata. Provides analysis data when a program/data-center is synced. There will be multiple Song servers (at least 1 per RDPC) that will be accessed for analysis data, their URLs will be found using the DataCenterRegistry.
- `vault` provider of application configuration secrets. Optionally used based on the `VAULT_ENABLED` environment variable
