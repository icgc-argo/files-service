# Files service

Responsible to maintain an aggregated database of all genomic file ids and extra metadata from all RDPCs

# API

a swagger UI is available `/api-docs`

## examples:

- create file body

```
{
  "fileId": 0,
  "objectId": "masdkaskd-asdkasdas",
  "repoId": "song.collab",
  "programId": "TEST-CA",
  "analysisId": "aaa1",
  "labels": {
    "additionalProp1": [
      "value 1"
    ],
    "additionalProp2": [
      "value 1"
    ],
    "additionalProp3": [
      "value 1", "value3"
    ]
  }
}
```

-
