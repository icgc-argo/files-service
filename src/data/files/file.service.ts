/*
 * Copyright (c) 2020 The Ontario Institute for Cancer Research. All rights reserved
 *
 * This program and the accompanying materials are made available under the terms of
 * the GNU Affero General Public License v3.0. You should have received a copy of the
 * GNU Affero General Public License along with this program.
 *  If not, see <http://www.gnu.org/licenses/>.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
 * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT
 * SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
 * OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
 * IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
 * ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import Logger from '../../logger';
import * as fileModel from './file.model';
import {
  EmbargoStage,
  ClinicalExemption,
  File,
  FileFilter,
  FileFilterProperties,
  FileInput,
  FileLabel,
  FileMongooseDocument,
  FileReleaseState,
  FileStateFilter,
  PaginationFilter,
} from './file.model';
const logger = Logger('File.DataService');

export interface PaginatedFilesResponse {
  files: File[];
  meta: {
    totalFiles: number;
    pageSize: number;
    totalPages: number;
    hasPrevPage: boolean;
    hasNextPage: boolean;
    currentPage?: number;
  };
}

export async function getPaginatedFiles(
  paginationFilter: PaginationFilter,
  queryFilter: FileFilterProperties,
): Promise<PaginatedFilesResponse> {
  const response = await fileModel.getFilesQuery(paginationFilter, queryFilter);
  const files = response.docs.map(toPojo);
  return {
    meta: {
      totalFiles: response.totalDocs,
      currentPage: response.page,
      pageSize: response.limit,
      totalPages: response.totalPages,
      hasPrevPage: response.hasPrevPage,
      hasNextPage: response.hasNextPage,
    },
    files: files,
  };
}
/**
 * Async generator to iteratre through files that match a filter
 * @param filter filter with all conditions
 * @returns
 */
export async function* getAllFiles(filter: FileFilter): AsyncGenerator<File, void> {
  const fileIterator = fileModel.getFilesIterator(filter);
  for await (const doc of fileIterator) {
    yield toPojo(doc);
  }
  return;
}
export async function countFiles(filter: FileFilter): Promise<number> {
  return await fileModel.countFiles(filter);
}
export async function getFiles(filter: FileFilter): Promise<File[]> {
  return (await fileModel.getFiles(filter)).map(toPojo);
}
export async function getFileById(fileId: string): Promise<File> {
  const file = await getFileAsDoc(toNumericId(fileId));
  return toPojo(file);
}
export async function getFilesByAnalysisId(analysisId: string): Promise<File[]> {
  const results = await fileModel.getFiles({ include: { analyses: [analysisId] } });
  return results.map(toPojo);
}
export async function getFileByObjId(objId: string): Promise<File> {
  const file = await fileModel.getFileByObjId(objId);
  if (!file) {
    throw new Errors.NotFound('no file found for objId: ' + objId);
  }
  return toPojo(file);
}
export async function getFilesByObjectIds(objectIds: string[]): Promise<File[]> {
  const results = objectIds.length ? await fileModel.getFiles({ include: { objectIds } }) : [];
  return results.map(toPojo);
}

export async function getOrCreateFileByObjId(fileToCreate: FileInput): Promise<File> {
  const file = await fileModel.getFileByObjId(fileToCreate.objectId);
  if (file != undefined) {
    return toPojo(file);
  }

  fileToCreate.labels = new Array<FileLabel>();
  return toPojo(await fileModel.create(fileToCreate));
}

export async function getFilesByState(filter: FileStateFilter): Promise<File[]> {
  return (await fileModel.getFilesByState(filter)).map(toPojo);
}

export async function getPrograms(filter: FileFilter): Promise<string[]> {
  return await fileModel.getPrograms(filter);
}

/**
 * Returns the updated File.
 */
type ReleaseProperties = { embargoStage?: EmbargoStage; releaseState?: FileReleaseState };
export async function updateFileReleaseProperties(objectId: string, updates: ReleaseProperties): Promise<File> {
  logger.debug(`[File.Service] Updating file emabrgo and release properties: ${objectId} ${JSON.stringify(updates)}`);
  const result = await fileModel.updateByObjectId(objectId, updates, { new: true });
  return toPojo(result);
}

type AdminControls = {
  adminHold?: boolean;
  adminPromote?: EmbargoStage;
  adminDemote?: EmbargoStage;
};
export async function updateFileAdminControls(objectId: string, updates: AdminControls): Promise<File> {
  return toPojo(await fileModel.updateByObjectId(objectId, updates, { new: true }));
}

type FileSongPublishStatus = { status?: string; firstPublished?: Date };
export async function updateFileSongPublishStatus(objectId: string, updates: FileSongPublishStatus): Promise<File> {
  return toPojo(await fileModel.updateByObjectId(objectId, updates, { new: true }));
}

