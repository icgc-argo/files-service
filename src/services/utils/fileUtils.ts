import { ANALYSIS_STATUS } from '../../utils/constants';
import { File, FileReleaseState } from '../../data/files';
import { FileCentricDocument } from '../fileCentricDocument';

export const isPublic = (file: File | FileCentricDocument): boolean =>
  [FileReleaseState.PUBLIC, FileReleaseState.QUEUED_TO_RESTRICT].includes(file.releaseState);

export const isRestricted = (file: File | FileCentricDocument): boolean =>
  [FileReleaseState.RESTRICTED, FileReleaseState.QUEUED_TO_PUBLIC].includes(file.releaseState);

export const isPublished = (file: File | FileCentricDocument): boolean =>
  file.status === ANALYSIS_STATUS.PUBLISHED;