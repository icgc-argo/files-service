export interface DbFile {
  fileId?: number;
  objectId: string;
  repoId: string;
  programId: string;
  analysisId: string;
  labels: FileLabel[];
}

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