export async function applyClinicalExemption(
  filter: FileFilter,
  clinicalExemption: ClinicalExemption,
  options?: { returnDocuments: boolean },
): Promise<File[] | void> {
  const response = await fileModel.updateBulk(filter, { clinicalExemption }, options);
  if (options?.returnDocuments) {
    return response.map(toPojo);
  }
}

export async function removeClinicalExemption(
  filter: FileFilter,
  options?: { returnDocuments: boolean },
): Promise<File[] | void> {
  const response = await fileModel.updateBulk(filter, { clinicalExemption: undefined }, options);
  if (options?.returnDocuments) {
    return response.map(toPojo);
  }
}

export async function adminPromote(
  filter: FileFilter,
  stage: EmbargoStage,
  options?: { returnDocuments: boolean },
): Promise<File[] | void> {
  // Perform bulk update
  const response = await fileModel.updateBulk(filter, { adminPromote: stage }, options);
  if (options?.returnDocuments) {
    return response.map(toPojo);
  }
}

export async function adminDemote(
  filter: FileFilter,
  stage: EmbargoStage,
  options?: { returnDocuments: boolean },
): Promise<File[] | void> {
  // Perform bulk update
  const response = await fileModel.updateBulk(filter, { adminDemote: stage }, options);
  if (options?.returnDocuments) {
    return response.map(toPojo);
  }
}

export async function deleteByIds(ids: string[]): Promise<void> {
  await fileModel.deleteAll(ids.map(toNumericId));
}

/**
 * LABEL MANAGEMENT
 */
export async function addOrUpdateFileLabel(fileId: string, newLabels: FileLabel[]) {
  const file = await getFileAsDoc(toNumericId(fileId));
  validateLabels(newLabels);
  newLabels.forEach(label => {
    const newLabelKey = normalizeLabel(label.key);
    const existingLabel = file.labels.find(l => normalizeLabel(l.key) == newLabelKey);
    if (!existingLabel) {
      file.labels.push({
        key: newLabelKey,
        value: label.value || [],
      });
      return;
    }

    existingLabel.value = label.value || [];
    return;
  });
  return toPojo(await fileModel.save(file));
}

export async function removeLabel(fileId: string, keys: string[]): Promise<File> {
  const file = await getFileAsDoc(toNumericId(fileId));
  file.labels = file.labels.filter(l => !keys.includes(l.key));
  const updated = await fileModel.save(file);
  return toPojo(updated);
}

function toNumericId(id: string) {
  if (!id.startsWith('FL')) {
    throw new Errors.InvalidArgument('File ID should start with FL, example: FL1234');
  }
  const numId = Number(id.substr(2, id.length - 2));
  if (!numId || numId == Number.NaN) {
    throw new Errors.InvalidArgument(`ID ${id} is not a valid`);
  }
  return numId;
}

async function getFileAsDoc(id: number): Promise<fileModel.FileMongooseDocument> {
  const file = await fileModel.getFileById(id);
  if (file == undefined) {
    throw new Errors.NotFound('no file found for this id ');
  }
  return file;
}

function toPojo(f: FileMongooseDocument): File {
  if (!f) {
    throw new Error('cannot convert undefined');
  }
  return {
    fileId: `FL${f.fileId}`,
    fileNumber: f.fileId,
    objectId: f.objectId,
    repoId: f.repoId,

    analysisId: f.analysisId,
    donorId: f.donorId,
    programId: f.programId,
    firstPublished: f.firstPublished,

    status: f.status,

    embargoStage: f.embargoStage as EmbargoStage,
    releaseState: f.releaseState as FileReleaseState,

    adminHold: f.adminHold,
    adminPromote: f.adminPromote as EmbargoStage,
    adminDemote: f.adminDemote as EmbargoStage,

    labels: f.labels,

    clinicalExemption: f.clinicalExemption as ClinicalExemption,
    embargoStart: f.embargoStart,
  };
}

const validateLabels = (labels: FileLabel[]) => {
  if (!labels || labels.length == 0) {
    throw new Errors.InvalidArgument('missing the labels');
  }
  labels.forEach((l, i) => {
    if (!l.key) {
      throw new Errors.InvalidArgument(`Label at index ${i}, is missing the "key" attribute`);
    }

    if (l.key.indexOf(',') !== -1) {
      throw new Errors.InvalidArgument(`Label at index ${i}, Keys cannot have comma in them.`);
    }

    const hasDuplicates = labels.filter(l2 => normalizeLabel(l2.key) == normalizeLabel(l.key)).length > 1;

    if (hasDuplicates) {
      throw new Errors.InvalidArgument(`Label at index ${i}, cannot submit duplicated label keys`);
    }
  });
};

const normalizeLabel = (key: string) => {
  return key.toLowerCase().trim();
};

export namespace Errors {
  export class InvalidArgument extends Error {
    constructor(message: string) {
      super(message);
    }
  }

  export class NotFound extends Error {
    constructor(msg: string) {
      super(msg);
    }
  }

  export class StateConflict extends Error {
    constructor(msg: string) {
      super(msg);
    }
  }
}
