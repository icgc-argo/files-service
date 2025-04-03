# File Manager Indexing

The File Manager is responsible for maintaining two search indices, one file-centric and the other donor-centric.

## Donor Centric Index

- Every document represents one donor
- Donor data will only be indexed if:
  - donor is core complete
  - donor has PUBLISHED analyses that have begun their embargo
- Donor data will not be restricted by the embargo process, but their files will still be
  - file embargo stage will be included in their file data

### Data Structure

- Root document is the donor
- All clinical entities will be nested within
  - clinical completion stats will not be indexed
  - Schema version validity will be indexed
- An array of Analyses will also be connected to the donor
  - each analysis has an array of files
  - only index analyses that are in PUBLISHED state

Graph structure for donor documents:

```
donor
├── analyses
│   └── files
├── specimens
│   └── samples
├── primary_diagnoses
├── treatments
│   └── therapies
├── follow_ups
├── comorbidity
├── exposure
└── biomarker
```
