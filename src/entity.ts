export interface File {
  fileId?: number;
  objectId: string;
  repoId: string;
  programId: string;
  analysisId: string;
  labels: FileLabels;
}

export type FileLabels = { [key: string]: string[] };

export type QueryFilters = {
  analysisId?: string[];
  programId?: string[];
  objectId?: string[];
};
