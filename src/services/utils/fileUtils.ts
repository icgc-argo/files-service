import { File, FileReleaseState } from '../../data/files';
import { FileCentricDocument } from '../fileCentricDocument';

export const isPublic = (file: File | FileCentricDocument): boolean =>
  [FileReleaseState.PUBLIC, FileReleaseState.QUEUE_TO_RESTRICTED].includes(file.releaseState);

export const isRestricted = (file: File | FileCentricDocument): boolean =>
  [FileReleaseState.RESTRICTED, FileReleaseState.QUEUE_TO_PUBLIC].includes(file.releaseState);
