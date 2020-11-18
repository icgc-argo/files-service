import { convertAnalysisToFileDocuments } from './analysisConverter';
import * as service from './service';
import { AnalysisUpdateEvent, File, FileCentricDocument } from './entity';

export async function handleAnalysisPublishEvent(analysisEvent: AnalysisUpdateEvent) {
  const analysis = analysisEvent.analysis;
  const dataCenterId = analysisEvent.songServerId;

  // get genomic files for an analysis
  const filesByAnalysisId = await convertAnalysisToFileDocuments(analysis, dataCenterId);
  let files: FileCentricDocument[] = [];

  // get the file docs arrays from maestro response
  Object.keys(filesByAnalysisId).forEach((a: string) => {
    files = files.concat(filesByAnalysisId[a]);
  });

  const docsWithFile = files.map(async (f: FileCentricDocument) => {
    const fileToCreate: File = {
      analysisId: f.analysis.analysisId,
      objectId: f.objectId,
      programId: f.studyId,
      repoId: dataCenterId,
      labels: [],
    };

    const fileRecord = await service.getOrCreateFileRecordByObjId(fileToCreate);

    // here we can extract the file Id/labels for indexing later
    f.fileId = fileRecord.fileId as string;
    return f;
  });

  // call clinical to fetch file centric clinical fields

  // call elasticsearch to index the batch of enriched file documents

  // for now return the docs
  const docsToIndex = await Promise.all(docsWithFile);
  return docsToIndex;
}
