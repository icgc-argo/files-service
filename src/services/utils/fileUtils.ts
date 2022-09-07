import { ANALYSIS_STATUS } from '../../utils/constants';
import { File, FileReleaseState } from '../../data/files';
import { FileCentricDocument } from '../fileCentricDocument';
import Logger from '../../logger';

/**
 * Check if a is in a publicly released state
 * @param file
 * @returns
 */
export const isPublic = (file: File | FileCentricDocument): boolean =>
  [FileReleaseState.PUBLIC, FileReleaseState.QUEUED_TO_RESTRICT].includes(file.releaseState);

/**
 * Check if a file is in a restricted release state
 * @param file
 * @returns
 */
export const isRestricted = (file: File | FileCentricDocument): boolean =>
  [FileReleaseState.RESTRICTED, FileReleaseState.QUEUED_TO_PUBLIC].includes(file.releaseState);

/**
 * Check if a file has been released (public or restricted release state)
 *  This can filter out files in Unreleased state.
 * @param file
 * @returns
 */
export const isReleased = (file: File | FileCentricDocument): boolean =>
  ![FileReleaseState.UNRELEASED].includes(file.releaseState);

export const isUnreleased = (file: File | FileCentricDocument): boolean =>
  [FileReleaseState.UNRELEASED].includes(file.releaseState);

/**
 * Checks the file's AnalysisState to confirm that the file is published in Song
 *  Only files that are published in song should be indexed.
 * @param file
 * @returns
 */
export const isFilePublished = (file: File): boolean => file.status === ANALYSIS_STATUS.PUBLISHED;

/**
 * Checks the file's AnalysisState to confirm that the file is published in Song
 *  Only files that are published in song should be indexed.
 * @param file
 * @returns
 */
export const isFileCentricPublished = (file: FileCentricDocument): boolean =>
  file.analysis.analysisState === ANALYSIS_STATUS.PUBLISHED;

/* ************ *
 * File Sorting *
 * ************ */

// Separate list of file documents into distinct lists per program.
export type FileDocsSortedByProgramsArray = Array<{
  files: FileCentricDocument[];
  program: string;
}>;
export function sortFileDocsIntoPrograms(files: FileCentricDocument[]): FileDocsSortedByProgramsArray {
  // Sort Files into programs
  const programMap = files.reduce<Record<string, FileCentricDocument[]>>(
    (acc: { [program: string]: FileCentricDocument[] }, file) => {
      const program = file.studyId;
      if (acc[program]) {
        acc[program].push(file);
      } else {
        acc[program] = [file];
      }
      return acc;
    },
    {},
  );

  // For each program, add an element to output array
  const output: FileDocsSortedByProgramsArray = Object.entries(programMap).map(([program, files]) => ({
    program,
    files,
  }));

  return output;
}
// Separate list of files into distinct list per program.
export type FilesSortedByProgramsArray = Array<{ files: File[]; program: string }>;
export function sortFilesIntoPrograms(files: File[]): FilesSortedByProgramsArray {
  const output: FilesSortedByProgramsArray = [];

  // Sort Files into programs
  const programMap = files.reduce((acc: { [program: string]: File[] }, file) => {
    const program = file.programId;
    if (acc[program]) {
      acc[program].push(file);
    } else {
      acc[program] = [file];
    }
    return acc;
  }, {});

  // For each program, add an element to output array
  Object.entries(programMap).forEach(([program, files]) => {
    output.push({ program, files });
  });
  return output;
}
