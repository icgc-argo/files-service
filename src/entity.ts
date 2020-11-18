export interface DbFile {
  fileId?: number;
  objectId: string;
  repoId: string;
  programId: string;
  analysisId: string;
  labels: FileLabel[];
}

export type AnalysisUpdateEvent = {
  songServerId: string;
  analysis: { [k: string]: any };
};

export type FileCentricDocument = { [k: string]: any } & {
  fileId: string;
  objectId: string;
  studyId: string;
  analysis: { [k: string]: any };
};

export interface File {
  fileId?: string;
  objectId: string;
  repoId: string;
  programId: string;
  analysisId: string;
  labels: FileLabel[];
}

export type FileLabel = {
  key: string;
  value: string[];
};

export type QueryFilters = {
  analysisId?: string[];
  programId?: string[];
  objectId?: string[];
};
