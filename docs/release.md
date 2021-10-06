# Public Release Process

Swagger available at `/api-docs`.

## Active Release and the Async Release Process

The _GET active release_ endpoint is `/release/active`. This can be called at any time to get the status of the active release.

All the steps in the release process run asynchronously on the server, which means once you initiate them you will only get a response indicating the new state of the active release, not the complete release details. You will need to check Active Release endpoint to check for completion of the various steps in this process. The duration of each process will depend on the number of files that need to be updated, but should be less than 5 minutes.

Ideally, this process will be executed via a web UI which can poll that endpoint and update the user when the requested updates are complete.

The different statuses in this release process, and the order they will go in are:

`calculating` -> `calculated` -> `building` -> `built` -> `publishing` -> `published`

TODO: State Change Diagram with actions labelled.

### Interupting actions

While the release is `calculating`, `building`, or `publishing` no actions can be taken on the release, wait for the process to finish.

### Repeating previous steps

From `calculated` state, you can run the Calculate Release step again to update the files in the active release, or proceed to Build the release.

From `built` state you can run the Calculate Release step again, and this will discard the current built release. You can also proceed to Publish the release.

Once in `published` state, this release will no longer be the active release. No actions are possible, a new release should be started if changes tot he Public indices are required.

### Error States

There are also error states that the release can be put into:

`calculating` -> `error_calculating`
`building` -> `error_building`
`releasing` -> `error_releasing`

When in error status, the release will have an `errors` property with details of what went wrong.

## Steps

1. **Calculate** Begin a new Active Release using the `/release/calculate` endpoint. This will collect into the new release lists of files:

   Outputs:

   - **filesAdded**: Are currently Restricted and QUEUED for public release, these files are currently Restricted but will be made Public in this release
   - **filesKept**: Are currently Public, they will be updated to match any changes published in Song
   - **filesRemoved**: Are currently Public, but they will be Restricted when this release is published.

1. **Build** Using `/release/build/{version}/{label}` Build new Public indices with all the _filesAdded_ and _filesKept_ indicated in the last step. This is the slowest step as all the public files need to be updated to match their content from Song.

   Inputs:

   - **version** Each calculated release has a version hash that is unique to the combination of files added/kepy/removed. This value must be provided to build the release, and must match the current active release. This prevents accidental builds of a release with different files than were expected.
   - **label** A descriptive string to identify this release. A version number is a good label. ARGO releases so far have labels such as `3.0`

   Outputs:

   - **indices** List of the Public indices created for this release
   - **snapshot** Name of the snapshot created to archive the Public indices in this release.

1. **Publish** Make the built release public. This will swap the Public indices in this release into the file centric alias. This step will also update the restricted indices to remove the files that have been made public, and add in the files that were removed from the Public indices.

## Removing Files from the Public Release

Reasons for removing a file from the next public release:

- Unpublished in Song
- Admin demotion

The Song unpublish case requires emergency action by the DCC-Admin team, where a new public release should be initiated because this file is being made unavailable. Like all releases, this should not be automated, but an alert should be sent to DCC-Admin so that action can be taken. (Don't automate because there are cases where an analysis will be unpublished then shortly afterwards published again).

A file demoted by admin will remain public until the next release is initiated. The timing of these actions are at the discretion of the DCC-Admin team.
